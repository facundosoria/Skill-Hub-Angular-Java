package com.skillhub.infra.logs;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public record LogsQuery(int limit, Set<String> levels, String q, String traceId,
                        Cursor before, Cursor after, Cursor through, Instant at, String route,
                        Set<String> methods, Set<String> statuses, Long minDurationMs) {
    private static final Set<String> LEVELS = Set.of("INFO", "WARN", "ERROR");
    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final Set<String> STATUS_CLASSES = Set.of("2xx", "3xx", "4xx", "5xx");
    private static final Set<String> HISTORY = Set.of("limit", "levels", "q", "traceId", "before", "after", "through",
            "at", "route", "method", "status", "minDurationMs");
    private static final Set<String> STREAM = Set.of("levels", "q", "traceId", "after", "route", "method", "status", "minDurationMs");

    public record Cursor(String generation, long seq) {
        public static Cursor parse(String value) {
            if (value == null) return null;
            if (!value.matches("[A-Za-z0-9_-]{1,64}:[0-9]{1,19}")) throw LogsException.invalidQuery();
            int colon = value.indexOf(':');
            try {
                return new Cursor(value.substring(0, colon), Long.parseLong(value.substring(colon + 1)));
            } catch (NumberFormatException e) {
                throw LogsException.invalidQuery();
            }
        }
        @Override public String toString() { return generation + ":" + seq; }
    }

    static LogsQuery parse(Map<String, String[]> parameters, String rawQuery, boolean stream, String lastEventId) {
        if (rawQuery != null && rawQuery.getBytes(StandardCharsets.UTF_8).length > 2048) throw LogsException.invalidQuery();
        Set<String> allowed = stream ? STREAM : HISTORY;
        for (var parameter : parameters.entrySet()) {
            if (!allowed.contains(parameter.getKey()) || parameter.getValue().length != 1) throw LogsException.invalidQuery();
        }
        int limit = 150;
        String limitValue = value(parameters, "limit");
        if (limitValue != null) {
            try { limit = Integer.parseInt(limitValue); }
            catch (NumberFormatException e) { throw LogsException.invalidQuery(); }
            if (limit < 1 || limit > 150) throw LogsException.invalidQuery();
        }
        Set<String> levels = LEVELS;
        String levelValue = value(parameters, "levels");
        if (levelValue != null) {
            levels = new HashSet<>();
            for (String level : levelValue.split(",", -1)) {
                if (!LEVELS.contains(level)) throw LogsException.invalidQuery();
                levels.add(level);
            }
        }
        String q = value(parameters, "q");
        if (q != null && (q.codePointCount(0, q.length()) > 120 || q.chars().anyMatch(Character::isISOControl))) throw LogsException.invalidQuery();
        String traceId = value(parameters, "traceId");
        if (traceId != null && !traceId.matches("[a-fA-F0-9]{32}")) throw LogsException.invalidQuery();
        Cursor before = Cursor.parse(value(parameters, "before"));
        String afterValue = stream && lastEventId != null && !lastEventId.isEmpty() ? lastEventId : value(parameters, "after");
        Cursor after = Cursor.parse(afterValue);
        Cursor through = Cursor.parse(value(parameters, "through"));
        String atValue = value(parameters, "at");
        Instant at = null;
        if (atValue != null) {
            try { at = OffsetDateTime.parse(atValue).toInstant(); }
            catch (DateTimeParseException e) { throw LogsException.invalidQuery(); }
        }
        String routeValue = value(parameters, "route");
        if (routeValue != null && (routeValue.codePointCount(0, routeValue.length()) > 120 ||
                routeValue.chars().anyMatch(Character::isISOControl))) throw LogsException.invalidQuery();
        Set<String> methods = csv(value(parameters, "method"), METHODS);
        Set<String> statuses = new HashSet<>();
        String statusValue = value(parameters, "status");
        if (statusValue != null) for (String status : statusValue.split(",", -1)) {
            if (!STATUS_CLASSES.contains(status) && (!status.matches("[1-5][0-9]{2}"))) throw LogsException.invalidQuery();
            statuses.add(status);
        }
        Long minDurationMs = null;
        String durationValue = value(parameters, "minDurationMs");
        if (durationValue != null) {
            try { minDurationMs = Long.parseLong(durationValue); }
            catch (NumberFormatException e) { throw LogsException.invalidQuery(); }
            if (minDurationMs < 0 || minDurationMs > 600_000) throw LogsException.invalidQuery();
        }
        if (before != null && after != null || at != null && (before != null || after != null || through != null) || stream && after == null) throw LogsException.invalidQuery();
        return new LogsQuery(limit, Set.copyOf(levels), q == null ? null : q.toLowerCase(Locale.ROOT), traceId,
                before, after, through, at, routeValue == null ? null : routeValue.toLowerCase(Locale.ROOT),
                methods, Set.copyOf(statuses), minDurationMs);
    }

    private static Set<String> csv(String value, Set<String> allowed) {
        if (value == null) return Set.of();
        Set<String> result = new HashSet<>();
        for (String item : value.split(",", -1)) {
            if (!allowed.contains(item)) throw LogsException.invalidQuery();
            result.add(item);
        }
        return Set.copyOf(result);
    }

    static void validateStatus(Map<String, String[]> parameters, String rawQuery) {
        if (!parameters.isEmpty() || rawQuery != null && !rawQuery.isEmpty()) throw LogsException.invalidQuery();
    }

    private static String value(Map<String, String[]> parameters, String key) {
        return parameters.containsKey(key) ? parameters.get(key)[0] : null;
    }

    boolean matches(LogsDto.Entry entry) {
        return levels.contains(entry.level())
                && (q == null || entry.lines().getFirst().toLowerCase(Locale.ROOT).contains(q))
                && (traceId == null || traceId.equalsIgnoreCase(entry.traceId()))
                && (route == null || entry.route() != null && entry.route().toLowerCase(Locale.ROOT).contains(route))
                && (methods.isEmpty() || methods.contains(entry.method()))
                && (statuses.isEmpty() || entry.status() != null && (statuses.contains(Integer.toString(entry.status())) ||
                    statuses.contains((entry.status() / 100) + "xx")))
                && (minDurationMs == null || entry.durationMs() != null && entry.durationMs() >= minDurationMs);
    }
}
