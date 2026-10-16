package com.skillhub.infra.logs;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

@Component
public class LogsAccessLimiter {
    private final Map<String, Account> accounts = new HashMap<>();
    private final Clock clock;
    private int streams;
    private long lastCleanup;

    public LogsAccessLimiter() { this(Clock.systemUTC()); }
    LogsAccessLimiter(Clock clock) { this.clock = clock; }

    private static class Bucket {
        double tokens;
        long updated;
        Bucket(int burst, long now) { tokens = burst; updated = now; }
        boolean take(long now, int burst, double perSecond) {
            tokens = Math.min(burst, tokens + Math.max(0, now - updated) / 1000.0 * perSecond);
            updated = now;
            if (tokens < 1) return false;
            tokens--;
            return true;
        }
    }

    private static class Account {
        final Bucket history;
        final Bucket openings;
        int streams;
        long touched;
        Instant blockedUntil;
        Account(long now) { history = new Bucket(5, now); openings = new Bucket(3, now); touched = now; }
    }

    private Account account(String id) {
        long now = clock.millis();
        if (now - lastCleanup >= 60_000) {
            accounts.values().removeIf(account -> account.streams == 0 && now - account.touched > 300_000);
            lastCleanup = now;
        }
        if (!accounts.containsKey(id) && accounts.size() >= 10_000) {
            throw new LogsException(503, "CAPACITY_LIMIT", "El servicio de logs está ocupado.", 15);
        }
        Account account = accounts.computeIfAbsent(id, ignored -> new Account(now));
        account.touched = now;
        return account;
    }

    synchronized void history(String id) {
        Account account = account(id);
        if (!account.history.take(clock.millis(), 5, 0.5)) block(account, "REQUEST_LIMIT", 2);
    }

    synchronized void open(String id) {
        Account account = account(id);
        if (account.streams >= 2 || streams >= 100) block(account, "STREAM_LIMIT", 15);
        if (!account.openings.take(clock.millis(), 3, 0.2)) block(account, "RECONNECT_LIMIT", 5);
        account.streams++;
        streams++;
    }

    private void block(Account account, String code, int seconds) {
        account.blockedUntil = clock.instant().plusSeconds(seconds);
        throw new LogsException(429, code, "Hay demasiadas solicitudes. Reintentá en unos segundos.", seconds);
    }

    synchronized void close(String id) {
        Account account = accounts.get(id);
        if (account != null && account.streams > 0) { account.streams--; streams--; }
    }

    synchronized int activeStreams() { return streams; }
    synchronized Instant blockedUntil(String id) {
        Account account = accounts.get(id);
        return account == null || account.blockedUntil == null || !account.blockedUntil.isAfter(clock.instant())
                ? null : account.blockedUntil;
    }
}
