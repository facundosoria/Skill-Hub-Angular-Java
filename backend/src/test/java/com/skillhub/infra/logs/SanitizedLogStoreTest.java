package com.skillhub.infra.logs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import static org.assertj.core.api.Assertions.*;

class SanitizedLogStoreTest {
    @TempDir Path dir;
    LogFixtures.MutableClock clock;
    SanitizedLogStore store;

    @BeforeEach void setup() throws Exception {
        LogFixtures.copy(dir);
        clock = new LogFixtures.MutableClock();
        store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        store.refresh();
    }

    @Test void snapshotAndPaginationPreserveScannedCursorsAndAscendingOrder() {
        var snapshot = store.page(LogFixtures.query("limit", "2"));
        assertThat(snapshot.entries()).extracting(LogsDto.Entry::id).containsExactly("g7:2", "g7:3");
        assertThat(snapshot.nextBefore()).isEqualTo("g7:2");
        assertThat(snapshot.nextAfter()).isEqualTo("g7:3");
        assertThat(snapshot.hasMoreBefore()).isTrue();
        assertThat(store.page(LogFixtures.query("before", "g7:2", "through", "g7:3")).entries())
                .extracting(LogsDto.Entry::id).containsExactly("g7:1");
        var forward = store.page(LogFixtures.query("after", "g7:1", "limit", "1"));
        assertThat(forward.nextAfter()).isEqualTo("g7:2");
        assertThat(forward.hasMoreAfter()).isTrue();
        var noMatches = store.page(LogFixtures.query("after", "g7:1", "q", "absent"));
        assertThat(noMatches.entries()).isEmpty();
        assertThat(noMatches.nextAfter()).isEqualTo("g7:3");
        assertThat(noMatches.hasMoreAfter()).isFalse();
    }

    @Test void literalFiltersAndTraceMatchingNeverExposeUnknownFields() throws Exception {
        var page = store.page(LogFixtures.query("q", "GET /API/EXAMPLE/{ID}", "traceId", "11111111111111111111111111111111"));
        assertThat(page.entries()).hasSize(1);
        assertThat(store.page(LogFixtures.query("q", ".*")).entries()).isEmpty();
        assertThat(store.page(LogFixtures.query("levels", "ERROR")).entries()).hasSize(1);
        String json = LogFixtures.MAPPER.writeValueAsString(page);
        assertThat(json).doesNotContain("unexpected", "synthetic-private-value", "message", "traceparent", "policyVersion\":\"r2-v1\",\"unexpected");
        assertThat(LogFixtures.MAPPER.readTree(json).get("entries").get(0).size()).isEqualTo(14);
    }

    @Test void routeMethodStatusAndMinimumDurationFiltersCombineOnSanitizedFields() {
        var routeAndMethod = store.page(LogFixtures.query("route", "EXAMPLE/{id}", "method", "GET"));
        assertThat(routeAndMethod.entries()).extracting(LogsDto.Entry::id).containsExactly("g7:1", "g7:2");
        var statuses = store.page(LogFixtures.query("status", "4xx,500"));
        assertThat(statuses.entries()).extracting(LogsDto.Entry::id).containsExactly("g7:2", "g7:3");
        var combined = store.page(LogFixtures.query("levels", "WARN", "route", "example", "method", "GET",
                "status", "404", "minDurationMs", "19", "q", "GET", "traceId", "11111111111111111111111111111111"));
        assertThat(combined.entries()).isEmpty();
        assertThat(store.page(LogFixtures.query("minDurationMs", "19")).entries())
                .extracting(LogsDto.Entry::id).containsExactly("g7:2");
        for (String[] pair : new String[][]{{"route", "x".repeat(121)}, {"route", "bad\nroute"},
                {"method", "HEAD"}, {"status", "4xx,99"}, {"minDurationMs", "-1"}, {"minDurationMs", "600001"}}) {
            assertThatThrownBy(() -> LogFixtures.query(pair)).isInstanceOf(LogsException.class);
        }
    }

