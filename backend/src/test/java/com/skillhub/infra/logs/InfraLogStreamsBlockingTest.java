package com.skillhub.infra.logs;

import com.skillhub.session.CurrentUser;
import com.skillhub.session.SessionService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.converter.StringHttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.async.DeferredResult;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Uses the installed Spring MVC handler and a genuinely blocking transport flush. */
class InfraLogStreamsBlockingTest {
    @TempDir Path dir;
    final CurrentUser user = new CurrentUser("synthetic-account", "student", "Student", "Team", "user", false);

    static class BlockingResponse implements org.springframework.http.server.ServerHttpResponse {
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch unblock = new CountDownLatch(1);
        final ByteArrayOutputStream body = new ByteArrayOutputStream();
        final org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        final boolean blocking;
        BlockingResponse(boolean blocking) { this.blocking = blocking; }
        @Override public void setStatusCode(org.springframework.http.HttpStatusCode status) {}
        @Override public org.springframework.http.HttpHeaders getHeaders() { return headers; }
        @Override public OutputStream getBody() { return body; }
        @Override public void flush() throws IOException {
            entered.countDown();
            if (blocking) {
                try {
                    if (!unblock.await(10, TimeUnit.SECONDS)) throw new IOException("Synthetic transport timeout");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Synthetic transport interrupted");
                }
            }
        }
        @Override public void close() {}
    }

    private SseEmitter emitter(BlockingResponse response, DeferredResult<Object> result) throws Exception {
        // Exercise Spring 6.2.1's actual complete/completeWithError implementations.
        Class<?> handlerType = Class.forName("org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitterReturnValueHandler$DefaultSseEmitterHandler");
        var constructor = handlerType.getDeclaredConstructors()[0];
        constructor.setAccessible(true);
        Object handler = constructor.newInstance(List.of(new StringHttpMessageConverter()), null, response, result);
        SseEmitter emitter = new SseEmitter(900_000L);
        var initialize = ResponseBodyEmitter.class.getDeclaredMethod("initialize", Class.forName("org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter$Handler"));
        initialize.setAccessible(true);
        initialize.invoke(emitter, handler);
        return emitter;
    }

    @Test void stalledFlushDoesNotBlockTickOrOtherClientsHeartbeats() throws Exception {
        LogFixtures.copy(dir);
        var clock = new LogFixtures.MutableClock();
        var properties = LogFixtures.properties(dir);
        var store = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 10000, 10);
        store.refresh();
        var limiter = new LogsAccessLimiter(clock);
        var slow = new BlockingResponse(true);
        var fast = new BlockingResponse(false);
        var slowResult = new DeferredResult<Object>();
        var slowEmitter = emitter(slow, slowResult);
        var fastEmitter = emitter(fast, new DeferredResult<>());
        var count = new AtomicInteger();
        var sessions = mock(SessionService.class);
        when(sessions.getCurrentUser("synthetic-token")).thenReturn(user);
        var streams = new InfraLogStreams(properties, store, limiter, sessions, LogFixtures.MAPPER,
                clock, () -> count.getAndIncrement() == 0 ? slowEmitter : fastEmitter);
        var publisher = Executors.newSingleThreadExecutor();
        try {
            streams.open(user, "synthetic-token", LogFixtures.query("after", "g7:3"));
            assertThat(slow.entered.await(3, TimeUnit.SECONDS)).isTrue();
            streams.open(user, "synthetic-token", LogFixtures.query("after", "g7:3"));
            await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(fast.body.toString()).contains("event:status"));
            clock.advance(16);
            publisher.submit(streams::tick).get(1, TimeUnit.SECONDS);
            assertThat(slow.unblock.getCount()).isEqualTo(1);
            assertThat(slowResult.getResult()).isInstanceOf(Throwable.class);
            assertThat(limiter.activeStreams()).isEqualTo(1);
            await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(fast.body.toString()).contains(":keepalive"));
            // The next scheduled publication can still deliver another heartbeat.
            clock.advance(15);
            streams.revalidate();
            publisher.submit(streams::tick).get(1, TimeUnit.SECONDS);
            await().atMost(Duration.ofSeconds(3)).untilAsserted(() ->
                    assertThat(fast.body.toString().split(":keepalive", -1)).hasSize(3));
        } finally {
            slow.unblock.countDown();
            publisher.shutdownNow();
            streams.stop();
        }
    }

    @Test void rejectedSenderClosesWithoutFlushingOnTheCallingThread() throws Exception {
        LogFixtures.copy(dir);
        var clock = new LogFixtures.MutableClock();
        var properties = LogFixtures.properties(dir);
        var store = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 10000, 10);
        store.refresh();
        var limiter = new LogsAccessLimiter(clock);
        var transport = new BlockingResponse(true);
        var result = new DeferredResult<Object>();
        var emitter = emitter(transport, result);
        var streams = new InfraLogStreams(properties, store, limiter, mock(SessionService.class), LogFixtures.MAPPER, clock, () -> emitter);
        ((ThreadPoolExecutor) ReflectionTestUtils.getField(streams, "senders")).shutdown();
        var caller = Executors.newSingleThreadExecutor();
        try {
            caller.submit(() -> streams.open(user, "synthetic-token", LogFixtures.query("after", "g7:3"))).get(1, TimeUnit.SECONDS);
            assertThat(result.getResult()).isInstanceOf(Throwable.class);
            assertThat(transport.entered.getCount()).isEqualTo(1);
            assertThat(limiter.activeStreams()).isZero();
        } finally {
            transport.unblock.countDown();
            caller.shutdownNow();
            streams.stop();
        }
    }
}
