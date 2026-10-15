package com.skillhub.infra.logs;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public record LogsQuery(int limit, Set<String> levels, String q, String traceId,
                        Cursor before, Cursor after, Cursor through) {
    private static final Set<String> LEVELS = Set.of("INFO", "WARN", "ERROR");
    private static final Set<String> HISTORY = Set.of("limit", "levels", "q", "traceId", "before", "after", "through");
    private static final Set<String> STREAM = Set.of("levels", "q", "traceId", "after");

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
        if (before != null && after != null || stream && after == null) throw LogsException.invalidQuery();
        return new LogsQuery(limit, Set.copyOf(levels), q == null ? null : q.toLowerCase(Locale.ROOT), traceId, before, after, through);
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
                && (traceId == null || traceId.equalsIgnoreCase(entry.traceId()));
    }
}
