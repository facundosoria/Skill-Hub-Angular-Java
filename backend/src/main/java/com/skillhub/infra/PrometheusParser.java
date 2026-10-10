package com.skillhub.infra;

import java.time.Duration;
import java.time.Instant;
import java.util.OptionalLong;

/**
 * Reads process uptime from the Prometheus text exposition format.
 *
 * Only values the exposition actually provides are used:
 * {@code process_uptime_seconds} when present, otherwise
 * {@code process_start_time_seconds} converted against the supplied clock. No
 * latency percentiles or histogram buckets are invented — this parser never
 * assumes they exist.
 */
public final class PrometheusParser {

    private PrometheusParser() {
    }

    public static OptionalLong uptimeSeconds(String body, Instant now) {
        if (body == null || body.isBlank()) return OptionalLong.empty();
        Double uptime = null;
        Double startTime = null;
        for (String rawLine : body.split("\n")) {
            String line = rawLine.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            int space = line.indexOf(' ');
            if (space <= 0) continue;
            String metric = line.substring(0, space).trim();
            int brace = metric.indexOf('{');
            if (brace >= 0) metric = metric.substring(0, brace);
            Double value = parseDouble(line.substring(space + 1).trim());
            if (value == null) continue;
            if (metric.equals("process_uptime_seconds") && uptime == null) uptime = value;
            else if (metric.equals("process_start_time_seconds") && startTime == null) startTime = value;
        }
        if (uptime != null && uptime >= 0) return OptionalLong.of(Math.round(uptime));
        if (startTime != null && now != null) {
            long seconds = Math.round(now.getEpochSecond() - startTime);
            if (seconds >= 0) return OptionalLong.of(seconds);
        }
        return OptionalLong.empty();
    }

    private static Double parseDouble(String token) {
        // Strip an optional timestamp after the value, e.g. "123 1699999999".
        int space = token.indexOf(' ');
        if (space >= 0) token = token.substring(0, space);
        try {
            return Double.parseDouble(token);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static long clampToDuration(Duration duration) {
        return Math.max(0, duration.toMillis());
    }
}
