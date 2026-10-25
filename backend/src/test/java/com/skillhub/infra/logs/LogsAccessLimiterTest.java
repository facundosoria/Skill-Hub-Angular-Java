package com.skillhub.infra.logs;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Cuotas por cuenta del visor de logs: rafagas de historial, aperturas de
 * streams, tope de streams simultaneos y limpieza de cuentas inactivas.
 */
class LogsAccessLimiterTest {

    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-25T10:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void advanceMillis(long millis) { now = now.plusMillis(millis); }
    }

    private final MutableClock clock = new MutableClock();
    private final LogsAccessLimiter limiter = new LogsAccessLimiter(clock);

    private static int status(Runnable call) {
        try {
            call.run();
            return 200;
        } catch (LogsException e) {
            return e.status;
        }
    }

    @Test
    void historyAllowsABurstOfFiveAndThenBlocksForTwoSeconds() {
        for (int i = 0; i < 5; i++) limiter.history("u1");

        assertThatThrownBy(() -> limiter.history("u1")).isInstanceOf(LogsException.class)
                .satisfies(e -> assertThat(((LogsException) e).code).isEqualTo("REQUEST_LIMIT"));
        assertThat(limiter.blockedUntil("u1")).isEqualTo(clock.now.plusSeconds(2));

        clock.advanceMillis(2_000);
        assertThat(limiter.blockedUntil("u1")).isNull();
        assertThat(status(() -> limiter.history("u1"))).isEqualTo(200);
    }

    @Test
    void accountsAreIndependent() {
        for (int i = 0; i < 5; i++) limiter.history("u1");

        assertThat(status(() -> limiter.history("u2"))).isEqualTo(200);
        assertThat(limiter.blockedUntil("nadie")).isNull();
        assertThat(limiter.blockedUntil("u2")).isNull();
    }

    @Test
    void eachAccountKeepsAtMostTwoStreams() {
        limiter.open("u1");
        limiter.open("u1");

        assertThatThrownBy(() -> limiter.open("u1")).satisfies(e -> assertThat(((LogsException) e).code).isEqualTo("STREAM_LIMIT"));
        assertThat(limiter.activeStreams()).isEqualTo(2);

        limiter.close("u1");
        assertThat(limiter.activeStreams()).isEqualTo(1);
        clock.advanceMillis(10_000);
        assertThat(status(() -> limiter.open("u1"))).isEqualTo(200);
    }

    @Test
    void reconnectingTooFastIsLimited() {
        limiter.open("u1");
        limiter.close("u1");
        limiter.open("u1");
        limiter.close("u1");
        limiter.open("u1");
        limiter.close("u1");

        assertThatThrownBy(() -> limiter.open("u1")).satisfies(e -> assertThat(((LogsException) e).code).isEqualTo("RECONNECT_LIMIT"));
    }

    @Test
    void closingUnknownOrIdleAccountsIsHarmless() {
        limiter.close("nadie");
        limiter.history("u1");
        limiter.close("u1");

        assertThat(limiter.activeStreams()).isZero();
    }

    @Test
    void theGlobalStreamCapApplies() {
        for (int i = 0; i < 50; i++) {
            limiter.open("cuenta-" + i);
            limiter.open("cuenta-" + i);
        }

        assertThatThrownBy(() -> limiter.open("una-mas")).satisfies(e -> assertThat(((LogsException) e).code).isEqualTo("STREAM_LIMIT"));
    }

    @Test
    void idleAccountsAreForgottenAndCapacityIsBounded() {
        for (int i = 0; i < 5; i++) limiter.history("viejo");
        clock.advanceMillis(301_000);

        // La limpieza borra la cuenta inactiva: vuelve con la rafaga completa.
        for (int i = 0; i < 5; i++) assertThat(status(() -> limiter.history("viejo"))).isEqualTo(200);
    }

    @Test
    void tooManyAccountsAreRejectedAsBusy() {
        for (int i = 0; i < 10_000; i++) limiter.history("cuenta-" + i);

        assertThatThrownBy(() -> limiter.history("nueva")).satisfies(e -> {
            assertThat(((LogsException) e).status).isEqualTo(503);
            assertThat(((LogsException) e).code).isEqualTo("CAPACITY_LIMIT");
        });
        assertThat(status(() -> limiter.history("cuenta-1"))).isEqualTo(200);
    }

    @Test
    void theDefaultConstructorUsesTheSystemClock() {
        LogsAccessLimiter real = new LogsAccessLimiter();
        real.history("u1");

        assertThat(real.activeStreams()).isZero();
    }

    @Test
    void cleanupKeepsAccountsWithOpenStreams() {
        limiter.open("activo");
        limiter.history("inactivo");
        clock.advanceMillis(301_000);

        limiter.history("otro");

        // La cuenta con un stream abierto sobrevive a la limpieza y sigue contando.
        assertThat(limiter.activeStreams()).isEqualTo(1);
        limiter.close("activo");
        assertThat(limiter.activeStreams()).isZero();
    }
}
