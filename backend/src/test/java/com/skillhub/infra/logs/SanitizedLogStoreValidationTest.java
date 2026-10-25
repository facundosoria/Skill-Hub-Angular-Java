package com.skillhub.infra.logs;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Consumer;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Validacion estricta del manifiesto y de cada evento: cualquier campo fuera
 * de contrato deja la fuente cerrada o descarta solo ese evento.
 */
class SanitizedLogStoreValidationTest {
    @TempDir Path dir;
    LogFixtures.MutableClock clock;

    @BeforeEach void setup() throws Exception {
        LogFixtures.copy(dir);
        clock = new LogFixtures.MutableClock();
    }

    private SanitizedLogStore store() {
        return new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
    }

    private SanitizedLogStore refreshed() {
        SanitizedLogStore store = store();
        store.refresh();
        return store;
    }

    private static ObjectNode segment(ObjectNode manifest, int index) {
        return (ObjectNode) manifest.withArray("segments").get(index);
    }

    static Stream<Arguments> invalidManifests() {
        return Stream.<Arguments>of(
                Arguments.of("version distinta", (Consumer<ObjectNode>) m -> m.put("version", 2)),
                Arguments.of("version decimal", (Consumer<ObjectNode>) m -> m.put("version", 1.5)),
                Arguments.of("version negativa", (Consumer<ObjectNode>) m -> m.put("version", -1)),
                Arguments.of("otro servicio", (Consumer<ObjectNode>) m -> m.put("service", "otro")),
                Arguments.of("servicio no textual", (Consumer<ObjectNode>) m -> m.put("service", 7)),
                Arguments.of("otra politica", (Consumer<ObjectNode>) m -> m.put("policyVersion", "r1")),
                Arguments.of("generacion invalida", (Consumer<ObjectNode>) m -> m.put("generation", "g/7")),
                Arguments.of("generacion muy larga", (Consumer<ObjectNode>) m -> m.put("generation", "g".repeat(65))),
                Arguments.of("estado desconocido", (Consumer<ObjectNode>) m -> m.put("sourceStatus", "rara")),
                Arguments.of("texto con control", (Consumer<ObjectNode>) m -> m.put("sourceStatus", "heal\u0001thy")),
                Arguments.of("heartbeat ausente", (Consumer<ObjectNode>) m -> m.remove("heartbeatAt")),
                Arguments.of("heartbeat nulo", (Consumer<ObjectNode>) m -> m.putNull("heartbeatAt")),
                Arguments.of("heartbeat sin formato", (Consumer<ObjectNode>) m -> m.put("heartbeatAt", "ayer")),
                Arguments.of("oldest mayor que head", (Consumer<ObjectNode>) m -> m.put("oldestSeq", 9)),
                Arguments.of("retencion no booleana", (Consumer<ObjectNode>) m -> m.put("retentionTruncated", "no")),
                Arguments.of("sin segmentos", (Consumer<ObjectNode>) m -> m.remove("segments")),
                Arguments.of("segmentos no lista", (Consumer<ObjectNode>) m -> m.put("segments", "x")),
                Arguments.of("demasiados segmentos", (Consumer<ObjectNode>) m -> {
                    ArrayNode segments = m.putArray("segments");
                    for (int i = 0; i < 513; i++) segments.addObject();
                }),
                Arguments.of("archivo de otra generacion", (Consumer<ObjectNode>) m -> segment(m, 0).put("file", "seg-g8-000001.ndjson")),
                Arguments.of("archivo repetido", (Consumer<ObjectNode>) m -> {
                    segment(m, 0).put("lastSeq", 1);
                    m.withArray("segments").addObject().put("file", LogFixtures.FILE).put("firstSeq", 2).put("lastSeq", 3).put("closed", false);
                }),
                Arguments.of("firstSeq cero", (Consumer<ObjectNode>) m -> segment(m, 0).put("firstSeq", 0)),
                Arguments.of("segmentos superpuestos", (Consumer<ObjectNode>) m -> {
                    segment(m, 0).put("lastSeq", 2);
                    m.withArray("segments").addObject().put("file", "seg-g7-000002.ndjson").put("firstSeq", 2).put("lastSeq", 3).put("closed", false);
                }),
                Arguments.of("lastSeq menor que firstSeq", (Consumer<ObjectNode>) m -> segment(m, 0).put("firstSeq", 3).put("lastSeq", 2)),
                Arguments.of("lastSeq mayor que head", (Consumer<ObjectNode>) m -> segment(m, 0).put("lastSeq", 4)),
                Arguments.of("closed no booleano", (Consumer<ObjectNode>) m -> segment(m, 0).put("closed", "no")));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidManifests")
    void rejectsManifestsOutsideTheContract(String name, Consumer<ObjectNode> change) throws Exception {
        ObjectNode manifest = LogFixtures.manifest(dir);
        change.accept(manifest);
        LogFixtures.manifest(dir, manifest);

        SanitizedLogStore store = refreshed();

        assertThat(store.status(0, null).sourceStatus()).isEqualTo("starting");
        assertThat(store.size()).isZero();
    }

    @Test void rejectsAManifestThatIsNotAnObject() throws Exception {
        Files.writeString(dir.resolve("manifest.json"), "[1,2]");
        assertThat(refreshed().status(0, null).sourceStatus()).isEqualTo("starting");
        Files.writeString(dir.resolve("manifest.json"), "null");
        assertThat(refreshed().status(0, null).sourceStatus()).isEqualTo("starting");
    }

    @Test void rejectsAManifestLargerThanTheLimit() throws Exception {
        ObjectNode manifest = LogFixtures.manifest(dir);
        manifest.put("padding", "x".repeat(300 * 1024));
        LogFixtures.manifest(dir, manifest);

        assertThat(refreshed().status(0, null).sourceStatus()).isEqualTo("starting");
    }

    @Test void acceptsNullableInstantsAndAnEmptyHead() throws Exception {
        ObjectNode manifest = LogFixtures.manifest(dir);
        manifest.putNull("lastSourceContactAt").putNull("lastEventAt");
        LogFixtures.manifest(dir, manifest);

        SanitizedLogStore store = refreshed();

        assertThat(store.status(0, null).sourceStatus()).isEqualTo("healthy");
        assertThat(store.page(LogFixtures.query()).lastEventAt()).isNull();
    }

    @Test void aShrinkingHeadInTheSameGenerationDisconnectsTheSource() throws Exception {
        SanitizedLogStore store = refreshed();
        ObjectNode manifest = LogFixtures.manifest(dir);
        manifest.put("headSeq", 2);
        segment(manifest, 0).put("lastSeq", 2);
        LogFixtures.manifest(dir, manifest);

        store.refresh();

        assertThat(store.status(0, null).sourceStatus()).isEqualTo("disconnected");
        assertThat(store.size()).isEqualTo(3);
    }

    @Test void aStaleHeartbeatReportsADisconnectedSource() {
        SanitizedLogStore store = refreshed();
        clock.advance(31);

        assertThat(store.status(2, null).sourceStatus()).isEqualTo("disconnected");
        assertThat(store.status(2, null).activeStreams()).isEqualTo(2);
    }

    @Test void anOversizedSegmentIsRejected() throws Exception {
        Files.write(dir.resolve(LogFixtures.FILE), new byte[2 * 1024 * 1024 + SanitizedLogStore.MAX_LINE_BYTES + 1]);

        SanitizedLogStore store = refreshed();

        assertThat(store.size()).isZero();
        assertThat(store.status(0, null).sourceStatus()).isEqualTo("disconnected");
    }

    @Test void aTruncatedSegmentIsTreatedAsReplacedAndFailsClosed() throws Exception {
        SanitizedLogStore store = refreshed();
        Files.writeString(dir.resolve(LogFixtures.FILE), "");

        store.refresh();

        assertThat(store.status(0, null).sourceStatus()).isEqualTo("disconnected");
    }

    static Stream<Arguments> invalidEvents() {
        return Stream.<Arguments>of(
                Arguments.of("no es objeto", (Consumer<ObjectNode>) e -> e.removeAll()),
                Arguments.of("otra politica", (Consumer<ObjectNode>) e -> e.put("policyVersion", "r1")),
                Arguments.of("nivel desconocido", (Consumer<ObjectNode>) e -> e.put("level", "DEBUG")),
                Arguments.of("timestamp futuro", (Consumer<ObjectNode>) e -> e.put("timestamp", "2026-10-14T06:53:00Z")),
                Arguments.of("timestamp invalido", (Consumer<ObjectNode>) e -> e.put("timestamp", "no")),
                Arguments.of("trace corto", (Consumer<ObjectNode>) e -> e.put("traceId", "abc")),
                Arguments.of("span corto", (Consumer<ObjectNode>) e -> e.put("spanId", "abc")),
                Arguments.of("status bajo", (Consumer<ObjectNode>) e -> e.put("status", 99)),
                Arguments.of("status alto", (Consumer<ObjectNode>) e -> e.put("status", 600)),
                Arguments.of("status no entero", (Consumer<ObjectNode>) e -> e.put("status", "200")),
                Arguments.of("sin logger", (Consumer<ObjectNode>) e -> e.remove("logger")),
                Arguments.of("mensaje largo", (Consumer<ObjectNode>) e -> e.put("message", "m".repeat(2049))),
                Arguments.of("metodo largo", (Consumer<ObjectNode>) e -> e.put("method", "M".repeat(17))));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidEvents")
    void dropsOnlyTheInvalidEvent(String name, Consumer<ObjectNode> change) throws Exception {
        ObjectNode bad = (ObjectNode) LogFixtures.MAPPER.readTree(LogFixtures.event(2, "INFO", "malo"));
        change.accept(bad);
        Files.writeString(dir.resolve(LogFixtures.FILE), LogFixtures.event(1, "INFO", "uno") + "\n"
                + LogFixtures.MAPPER.writeValueAsString(bad) + "\n" + LogFixtures.event(3, "INFO", "tres") + "\n");

        SanitizedLogStore store = refreshed();

        assertThat(store.page(LogFixtures.query()).entries()).extracting(LogsDto.Entry::id).containsExactly("g7:1", "g7:3");
    }

    @Test void dropsInvalidUtf8AndEventsBeforeTheSegment() throws Exception {
        byte[] invalid = {(byte) 0xC3, (byte) 0x28, '\n'};
        ObjectNode manifest = LogFixtures.manifest(dir);
        segment(manifest, 0).put("firstSeq", 2);
        LogFixtures.manifest(dir, manifest);
        Files.write(dir.resolve(LogFixtures.FILE), concat(invalid,
                (LogFixtures.event(1, "INFO", "antes") + "\n" + LogFixtures.event(2, "INFO", "dos") + "\n").getBytes(StandardCharsets.UTF_8)));

        SanitizedLogStore store = refreshed();

        assertThat(store.page(LogFixtures.query()).entries()).extracting(LogsDto.Entry::id).containsExactly("g7:2");
    }

    @Test void keepsOptionalFieldsNullWhenAbsent() throws Exception {
        ObjectNode event = (ObjectNode) LogFixtures.MAPPER.readTree(LogFixtures.event(1, "INFO", "solo"));
        for (String field : new String[]{"traceId", "spanId", "method", "route", "status", "durationMs", "reason"}) event.remove(field);
        Files.writeString(dir.resolve(LogFixtures.FILE), LogFixtures.MAPPER.writeValueAsString(event) + "\n");
        ObjectNode manifest = LogFixtures.manifest(dir);
        manifest.put("headSeq", 1);
        segment(manifest, 0).put("lastSeq", 1);
        LogFixtures.manifest(dir, manifest);

        LogsDto.Entry entry = refreshed().page(LogFixtures.query()).entries().getFirst();

        assertThat(entry.traceId()).isNull();
        assertThat(entry.status()).isNull();
        assertThat(entry.method()).isNull();
    }

    @Test void ignoresEventsOlderThanTheRetentionWindow() throws Exception {
        clock.advance(SanitizedLogStore.RETENTION_SECONDS + 10);
        ObjectNode manifest = LogFixtures.manifest(dir);
        manifest.put("heartbeatAt", clock.instant().toString());
        LogFixtures.manifest(dir, manifest);

        SanitizedLogStore store = refreshed();

        assertThat(store.size()).isZero();
    }

    @Test void validatesCursorsAgainstGenerationHeadAndOldest() {
        SanitizedLogStore store = refreshed();

        assertThatThrownBy(() -> store.page(LogFixtures.query("after", "g8:1"))).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> store.page(LogFixtures.query("after", "g7:9"))).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> store.page(LogFixtures.query("after", "g7:3", "through", "g7:2"))).isInstanceOf(LogsException.class);
        assertThat(store.page(LogFixtures.query("after", "g7:0")).entries()).hasSize(3);
    }

