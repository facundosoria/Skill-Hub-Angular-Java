package com.skillhub.infra.logs;

import com.skillhub.session.AuthPrincipalResolver;
import com.skillhub.session.CurrentUser;
import com.skillhub.session.PasswordChangeInterceptor;
import com.skillhub.session.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Exercises real MVC routing, existing session resolver/interceptor and the localized filter/advice. */
class InfraLogsControllerIntegrationTest {
    @TempDir Path dir;
    MockMvc mvc;
    SessionService sessions;
    SanitizedLogStore store;
    InfraLogStreams streams;
    InfraLogsProperties properties;
    LogsAccessLimiter limiter;
    LogFixtures.MutableClock clock;
    final CurrentUser user = new CurrentUser("synthetic-account", "student", "Student", "Team", "user", false);

    @BeforeEach void setup() throws Exception {
        LogFixtures.copy(dir);
        properties = LogFixtures.properties(dir);
        clock = new LogFixtures.MutableClock();
        store = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        store.refresh();
        sessions = mock(SessionService.class);
        when(sessions.getCurrentUser(any(HttpServletRequest.class))).thenReturn(user);
        limiter = new LogsAccessLimiter(clock);
        streams = new InfraLogStreams(properties, store, limiter, sessions, LogFixtures.MAPPER, clock,
                () -> new org.springframework.web.servlet.mvc.method.annotation.SseEmitter(900_000L));
        mvc = MockMvcBuilders.standaloneSetup(new InfraLogsController(store, streams, limiter, properties))
                .setCustomArgumentResolvers(new AuthPrincipalResolver(sessions))
                .addInterceptors(new PasswordChangeInterceptor(sessions))
                .setControllerAdvice(new LogsExceptionHandler())
                .addFilters(new LogsRequestFilter(properties, LogFixtures.MAPPER)).build();
    }

    @AfterEach void cleanup() { streams.stop(); }

