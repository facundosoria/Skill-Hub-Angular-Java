package com.skillhub.infra.logs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Parametros del visor de logs: solo valores literales y acotados, y el
 * filtro que se aplica sobre las entradas saneadas.
 */
class LogsQueryTest {

    private static Map<String, String[]> params(String... pairs) {
        Map<String, String[]> parameters = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) parameters.put(pairs[i], new String[]{pairs[i + 1]});
        return parameters;
    }

    private static LogsQuery history(String... pairs) {
        return LogsQuery.parse(params(pairs), null, false, null);
    }

    private static LogsDto.Entry entry(String level, String route, String method, Integer status, Long duration, String trace) {
        return new LogsDto.Entry("g7:1", Instant.parse("2026-10-25T10:00:00Z"), level, "Logger", "EVENT", trace, null,
                method, route, status, duration, null, List.of("GET /api/Skills -> 200"), true);
    }

    @Test
    void rejectsOverlongRawQueriesAndRepeatedOrUnknownParameters() {
        assertThatThrownBy(() -> LogsQuery.parse(Map.of(), "x".repeat(2049), false, null)).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> LogsQuery.parse(Map.of("limit", new String[]{"1", "2"}), null, false, null)).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("nada", "1")).isInstanceOf(LogsException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"x", "0", "151"})
    void limitMustBeBetweenOneAndOneHundredFifty(String limit) {
        assertThatThrownBy(() -> history("limit", limit)).isInstanceOf(LogsException.class);
    }

    @Test
    void rejectsInvalidTextFilters() {
        assertThatThrownBy(() -> history("levels", "INFO,DEBUG")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("q", "x".repeat(121))).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("q", "a\tb")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("traceId", "corto")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("at", "ayer")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("minDurationMs", "rapido")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("before", "no es cursor")).isInstanceOf(LogsException.class);
    }

    @Test
    void rejectsIncompatibleCursorCombinations() {
        assertThatThrownBy(() -> history("before", "g7:2", "after", "g7:1")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("at", "2026-10-25T10:00:00Z", "before", "g7:2")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("at", "2026-10-25T10:00:00Z", "after", "g7:2")).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> history("at", "2026-10-25T10:00:00Z", "through", "g7:2")).isInstanceOf(LogsException.class);
    }

    @Test
    void streamsNeedAnAfterCursorWhichTheLastEventIdCanProvide() {
        assertThatThrownBy(() -> LogsQuery.parse(Map.of(), null, true, null)).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> LogsQuery.parse(Map.of(), null, true, "")).isInstanceOf(LogsException.class);

        LogsQuery fromHeader = LogsQuery.parse(Map.of(), null, true, "g7:5");
        assertThat(fromHeader.after()).isEqualTo(new LogsQuery.Cursor("g7", 5));

        LogsQuery fromParam = LogsQuery.parse(params("after", "g7:4"), null, true, null);
        assertThat(fromParam.after().seq()).isEqualTo(4);
    }

    @Test
    void statusEndpointAcceptsNoParameters() {
        LogsQuery.validateStatus(Map.of(), null);
        LogsQuery.validateStatus(Map.of(), "");
        assertThatThrownBy(() -> LogsQuery.validateStatus(params("x", "1"), null)).isInstanceOf(LogsException.class);
        assertThatThrownBy(() -> LogsQuery.validateStatus(Map.of(), "x=1")).isInstanceOf(LogsException.class);
    }

    @Test
    void matchesEveryFilterAgainstTheEntry() {
        LogsQuery all = history("levels", "WARN", "q", "SKILLS", "traceId", "A".repeat(32), "route", "/API/SKILLS",
                "method", "GET", "status", "2xx", "minDurationMs", "10");

        assertThat(all.matches(entry("WARN", "/api/skills", "GET", 200, 15L, "a".repeat(32)))).isTrue();
        assertThat(all.matches(entry("INFO", "/api/skills", "GET", 200, 15L, "a".repeat(32)))).isFalse();
        assertThat(all.matches(entry("WARN", null, "GET", 200, 15L, "a".repeat(32)))).isFalse();
        assertThat(all.matches(entry("WARN", "/api/skills", "POST", 200, 15L, "a".repeat(32)))).isFalse();
        assertThat(all.matches(entry("WARN", "/api/skills", "GET", null, 15L, "a".repeat(32)))).isFalse();
        assertThat(all.matches(entry("WARN", "/api/skills", "GET", 404, 15L, "a".repeat(32)))).isFalse();
        assertThat(all.matches(entry("WARN", "/api/skills", "GET", 200, null, "a".repeat(32)))).isFalse();
        assertThat(all.matches(entry("WARN", "/api/skills", "GET", 200, 5L, "a".repeat(32)))).isFalse();
        assertThat(all.matches(entry("WARN", "/api/skills", "GET", 200, 15L, "b".repeat(32)))).isFalse();
    }

    @Test
    void matchesExactStatusCodesAndEmptyFilters() {
        assertThat(history("status", "404").matches(entry("WARN", "/x", "GET", 404, null, null))).isTrue();
        assertThat(history().matches(entry("ERROR", null, null, null, null, null))).isTrue();
        assertThat(history("q", "otra cosa").matches(entry("INFO", null, null, null, null, null))).isFalse();
        assertThat(history("route", "/api/users").matches(entry("INFO", "/api/skills", null, null, null, null))).isFalse();
    }
}
