package com.skillhub.infra.logs;

import java.time.Instant;
import java.util.List;
import org.springframework.lang.Nullable;

public final class LogsDto {
    private LogsDto() {}

    public record Entry(String id, Instant timestamp, String level, String logger, String event,
                        String traceId, String spanId, String method, String route, Integer status,
                        Long durationMs, String reason, List<String> lines, boolean redacted) {}

    public record Page(String service, @Nullable String generation, Instant generatedAt, int retentionSeconds,
                       @Nullable Instant coverageStart, String sourceStatus, @Nullable Instant lastSourceContactAt,
                       @Nullable Instant lastEventAt, @Nullable String policyVersion, boolean capacityLimited,
                       long omittedCount, @Nullable String headCursor, @Nullable String oldestCursor, @Nullable String nextBefore,
                       @Nullable String nextAfter, boolean hasMoreBefore, boolean hasMoreAfter, List<Entry> entries) {}

    public record Status(String sourceStatus, @Nullable String generation, @Nullable Instant coverageStart,
                         @Nullable String headCursor, @Nullable String oldestCursor, long omittedCount,
                         boolean retentionTruncated, int activeStreams, @Nullable Instant accountBlockedUntil) {}
}