    @Test void atSelectsAscendingPageClampsCoverageAndReturnsNewestForFutureInstant() {
        var page = store.page(LogFixtures.query("at", "2026-10-14T06:50:58Z", "limit", "2"));
        assertThat(page.entries()).extracting(LogsDto.Entry::id).containsExactly("g7:2", "g7:3");
        assertThat(store.page(LogFixtures.query("at", "2026-10-13T23:00:00Z", "limit", "2")).entries())
                .extracting(LogsDto.Entry::id).containsExactly("g7:1", "g7:2");
        assertThat(store.page(LogFixtures.query("at", "2026-10-14T08:00:00Z", "limit", "2")).entries())
                .extracting(LogsDto.Entry::id).containsExactly("g7:2", "g7:3");
    }

    @Test void finalPartialLineWaitsForNewlineWithoutDuplicateDelivery() throws Exception {
        Files.writeString(dir.resolve(LogFixtures.FILE), LogFixtures.event(1, "INFO", "First") + "\n" + LogFixtures.event(2, "INFO", "Second"));
        store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        store.refresh();
        assertThat(store.size()).isEqualTo(1);
        assertThat(store.page(LogFixtures.query()).headCursor()).isEqualTo("g7:1");
        Files.writeString(dir.resolve(LogFixtures.FILE), "\n", java.nio.file.StandardOpenOption.APPEND);
        store.refresh();
        store.refresh();
        assertThat(store.size()).isEqualTo(2);
    }

    @Test void scanStopsAtFiveThousandEvenWithoutMatches() throws Exception {
        LogFixtures.events(dir, 5100);
        store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        store.refresh();
        var page = store.page(LogFixtures.query("q", "never"));
        assertThat(page.entries()).isEmpty();
        assertThat(page.nextBefore()).isEqualTo("g7:101");
        assertThat(page.hasMoreBefore()).isTrue();
        var next = store.page(LogFixtures.query("before", page.nextBefore(), "q", "never"));
        assertThat(next.hasMoreBefore()).isFalse();
    }

