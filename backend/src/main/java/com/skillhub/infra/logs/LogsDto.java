package com.skillhub.infra.logs;

import java.time.Instant;
import java.util.List;

public final class LogsDto {
    private LogsDto() {}

    public record Entry(String id, Instant timestamp, String level, String logger, String event,
                        String traceId, String spanId, String method, String route, Integer status,
                        Long durationMs, String reason, List<String> lines, boolean redacted) {}

    public record Page(String service, String generation, Instant generatedAt, int retentionSeconds,
                       Instant coverageStart, String sourceStatus, Instant lastSourceContactAt,
                       Instant lastEventAt, String policyVersion, boolean capacityLimited,
                       long omittedCount, String headCursor, String oldestCursor, String nextBefore,
                       String nextAfter, boolean hasMoreBefore, boolean hasMoreAfter, List<Entry> entries) {}

    public record Status(String sourceStatus, String generation, Instant coverageStart,
                         String headCursor, String oldestCursor, long omittedCount,
                         boolean retentionTruncated, int activeStreams, Instant accountBlockedUntil) {}
}
