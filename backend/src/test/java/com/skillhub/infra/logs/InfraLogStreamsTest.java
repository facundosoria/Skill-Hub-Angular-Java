package com.skillhub.infra.logs;

import com.skillhub.session.CurrentUser;
import com.skillhub.session.SessionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;

class InfraLogStreamsTest {
    @TempDir Path dir;
    LogFixtures.MutableClock clock;
    SanitizedLogStore store;
    LogsAccessLimiter limiter;
    SessionService sessions;
    InfraLogStreams streams;
    CopyOnWriteArrayList<CaptureEmitter> emitters;
    final CurrentUser user = new CurrentUser("synthetic-account", "student", "Student", "Team", "user", false);

    static class CaptureEmitter extends SseEmitter {
        final CopyOnWriteArrayList<String> frames = new CopyOnWriteArrayList<>();
        volatile boolean completed;
        @Override public void send(SseEventBuilder builder) {
            StringBuilder frame = new StringBuilder();
            builder.build().forEach(data -> frame.append(data.getData()));
            frames.add(frame.toString());
        }
        @Override public void complete() { completed = true; }
        String text() { return String.join("", frames); }
    }

    @BeforeEach void setup() throws Exception {
        LogFixtures.copy(dir);
        clock = new LogFixtures.MutableClock();
        var properties = LogFixtures.properties(dir);
        store = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        store.refresh();
        limiter = new LogsAccessLimiter(clock);
        sessions = mock(SessionService.class);
        when(sessions.getCurrentUser("synthetic-token")).thenReturn(user);
        emitters = new CopyOnWriteArrayList<>();
        streams = new InfraLogStreams(properties, store, limiter, sessions, LogFixtures.MAPPER, clock, () -> {
            CaptureEmitter emitter = new CaptureEmitter();
            emitters.add(emitter);
            return emitter;
        });
    }

    @AfterEach void cleanup() { streams.stop(); }

    private CaptureEmitter open(String after, String... filters) {
        Map<String, String[]> params = new java.util.HashMap<>();
        params.put("after", new String[]{after});
        for (int i = 0; i < filters.length; i += 2) params.put(filters[i], new String[]{filters[i + 1]});
        return (CaptureEmitter) streams.open(user, "synthetic-token", LogsQuery.parse(params, null, true, null));
    }