    @Test void snapshotAndBeforeAfterPagesReturnOnlyContractFields() throws Exception {
        mvc.perform(get(LogsRequestFilter.BASE).param("limit", "2"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", LogsRequestFilter.CACHE_CONTROL))
                .andExpect(jsonPath("$.entries.length()").value(2)).andExpect(jsonPath("$.entries[0].id").value("g7:2"))
                .andExpect(jsonPath("$.headCursor").value("g7:3")).andExpect(jsonPath("$.entries[0].unexpected").doesNotExist());
        mvc.perform(get(LogsRequestFilter.BASE).param("before", "g7:2").param("through", "g7:3"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.entries[0].id").value("g7:1"));
        mvc.perform(get(LogsRequestFilter.BASE).param("after", "g7:1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.nextAfter").value("g7:3"));
        mvc.perform(get(LogsRequestFilter.BASE + "/status"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sourceStatus").value("healthy"))
                .andExpect(jsonPath("$.entries").doesNotExist());
    }

    @Test void missingSessionIs401AndPasswordChangeIs403WithSafeErrorBodies() throws Exception {
        when(sessions.getCurrentUser(any(HttpServletRequest.class))).thenReturn(null);
        mvc.perform(get(LogsRequestFilter.BASE)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED")).andExpect(jsonPath("$.message").exists());
        when(sessions.getCurrentUser(any(HttpServletRequest.class)))
                .thenReturn(new CurrentUser(user.id(), "student", "Student", "Team", "user", true));
        mvc.perform(get(LogsRequestFilter.BASE).servletPath(LogsRequestFilter.BASE))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_REQUIRED"));
    }

    @Test void badQueryIs400AndUnavailableCursorIs409() throws Exception {
        mvc.perform(get(LogsRequestFilter.BASE).param("unknown", "synthetic"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_QUERY"));
        mvc.perform(get(LogsRequestFilter.BASE).param("after", "g8:1"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CURSOR_EXPIRED"));
        mvc.perform(get(LogsRequestFilter.BASE + "/status").param("q", "x")).andExpect(status().isBadRequest());
        mvc.perform(get(LogsRequestFilter.BASE + "/stream")).andExpect(status().isBadRequest());
    }

    @Test void jumpToInstantReturnsFilteredAscendingPageAndRejectsCursorCombination() throws Exception {
        mvc.perform(get(LogsRequestFilter.BASE).param("at", "2026-10-14T06:50:58Z").param("limit", "2"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.entries[0].id").value("g7:2"))
                .andExpect(jsonPath("$.entries[1].id").value("g7:3"));
        mvc.perform(get(LogsRequestFilter.BASE).param("at", "not-an-instant"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_QUERY"));
        mvc.perform(get(LogsRequestFilter.BASE).param("at", "2026-01-01T12:01:00Z").param("before", "g7:3"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_QUERY"));
        mvc.perform(get(LogsRequestFilter.BASE).param("at", "2026-01-01T12:01:00Z").param("through", "g7:3"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_QUERY"));
        mvc.perform(get(LogsRequestFilter.BASE).param("at", "2026-01-01T12:01:00Z").param("after", "g7:1"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_QUERY"));
    }

    @Test void accountQuotaIs429WithRetryAfterAndStatusReflectsBlocking() throws Exception {
        for (int i = 0; i < 5; i++) mvc.perform(get(LogsRequestFilter.BASE)).andExpect(status().isOk());
        mvc.perform(get(LogsRequestFilter.BASE)).andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "2")).andExpect(jsonPath("$.code").value("REQUEST_LIMIT"));
        org.assertj.core.api.Assertions.assertThat(limiter.blockedUntil(user.id())).isNotNull();
    }

    @Test void absentSourceSnapshotAndStatusReportStartingWithNullableCursors() throws Exception {
        Files.delete(dir.resolve("manifest.json"));
        var unavailable = new SanitizedLogStore(properties, LogFixtures.MAPPER, new LogFixtures.MutableClock(), 1000, 10);
        unavailable.refresh();
        mvc = MockMvcBuilders.standaloneSetup(new InfraLogsController(unavailable, streams, limiter, properties))
                .setCustomArgumentResolvers(new AuthPrincipalResolver(sessions)).setControllerAdvice(new LogsExceptionHandler())
                .addFilters(new LogsRequestFilter(properties, LogFixtures.MAPPER)).build();
        mvc.perform(get(LogsRequestFilter.BASE)).andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceStatus").value("starting"))
                .andExpect(jsonPath("$.headCursor").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.entries").isEmpty());
        mvc.perform(get(LogsRequestFilter.BASE + "/status")).andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceStatus").value("starting"))
                .andExpect(jsonPath("$.generation").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test void disabledEndpointsAre404BeforeAuthenticationAndReaderStaysDormant() throws Exception {
        properties.setEnabled(false);
        for (String suffix : new String[]{"", "/status", "/stream"}) {
            mvc.perform(get(LogsRequestFilter.BASE + suffix)).andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("LOGS_DISABLED"));
        }
        verifyNoInteractions(sessions);
        var dormant = new SanitizedLogStore(properties, LogFixtures.MAPPER, new LogFixtures.MutableClock(), 1000, 10);
        dormant.start();
        dormant.refresh();
        org.assertj.core.api.Assertions.assertThat(dormant.size()).isZero();
        org.assertj.core.api.Assertions.assertThat(dormant.status(0, null).generation()).isNull();
    }

    @Test void disabledControllersAlsoRejectRequestsWithoutTheFilter() throws Exception {
        properties.setEnabled(false);
        var guarded = MockMvcBuilders.standaloneSetup(new InfraLogsController(store, streams, limiter, properties))
                .setCustomArgumentResolvers(new AuthPrincipalResolver(sessions))
                .setControllerAdvice(new LogsExceptionHandler()).build();
        for (String suffix : new String[]{"", "/status", "/stream"}) {
            guarded.perform(get(LogsRequestFilter.BASE + suffix)).andExpect(status().isNotFound())
                    .andExpect(header().string("Cache-Control", LogsRequestFilter.CACHE_CONTROL))
                    .andExpect(jsonPath("$.code").value("LOGS_DISABLED"));
        }
    }

    @Test void streamUsesAsyncMvcAndLastEventIdBeforeAdmission() throws Exception {
        mvc.perform(get(LogsRequestFilter.BASE + "/stream").param("after", "g7:1").header("Last-Event-ID", "g7:3"))
                .andExpect(status().isOk()).andExpect(request().asyncStarted())
                .andExpect(header().string("X-Accel-Buffering", "no"))
                .andExpect(header().string("Cache-Control", LogsRequestFilter.CACHE_CONTROL));
        mvc.perform(get(LogsRequestFilter.BASE + "/stream").param("after", "g7:3").header("Last-Event-ID", "g9:1")
                        .accept("text/event-stream"))
                .andExpect(status().isConflict()).andExpect(content().contentType("application/json;charset=UTF-8"));
    }

    @Test void streamAppliesTheSameSanitizedFieldFiltersAsHistory() throws Exception {
        var result = mvc.perform(get(LogsRequestFilter.BASE + "/stream").param("after", "g7:1").param("status", "404")
                        .param("route", "EXAMPLE").param("method", "GET"))
                .andExpect(status().isOk()).andExpect(request().asyncStarted()).andReturn();
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(3)).untilAsserted(() ->
                org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentAsString())
                        .contains("\"id\":\"g7:2\"").doesNotContain("\"id\":\"g7:3\""));
        mvc.perform(get(LogsRequestFilter.BASE + "/stream").param("after", "g7:1").param("unknown", "x"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_QUERY"));
    }

    @Test void sseMvcSerializesReplayLiveKeepaliveAndRevocation() throws Exception {
        when(sessions.getCurrentUser("synthetic-token")).thenReturn(user);
        var result = mvc.perform(get(LogsRequestFilter.BASE + "/stream").param("after", "g7:1")
                        .cookie(new jakarta.servlet.http.Cookie("skillhub_session", "synthetic-token")))
                .andExpect(request().asyncStarted()).andReturn();
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(3)).untilAsserted(() ->
                org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentAsString()).contains("event:logs", "g7:2", "g7:3"));
        Files.writeString(dir.resolve(LogFixtures.FILE), LogFixtures.event(4, "INFO", "Live") + "\n", java.nio.file.StandardOpenOption.APPEND);
        var manifest = LogFixtures.manifest(dir);
        manifest.put("headSeq", 4);
        ((com.fasterxml.jackson.databind.node.ObjectNode) manifest.withArray("segments").get(0)).put("lastSeq", 4);
        LogFixtures.manifest(dir, manifest);
        store.refresh();
        streams.tick();
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(3)).untilAsserted(() ->
                org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentAsString()).contains("g7:4"));
        clock.advance(15);
        streams.tick();
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(3)).untilAsserted(() ->
                org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentAsString()).contains(":keepalive"));
        when(sessions.getCurrentUser("synthetic-token")).thenReturn(null);
        streams.revalidate();
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(3)).untilAsserted(() ->
                org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentAsString()).contains("event:access-revoked", "SESSION_INVALID"));
        org.assertj.core.api.Assertions.assertThat(limiter.activeStreams()).isZero();
    }

    @Test void sseMvcSerializesResetAfterGenerationChange() throws Exception {
        var result = mvc.perform(get(LogsRequestFilter.BASE + "/stream").param("after", "g7:3"))
                .andExpect(request().asyncStarted()).andReturn();
        var manifest = LogFixtures.manifest(dir);
        manifest.put("generation", "g8").put("headSeq", 1);
        ((com.fasterxml.jackson.databind.node.ObjectNode) manifest.withArray("segments").get(0))
                .put("file", "seg-g8-000001.ndjson").put("lastSeq", 1);
        Files.writeString(dir.resolve("seg-g8-000001.ndjson"), LogFixtures.event(1, "INFO", "Restart") + "\n");
        LogFixtures.manifest(dir, manifest);
        store.refresh();
        streams.tick();
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(3)).untilAsserted(() ->
                org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentAsString()).contains("event:reset", "CURSOR_EXPIRED"));
    }

    @Test void sseMvcSerializesGapWhenReplayExceedsItsBudget() throws Exception {
        LogFixtures.events(dir, 1002);
        var freshStore = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 32 * 1024 * 1024, 100_000);
        freshStore.refresh();
        streams.stop();
        streams = new InfraLogStreams(properties, freshStore, limiter, sessions, LogFixtures.MAPPER, clock,
                () -> new org.springframework.web.servlet.mvc.method.annotation.SseEmitter(900_000L));
        mvc = MockMvcBuilders.standaloneSetup(new InfraLogsController(freshStore, streams, limiter, properties))
                .setCustomArgumentResolvers(new AuthPrincipalResolver(sessions)).setControllerAdvice(new LogsExceptionHandler())
                .addFilters(new LogsRequestFilter(properties, LogFixtures.MAPPER)).build();
        var result = mvc.perform(get(LogsRequestFilter.BASE + "/stream").param("after", "g7:1"))
                .andExpect(request().asyncStarted()).andReturn();
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(3)).untilAsserted(() ->
                org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentAsString()).contains("event:gap", "REPLAY_LIMIT"));
    }
}
