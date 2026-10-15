package com.skillhub.infra.logs;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.session.CurrentUser;
import com.skillhub.session.SessionService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Clock;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

/** Shared ring publisher with bounded per-connection queues and isolated blocking writes. */
@Service
public class InfraLogStreams {
    private final InfraLogsProperties properties;
    private final SanitizedLogStore store;
    private final LogsAccessLimiter limiter;
    private final SessionService sessions;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final Supplier<SseEmitter> emitters;
    private final Set<Connection> connections = ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor senders = new ThreadPoolExecutor(16, 16, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(200), runnable -> {
                Thread thread = new Thread(runnable, "infra-logs-sender");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    private ScheduledExecutorService scheduler;

    @Autowired
    public InfraLogStreams(InfraLogsProperties properties, SanitizedLogStore store, LogsAccessLimiter limiter,
                           SessionService sessions, ObjectMapper mapper) {
        this(properties, store, limiter, sessions, mapper, Clock.systemUTC(), () -> new SseEmitter(900_000L));
    }

    InfraLogStreams(InfraLogsProperties properties, SanitizedLogStore store, LogsAccessLimiter limiter,
                    SessionService sessions, ObjectMapper mapper, Clock clock, Supplier<SseEmitter> emitters) {
        this.properties = properties;
        this.store = store;
        this.limiter = limiter;
        this.sessions = sessions;
        this.mapper = mapper;
        this.clock = clock;
        this.emitters = emitters;
    }

    @PostConstruct void start() {
        if (!properties.isEnabled()) return;
        scheduler = Executors.newScheduledThreadPool(2, runnable -> {
            Thread thread = new Thread(runnable, "infra-logs-publisher");
            thread.setDaemon(true);
            return thread;
        });
        scheduler.scheduleWithFixedDelay(this::tick, 250, 250, TimeUnit.MILLISECONDS);
        scheduler.scheduleWithFixedDelay(this::revalidate, 15, 15, TimeUnit.SECONDS);
    }

    SseEmitter open(CurrentUser user, String token, LogsQuery query) {
        SanitizedLogStore.Replay replay = store.replay(query.after(), 1001);
        long bytes = replay.entries().stream().mapToLong(SanitizedLogStore.Stored::bytes).sum();
        limiter.open(user.id());
        Connection connection = new Connection(user.id(), token, query, emitters.get());
        connections.add(connection);
        connection.emitter.onCompletion(connection::release);
        connection.emitter.onTimeout(connection::release);
        connection.emitter.onError(ignored -> connection.release());
        connection.offer(new Frame(null, null, null, 0, 0, false, false));
        connection.offer(frame("status", null, store.status(limiter.activeStreams(), limiter.blockedUntil(user.id())), 0, false));
        if (replay.entries().size() > 1000 || bytes > 1024 * 1024) {
            connection.terminal("gap", Map.of("code", "REPLAY_LIMIT", "after", query.after().toString(),
                    "through", replay.generation() + ":" + replay.head()));
        } else {
            connection.poll();
        }
        connection.drain();
        return connection.emitter;
    }

    void tick() {
        for (Connection connection : connections) {
            try {
                if (clock.millis() - connection.lastValidated >= 30_000) {
                    connection.terminal("access-revoked", Map.of("code", "SESSION_INVALID"));
                    connection.drain();
                }
                if (clock.millis() - connection.lastProgress > 15_000 && connection.sending.get()) {
                    // Release admission immediately; emitter timeout also bounds servlet lifetime.
                    connection.release();
                    connection.emitter.complete();
                    continue;
                }
                connection.poll();
                connection.drain();
            } catch (RuntimeException e) {
                connection.release();
                connection.emitter.complete();
            }
        }
    }

    void revalidate() {
        for (Connection connection : connections) {
            if (connection.released.get()) continue;
            try {
                CurrentUser user = sessions.getCurrentUser(connection.token);
                if (user == null || !connection.account.equals(user.id()) || user.mustChangePassword()) {
                    connection.terminal("access-revoked", Map.of("code", "SESSION_INVALID"));
                    connection.drain();
                } else {
                    connection.lastValidated = clock.millis();
                }
            } catch (RuntimeException e) {
                connection.terminal("access-revoked", Map.of("code", "SESSION_INVALID"));
                connection.drain();
            }
        }
    }

    private Frame frame(String name, String id, Object body, int events, boolean terminal) {
        try {
            String json = mapper.writeValueAsString(body);
            return new Frame(name, id, json, json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                    events, terminal, false);
        } catch (IOException e) {
            throw LogsException.unavailable();
        }
    }

    private record Frame(String name, String id, String json, int bytes, int events, boolean terminal, boolean keepalive) {}

    private final class Connection {
        final String account;
        final String token;
        final LogsQuery query;
        final SseEmitter emitter;
        final ArrayDeque<Frame> queue = new ArrayDeque<>();
        final AtomicBoolean sending = new AtomicBoolean();
        final AtomicBoolean released = new AtomicBoolean();
        LogsQuery.Cursor scanned;
        String delivered;
        int queuedEvents;
        int queuedBytes;
        boolean ending;
        long lastHeartbeat = clock.millis();
        volatile long lastProgress = clock.millis();
        volatile long lastValidated = clock.millis();

        Connection(String account, String token, LogsQuery query, SseEmitter emitter) {
            this.account = account;
            this.token = token;
            this.query = query;
            this.emitter = emitter;
            this.scanned = query.after();
            this.delivered = scanned.toString();
        }

        synchronized void poll() {
            if (released.get() || ending) return;
            SanitizedLogStore.Replay replay;
            try { replay = store.replay(scanned, 100); }
            catch (LogsException e) {
                if (e.status == 409) terminal("reset", Map.of("code", "CURSOR_EXPIRED", "coverageStart",
                        store.status(limiter.activeStreams(), limiter.blockedUntil(account)).coverageStart().toString()));
                else heartbeat();
                return;
            }
            List<LogsDto.Entry> batch = new ArrayList<>();
            int batchBytes = 16;
            String batchId = null;
            for (SanitizedLogStore.Stored stored : replay.entries()) {
                if (query.matches(stored.entry())) {
                    if (!batch.isEmpty() && (batch.size() >= 50 || batchBytes + stored.bytes() + 1 > 32 * 1024)) {
                        if (!offer(frame("logs", batchId, Map.of("entries", List.copyOf(batch)), batch.size(), false))) return;
                        batch.clear();
                        batchBytes = 16;
                    }
                    batch.add(stored.entry());
                    batchBytes += stored.bytes() + 1;
                    batchId = stored.entry().id();
                }
                scanned = new LogsQuery.Cursor(replay.generation(), stored.seq());
            }
            if (!batch.isEmpty() && !offer(frame("logs", batchId, Map.of("entries", List.copyOf(batch)), batch.size(), false))) return;
            if (!replay.entries().isEmpty() && (batchId == null || !batchId.equals(scanned.toString()))) {
                offer(frame("checkpoint", scanned.toString(), Map.of("cursor", scanned.toString()), 0, false));
            }
            heartbeat();
        }

        private void heartbeat() {
            if (clock.millis() - lastHeartbeat >= 15_000) {
                lastHeartbeat = clock.millis();
                offer(new Frame(null, null, null, 0, 0, false, true));
                offer(frame("status", null, store.status(limiter.activeStreams(), limiter.blockedUntil(account)), 0, false));
            }
        }

        synchronized boolean offer(Frame frame) {
            if (released.get() || ending) return false;
            if (queuedEvents + frame.events() > 500 || queuedBytes + frame.bytes() > 256 * 1024 || queue.size() >= 64) {
                terminal("gap", Map.of("code", "REPLAY_LIMIT", "after", delivered,
                        "through", store.status(limiter.activeStreams(), limiter.blockedUntil(account)).headCursor()));
                return false;
            }
            queue.add(frame);
            queuedEvents += frame.events();
            queuedBytes += frame.bytes();
            return true;
        }

        synchronized void terminal(String name, Object body) {
            if (released.get() || ending) return;
            ending = true;
            queue.removeIf(frame -> frame.name() != null || frame.keepalive());
            queuedEvents = 0;
            queuedBytes = 0;
            queue.add(frame(name, null, body, 0, true));
        }

        void drain() {
            if (released.get() || !sending.compareAndSet(false, true)) return;
            try { senders.execute(this::send); }
            catch (RejectedExecutionException e) { sending.set(false); release(); emitter.complete(); }
        }

        void send() {
            try {
                while (!released.get()) {
                    Frame next;
                    synchronized (this) {
                        next = queue.poll();
                        if (next == null) break;
                        queuedEvents -= next.events();
                        queuedBytes -= next.bytes();
                    }
                    SseEmitter.SseEventBuilder event = SseEmitter.event();
                    if (next.keepalive()) event.comment("keepalive");
                    else if (next.name() == null) event.reconnectTime(3000);
                    else {
                        event.name(next.name());
                        if (next.id() != null) event.id(next.id());
                        event.data(next.json(), MediaType.APPLICATION_JSON);
                    }
                    emitter.send(event);
                    lastProgress = clock.millis();
                    synchronized (this) { if (next.id() != null) delivered = next.id(); }
                    if (next.terminal()) { release(); emitter.complete(); return; }
                }
            } catch (IOException | RuntimeException e) {
                release();
                emitter.complete();
            } finally {
                sending.set(false);
            }
        }

        void release() {
            if (!released.compareAndSet(false, true)) return;
            synchronized (this) { queue.clear(); queuedBytes = 0; queuedEvents = 0; }
            connections.remove(this);
            limiter.close(account);
        }
    }

    @PreDestroy void stop() {
        if (scheduler != null) scheduler.shutdownNow();
        for (Connection connection : connections) { connection.release(); connection.emitter.complete(); }
        senders.shutdownNow();
    }
}