    @Test void capacityAndTtlBoundTheRingAndExpireCursors() {
        store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 800, 2);
        store.refresh();
        assertThat(store.payloadBytes()).isLessThanOrEqualTo(800);
        assertThat(store.size()).isLessThanOrEqualTo(2);
        assertThat(store.page(LogFixtures.query()).capacityLimited()).isTrue();
        assertThatThrownBy(() -> store.page(LogFixtures.query("after", "g7:1"))).isInstanceOf(LogsException.class);
        clock.advance(21601);
        store.refresh();
        assertThat(store.size()).isZero();
    }

    @Test void newGenerationDropsIndexAndRejectsPreviousCursors() throws Exception {
        var manifest = LogFixtures.manifest(dir);
        manifest.put("generation", "g8").put("headSeq", 1);
        var segment = (com.fasterxml.jackson.databind.node.ObjectNode) manifest.withArray("segments").get(0);
        segment.put("file", "seg-g8-000001.ndjson").put("lastSeq", 1);
        Files.writeString(dir.resolve("seg-g8-000001.ndjson"), LogFixtures.event(1, "WARN", "New generation") + "\n");
        LogFixtures.manifest(dir, manifest);
        store.refresh();
        assertThat(store.page(LogFixtures.query()).entries()).extracting(LogsDto.Entry::id).containsExactly("g8:1");
        assertThatThrownBy(() -> store.page(LogFixtures.query("after", "g7:3"))).isInstanceOf(LogsException.class);
    }

    @Test void absentOrCorruptManifestFailsClosedButRetainedHistorySurvivesDisconnect() throws Exception {
        Files.delete(dir.resolve("manifest.json"));
        store.refresh();
        assertThat(store.page(LogFixtures.query()).sourceStatus()).isEqualTo("disconnected");
        var cold = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 1000, 10);
        cold.refresh();
        assertThat(cold.status(0, null).sourceStatus()).isEqualTo("starting");
        assertThat(cold.page(LogFixtures.query()).sourceStatus()).isEqualTo("starting");
        Files.writeString(dir.resolve("manifest.json"), "{broken");
        cold.refresh();
        assertThat(cold.page(LogFixtures.query()).sourceStatus()).isEqualTo("starting");
    }

    @Test void coldMissingCorruptAndUnreadableManifestsReturnNullableStartingSnapshots() throws Exception {
        Files.delete(dir.resolve("manifest.json"));
        for (int state = 0; state < 3; state++) {
            if (state == 1) Files.writeString(dir.resolve("manifest.json"), "{broken");
            if (state == 2) {
                Files.delete(dir.resolve("manifest.json"));
                Files.createDirectory(dir.resolve("manifest.json"));
            }
            var cold = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 1000, 10);
            cold.refresh();
            var status = cold.status(2, clock.instant());
            assertThat(status.sourceStatus()).isEqualTo("starting");
            assertThat(status.generation()).isNull();
            assertThat(status.coverageStart()).isNull();
            assertThat(status.headCursor()).isNull();
            assertThat(status.oldestCursor()).isNull();
            assertThat(status.activeStreams()).isEqualTo(2);
            assertThat(status.accountBlockedUntil()).isEqualTo(clock.instant());
            var snapshot = cold.page(LogFixtures.query());
            assertThat(snapshot.sourceStatus()).isEqualTo("starting");
            assertThat(snapshot.generation()).isNull();
            assertThat(snapshot.coverageStart()).isNull();
            assertThat(snapshot.headCursor()).isNull();
            assertThat(snapshot.oldestCursor()).isNull();
            assertThat(snapshot.nextBefore()).isNull();
            assertThat(snapshot.nextAfter()).isNull();
            assertThat(snapshot.lastSourceContactAt()).isNull();
            assertThat(snapshot.lastEventAt()).isNull();
            assertThat(snapshot.policyVersion()).isNull();
            assertThat(snapshot.omittedCount()).isZero();
            assertThat(snapshot.entries()).isEmpty();
            assertThat(snapshot.hasMoreBefore()).isFalse();
            assertThat(snapshot.hasMoreAfter()).isFalse();
            assertThat(LogFixtures.MAPPER.writeValueAsString(snapshot)).doesNotContain("unavailable");
        }
    }

    @Test void aRootReachedThroughASymlinkedParentIsRejectedEvenWhenItPointsAtValidFiles() throws Exception {
        // like macOS /var -> private/var: the root itself is a plain directory, but one parent in its path is a symlink
        Path parentLink = dir.resolveSibling(dir.getFileName() + "-parent-link");
        Files.createSymbolicLink(parentLink, dir.toRealPath().getParent());
        try {
            var properties = LogFixtures.properties(dir);
            properties.setDir(parentLink.resolve(dir.getFileName()).toString());
            var viaLink = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 1000, 10);
            viaLink.refresh();
            var cold = viaLink.page(LogFixtures.query());
            assertThat(cold.entries()).isEmpty();
            assertThat(cold.sourceStatus()).isEqualTo("starting");
            assertThat(cold.generation()).isNull();
            // the same files through the canonical path are served
            assertThat(store.page(LogFixtures.query("limit", "2")).entries()).hasSize(2);
        } finally {
            Files.deleteIfExists(parentLink);
        }
    }

    @Test void symlinksAndInvalidManifestSchemaAreRejected() throws Exception {
        Files.delete(dir.resolve(LogFixtures.FILE));
        Files.createSymbolicLink(dir.resolve(LogFixtures.FILE), dir.resolve("manifest.json"));
        var cold = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 1000, 10);
        cold.refresh();
        assertThatThrownBy(() -> cold.page(LogFixtures.query())).isInstanceOf(LogsException.class);
        var manifest = LogFixtures.manifest(dir);
        manifest.put("version", 2);
        LogFixtures.manifest(dir, manifest);
        cold.refresh();
        assertThat(cold.status(0, null).sourceStatus()).isEqualTo("disconnected");
    }

    @Test void deletedSegmentsShortenWindowAndDisabledStoreNeverOpensSource() throws Exception {
        Files.delete(dir.resolve(LogFixtures.FILE));
        store.refresh();
        assertThat(store.size()).isZero();
        assertThat(store.status(0, null).retentionTruncated()).isTrue();
        var properties = LogFixtures.properties(dir);
        properties.setEnabled(false);
        var disabled = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 1000, 10);
        disabled.refresh();
        assertThat(disabled.status(0, null).generation()).isNull();
    }

    @Test void rejectsAllInvalidQueriesAndCursors() {
        for (String[] pair : new String[][]{{"other", "x"}, {"limit", "0"}, {"limit", "151"}, {"levels", "DEBUG"},
                {"traceId", "bad"}, {"after", "../path"}, {"after", "g7:9223372036854775808"}, {"q", "x".repeat(121)}}) {
            assertThatThrownBy(() -> LogFixtures.query(pair)).isInstanceOf(LogsException.class);
        }
        assertThatThrownBy(() -> LogFixtures.query("before", "g7:1", "after", "g7:2")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> LogsQuery.parse(Map.of(), "q=" + "x".repeat(2048), false, null)).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> LogsQuery.parse(Map.of("q", new String[]{"a", "b"}), null, false, null)).isInstanceOf(LogsException.class);
        for (String cursor : new String[]{"g8:3", "g7:4"}) {
            assertThatThrownBy(() -> store.page(LogFixtures.query("after", cursor))).isInstanceOf(LogsException.class);
        }
    }

    @Test void collectorFixtureIsCompatibleWithTheSharedSchema() throws Exception {
        Path collector = Files.createDirectory(dir.resolve("collector"));
        for (String file : java.util.List.of("manifest.json", "seg-g7-000001.ndjson", "seg-g7-000002.ndjson")) {
            try (var input = getClass().getResourceAsStream("/infra-logs/collector/" + file)) {
                Files.copy(input, collector.resolve(file));
            }
        }
        var fixtureClock = java.time.Clock.fixed(java.time.Instant.parse("2026-01-01T12:35:00Z"), java.time.ZoneOffset.UTC);
        var reader = new SanitizedLogStore(LogFixtures.properties(collector), LogFixtures.MAPPER, fixtureClock, 10000, 10);
        reader.refresh();
        assertThat(reader.page(LogFixtures.query()).entries()).hasSize(2);
        assertThat(reader.page(LogFixtures.query()).sourceStatus()).isEqualTo("disconnected");
    }

    @Test void invalidEventsAndOversizedLinesAreDrainedWithoutLeakingTheirFields() throws Exception {
        var invalid = (com.fasterxml.jackson.databind.node.ObjectNode) LogFixtures.MAPPER.readTree(LogFixtures.event(2, "WARN", "Synthetic"));
        invalid.put("spanId", "invalid");
        String content = LogFixtures.event(1, "INFO", "Valid") + "\n" + invalid + "\n"
                + "x".repeat(9000) + LogFixtures.event(2, "WARN", "Suffix must not become an event") + "\n"
                + LogFixtures.event(3, "DEBUG", "Hidden") + "\n";
        Files.writeString(dir.resolve(LogFixtures.FILE), content);
        var reader = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 10000, 10);
        reader.refresh();
        assertThat(reader.page(LogFixtures.query()).entries()).extracting(LogsDto.Entry::id).containsExactly("g7:1");
    }

    @Test void tailAheadOfManifestWaitsUntilTheManifestPublishesItsSequence() throws Exception {
        Files.writeString(dir.resolve(LogFixtures.FILE), LogFixtures.event(4, "INFO", "Awaiting manifest") + "\n",
                java.nio.file.StandardOpenOption.APPEND);
        store.refresh();
        assertThat(store.page(LogFixtures.query()).headCursor()).isEqualTo("g7:3");
        var manifest = LogFixtures.manifest(dir);
        manifest.put("headSeq", 4);
        ((com.fasterxml.jackson.databind.node.ObjectNode) manifest.withArray("segments").get(0)).put("lastSeq", 4);
        LogFixtures.manifest(dir, manifest);
        store.refresh();
        store.refresh();
        assertThat(store.page(LogFixtures.query()).entries()).hasSize(4);
        assertThat(store.page(LogFixtures.query()).headCursor()).isEqualTo("g7:4");
    }
}
