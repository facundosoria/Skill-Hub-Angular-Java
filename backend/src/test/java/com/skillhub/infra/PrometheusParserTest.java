package com.skillhub.infra;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThat;

class PrometheusParserTest {

    @Test
    void readsProcessUptimeSeconds() {
        String body = """
                # HELP process_uptime_seconds The uptime of the Java process
                # TYPE process_uptime_seconds gauge
                process_uptime_seconds 12345.0
                jvm_threads_live_threads 42
                """;
        OptionalLong uptime = PrometheusParser.uptimeSeconds(body, Instant.EPOCH);
        assertThat(uptime.isPresent()).isTrue();
        assertThat(uptime.getAsLong()).isEqualTo(12345L);
    }

    @Test
    void derivesUptimeFromStartTimeWhenUptimeAbsent() {
        Instant now = Instant.ofEpochSecond(1_700_000_500L);
        String body = """
                process_start_time_seconds 1700000400.0
                some_other_metric 7
                """;
        OptionalLong uptime = PrometheusParser.uptimeSeconds(body, now);
        assertThat(uptime.isPresent()).isTrue();
        assertThat(uptime.getAsLong()).isEqualTo(100L);
    }

    @Test
    void handlesLabeledUptimeAndExponentNotation() {
        String body = "process_start_time_seconds{application=\"x\"} 1.7000004E9 1699999999\n";
        OptionalLong uptime = PrometheusParser.uptimeSeconds(body, Instant.ofEpochSecond(1_700_000_500L));
        assertThat(uptime.isPresent()).isTrue();
        assertThat(uptime.getAsLong()).isEqualTo(100L);
    }

    @Test
    void returnsEmptyWhenOnlyUnrelatedMetricsOrHistogramsPresent() {
        String body = """
                http_server_requests_seconds_bucket{le="0.1"} 10
                http_server_requests_seconds_count 42
                http_server_requests_seconds_sum 3.5
                """;
        assertThat(PrometheusParser.uptimeSeconds(body, Instant.now()).isPresent()).isFalse();
    }

    @Test
    void returnsEmptyForBlankOrNull() {
        assertThat(PrometheusParser.uptimeSeconds(null, Instant.now()).isPresent()).isFalse();
        assertThat(PrometheusParser.uptimeSeconds("   ", Instant.now()).isPresent()).isFalse();
    }
}