    @Test void replayLiveAndKeepaliveUseOneSharedSource() throws Exception {
        var emitter = open("g7:1");
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(emitter.text()).contains("retry:3000", "event:logs", "g7:2", "g7:3"));
        assertThat(emitter.text()).doesNotContain("synthetic-private-value", "unexpected");
        Files.writeString(dir.resolve(LogFixtures.FILE), LogFixtures.event(4, "INFO", "Live synthetic event") + "\n", java.nio.file.StandardOpenOption.APPEND);
        var manifest = LogFixtures.manifest(dir);
        manifest.put("headSeq", 4);
        ((com.fasterxml.jackson.databind.node.ObjectNode) manifest.withArray("segments").get(0)).put("lastSeq", 4);
        LogFixtures.manifest(dir, manifest);
        store.refresh();
        streams.tick();
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(emitter.text()).contains("g7:4", "Live synthetic event"));
        clock.advance(15);
        streams.tick();
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(emitter.text()).contains(":keepalive", "event:status"));
        assertThat(emitter.frames.stream().filter(frame -> frame.contains("event:logs"))).allSatisfy(frame -> {
            assertThat(frame.getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isLessThan(32 * 1024 + 100);
        });
    }

    @Test void nonMatchingEventsAdvanceOnlyThroughCheckpoint() {
        var emitter = open("g7:1", "q", "no match");
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(emitter.text()).contains("event:checkpoint", "id:g7:3"));
        assertThat(emitter.text()).doesNotContain("event:logs");
        int frames = emitter.frames.size();
        streams.tick();
        assertThat(emitter.frames.size()).isEqualTo(frames);
    }

    @Test void replayLimitEmitsGapAndReleasesAdmission() throws Exception {
        LogFixtures.events(dir, 1002);
        store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        store.refresh();
        streams.stop();
        streams = new InfraLogStreams(LogFixtures.properties(dir), store, limiter, sessions, LogFixtures.MAPPER, clock, CaptureEmitter::new);
        var emitter = open("g7:1");
        await().atMost(Duration.ofSeconds(3)).until(() -> emitter.completed);
        assertThat(emitter.text()).contains("event:gap", "REPLAY_LIMIT", "g7:1002");
        assertThat(limiter.activeStreams()).isZero();
    }

    @Test void generationChangeEmitsResetAndCloses() throws Exception {
        var emitter = open("g7:3");
        var manifest = LogFixtures.manifest(dir);
        manifest.put("generation", "g8").put("headSeq", 1);
        ((com.fasterxml.jackson.databind.node.ObjectNode) manifest.withArray("segments").get(0))
                .put("file", "seg-g8-000001.ndjson").put("lastSeq", 1);
        Files.writeString(dir.resolve("seg-g8-000001.ndjson"), LogFixtures.event(1, "INFO", "Restart") + "\n");
        LogFixtures.manifest(dir, manifest);
        store.refresh();
        streams.tick();
        await().atMost(Duration.ofSeconds(3)).until(() -> emitter.completed);
        assertThat(emitter.text()).contains("event:reset", "CURSOR_EXPIRED");
        assertThat(limiter.activeStreams()).isZero();
    }

    @Test void invalidSessionAndPasswordChangeRevokeStreams() {
        var emitter = open("g7:3");
        when(sessions.getCurrentUser("synthetic-token")).thenReturn(null);
        streams.revalidate();
        await().atMost(Duration.ofSeconds(3)).until(() -> emitter.completed);
        assertThat(emitter.text()).contains("event:access-revoked", "SESSION_INVALID");
        when(sessions.getCurrentUser("synthetic-token")).thenReturn(new CurrentUser(user.id(), "student", "Student", "Team", "user", true));
        var password = open("g7:3");
        streams.revalidate();
        await().atMost(Duration.ofSeconds(3)).until(() -> password.completed);
        assertThat(limiter.activeStreams()).isZero();
    }

    @Test void perAccountAndGlobalAdmissionAreBoundedAndRefillIsTimeBased() {
        open("g7:3");
        open("g7:3");
        assertThatThrownBy(() -> open("g7:3")).isInstanceOf(LogsException.class);
        assertThat(limiter.blockedUntil(user.id())).isNotNull();
        for (int i = 0; i < 98; i++) limiter.open("other-account-" + i);
        assertThatThrownBy(() -> limiter.open("overflow-account")).isInstanceOf(LogsException.class);
        assertThat(limiter.activeStreams()).isEqualTo(100);
        for (int i = 0; i < 5; i++) limiter.history("reader");
        assertThatThrownBy(() -> limiter.history("reader")).isInstanceOf(LogsException.class);
        clock.advance(2);
        assertThatCode(() -> limiter.history("reader")).doesNotThrowAnyException();
    }

    @Test void lastEventIdOverridesOriginalAfterAndMissingCursorIsInvalid() {
        var query = LogsQuery.parse(Map.of("after", new String[]{"g7:1"}), null, true, "g7:3");
        assertThat(query.after().toString()).isEqualTo("g7:3");
        assertThatThrownBy(() -> LogsQuery.parse(Map.of(), null, true, null)).isInstanceOf(LogsException.class);
    }

    @Test void slowConnectionQueueOverflowClosesWithGapAndReleasesItsSlot() throws Exception {
        LogFixtures.events(dir, 800);
        store = new SanitizedLogStore(LogFixtures.properties(dir), LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        store.refresh();
        streams.stop();
        var entered = new java.util.concurrent.CountDownLatch(1);
        var releaseWrite = new java.util.concurrent.CountDownLatch(1);
        CaptureEmitter emitter = new CaptureEmitter() {
            @Override public void send(SseEventBuilder builder) {
                entered.countDown();
                try { releaseWrite.await(5, java.util.concurrent.TimeUnit.SECONDS); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                super.send(builder);
            }
        };
        streams = new InfraLogStreams(LogFixtures.properties(dir), store, limiter, sessions, LogFixtures.MAPPER, clock, () -> emitter);
        open("g7:1");
        assertThat(entered.await(3, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        try {
            for (int i = 0; i < 7; i++) streams.tick();
        } finally { releaseWrite.countDown(); }
        await().atMost(Duration.ofSeconds(3)).until(() -> emitter.completed);
        assertThat(emitter.text()).contains("event:gap", "REPLAY_LIMIT");
        assertThat(limiter.activeStreams()).isZero();
    }

    @Test void expiredRetentionEmitsResetForAnOpenStream() throws Exception {
        var emitter = open("g7:1");
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(emitter.text()).contains("g7:3"));
        clock.advance(21601);
        var fresh = (com.fasterxml.jackson.databind.node.ObjectNode) LogFixtures.MAPPER.readTree(LogFixtures.event(4, "INFO", "Fresh"));
        fresh.put("timestamp", clock.instant().toString());
        Files.writeString(dir.resolve(LogFixtures.FILE), fresh + "\n", java.nio.file.StandardOpenOption.APPEND);
        var manifest = LogFixtures.manifest(dir);
        manifest.put("headSeq", 4).put("heartbeatAt", clock.instant().toString());
        ((com.fasterxml.jackson.databind.node.ObjectNode) manifest.withArray("segments").get(0)).put("lastSeq", 4);
        LogFixtures.manifest(dir, manifest);
        store.refresh();
        streams.revalidate();
        streams.tick();
        await().atMost(Duration.ofSeconds(3)).until(() -> emitter.completed);
        assertThat(emitter.text()).contains("event:reset");
    }

    @Test void missedSessionValidationDeadlineFailsClosedWithinThirtySeconds() {
        var emitter = open("g7:3");
        clock.advance(15);
        streams.tick();
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(emitter.text()).contains(":keepalive"));
        clock.advance(15);
        streams.tick();
        await().atMost(Duration.ofSeconds(3)).until(() -> emitter.completed);
        assertThat(emitter.text()).contains("event:access-revoked", "SESSION_INVALID");
        assertThat(limiter.activeStreams()).isZero();
    }

    @Test void revalidationFailuresAndOtherAccountsRevokeTheStream() {
        var failing = open("g7:3");
        when(sessions.getCurrentUser("synthetic-token")).thenThrow(new IllegalStateException("sesiones caidas"));
        streams.revalidate();
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(failing.text()).contains("event:access-revoked"));

        reset(sessions);
        when(sessions.getCurrentUser("synthetic-token")).thenReturn(new CurrentUser("otra-cuenta", "x", "X", "Team", "user", false));
        var other = open("g7:3");
        streams.revalidate();
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(other.text()).contains("event:access-revoked"));

        // Las conexiones ya liberadas no se vuelven a validar.
        streams.revalidate();
    }

    @Test void theSchedulerStartsOnlyWhenEnabled() {
        var disabledProperties = LogFixtures.properties(dir);
        disabledProperties.setEnabled(false);
        var disabled = new InfraLogStreams(disabledProperties, store, limiter, sessions, LogFixtures.MAPPER, clock, CaptureEmitter::new);
        disabled.start();
        disabled.stop();

        streams.start();
        var emitter = open("g7:1");
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(emitter.text()).contains("g7:3"));
        streams.stop();
        assertThat(limiter.activeStreams()).isZero();
    }
}
