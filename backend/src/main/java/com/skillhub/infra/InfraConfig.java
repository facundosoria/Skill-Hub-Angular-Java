package com.skillhub.infra;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Wires the infra monitoring collaborators with a controllable {@link Clock}
 * and a dedicated bounded executor, so probes can never occupy the shared
 * Spring scheduler used by UsageService/DepMapEvents or a servlet thread.
 */
@Configuration
public class InfraConfig {

    @Bean
    public Clock infraClock() {
        return Clock.systemUTC();
    }

    @Bean(name = "infraProbeExecutor", destroyMethod = "shutdownNow")
    public ExecutorService infraProbeExecutor(InfraProperties properties) {
        int size = Math.max(1, properties.getMaxConcurrency());
        ThreadFactory factory = new ThreadFactory() {
            private final AtomicInteger counter = new AtomicInteger();

            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "skillhub-infra-probe-" + counter.incrementAndGet());
                thread.setDaemon(true);
                return thread;
            }
        };
        // Core 0 + bounded queue: no threads and no work until a cycle actually
        // submits probes, and the queue can never grow without bound.
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                0, size, 60L, TimeUnit.SECONDS, new LinkedBlockingQueue<>(256), factory);
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }

    @Bean
    public AvailabilityCalculator infraAvailabilityCalculator(InfraProperties properties) {
        return new AvailabilityCalculator(properties.getStaleObservationGrace());
    }
}