    @Test void rejectsCursorsBelowTheOldestRetainedEvent() throws Exception {
        ObjectNode manifest = LogFixtures.manifest(dir);
        manifest.put("oldestSeq", 2);
        LogFixtures.manifest(dir, manifest);
        SanitizedLogStore store = refreshed();

        assertThat(store.size()).isEqualTo(2);
        assertThatThrownBy(() -> store.page(LogFixtures.query("after", "g7:0"))).isInstanceOf(LogsException.class);
    }

    @Test void aColdStoreRejectsCursorsButAnswersPlainSnapshots() {
        SanitizedLogStore store = store();

        assertThatThrownBy(() -> store.page(LogFixtures.query("before", "g7:2"))).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> store.page(LogFixtures.query("after", "g7:1"))).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> store.page(LogFixtures.query("through", "g7:1"))).isInstanceOf(LogsException.class);
        assertThat(store.page(LogFixtures.query()).sourceStatus()).isEqualTo("starting");
    }

    @Test void anEmptyRangeReturnsNoEntries() {
        SanitizedLogStore store = refreshed();

        var page = store.page(LogFixtures.query("before", "g7:1"));

        assertThat(page.entries()).isEmpty();
        assertThat(page.hasMoreBefore()).isFalse();
    }

    @Test void atWithoutMatchesPointsAtTheWindowEdges() {
        SanitizedLogStore store = refreshed();

        var page = store.page(LogFixtures.query("at", "2026-10-14T06:50:58Z", "q", "nada-coincide"));

        assertThat(page.entries()).isEmpty();
        assertThat(page.nextBefore()).isEqualTo("g7:1");
        assertThat(page.nextAfter()).isEqualTo("g7:3");
        assertThat(page.hasMoreAfter()).isFalse();
    }

    @Test void atReportsMoreAfterWhenThePageIsFull() {
        var page = refreshed().page(LogFixtures.query("at", "2026-10-14T06:50:57Z", "limit", "1"));

        assertThat(page.entries()).extracting(LogsDto.Entry::id).containsExactly("g7:1");
        assertThat(page.hasMoreAfter()).isTrue();
        assertThat(page.hasMoreBefore()).isFalse();
    }

    @Test void replayReturnsEntriesAfterTheCursorUpToTheMaximum() {
        SanitizedLogStore store = refreshed();

        var replay = store.replay(new LogsQuery.Cursor("g7", 1), 1);

        assertThat(replay.generation()).isEqualTo("g7");
        assertThat(replay.head()).isEqualTo(3);
        assertThat(replay.entries()).extracting(SanitizedLogStore.Stored::seq).containsExactly(2L);
        assertThat(store.replay(new LogsQuery.Cursor("g7", 0), 10).entries()).hasSize(3);
    }

    @Test void replayFailsWhenTheSourceWasNeverAvailable() {
        assertThatThrownBy(() -> store().replay(new LogsQuery.Cursor("g7", 0), 10)).isInstanceOf(LogsException.class);
    }

    @Test void capacityLimitsTruncateTheRingAndMoveTheCoverageStart() {
        SanitizedLogStore store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 1);
        store.refresh();

        var status = store.status(0, null);

        assertThat(store.size()).isEqualTo(1);
        assertThat(status.retentionTruncated()).isTrue();
        assertThat(status.coverageStart()).isEqualTo(java.time.Instant.parse("2026-10-14T06:50:59.042Z"));
    }

    @Test void startsAndStopsTheBackgroundReaderOnlyWhenEnabled() throws Exception {
        SanitizedLogStore enabled = store();
        enabled.start();
        for (int i = 0; i < 100 && enabled.size() == 0; i++) Thread.sleep(20);
        enabled.stop();
        assertThat(enabled.size()).isEqualTo(3);

        InfraLogsProperties off = LogFixtures.properties(dir);
        off.setEnabled(false);
        SanitizedLogStore disabled = new SanitizedLogStore(off, LogFixtures.MAPPER, clock, 1000, 10);
        disabled.start();
        disabled.stop();
        disabled.refresh();
        assertThat(disabled.size()).isZero();
    }

    @Test void theProductionConstructorUsesTheDefaultLimits() {
        SanitizedLogStore store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER);
        store.refresh();

        // Con el reloj real los eventos de prueba ya estan fuera de la ventana de seis horas.
        assertThat(store.size()).isZero();
        assertThat(store.status(0, null).generation()).isEqualTo("g7");
        assertThat(store.status(0, null).sourceStatus()).isEqualTo("disconnected");
    }

    private static byte[] concat(byte[] first, byte[] second) {
        byte[] out = new byte[first.length + second.length];
        System.arraycopy(first, 0, out, 0, first.length);
        System.arraycopy(second, 0, out, first.length, second.length);
        return out;
    }
}
