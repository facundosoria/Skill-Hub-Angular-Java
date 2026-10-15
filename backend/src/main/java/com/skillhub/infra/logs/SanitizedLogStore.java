package com.skillhub.infra.logs;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** One incremental reader for all clients. Only allowlisted DTOs enter the ring. */
@Service
public class SanitizedLogStore {
    static final long MAX_BYTES = 32L * 1024 * 1024;
    static final int MAX_EVENTS = 100_000;
    static final int RETENTION_SECONDS = 21_600;
    static final int MAX_LINE_BYTES = 8192;
    private final InfraLogsProperties properties;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final long maxBytes;
    private final int maxEvents;
    private final NavigableMap<Long, Stored> entries = new TreeMap<>();
    private final java.util.NavigableSet<Stored> expiry = new java.util.TreeSet<>(
            java.util.Comparator.comparing((Stored stored) -> stored.entry().timestamp()).thenComparingLong(Stored::seq));
    private final Map<String, Tail> tails = new HashMap<>();
    private Manifest manifest;
    private long payloadBytes;
    private long highWatermark;
    private boolean truncated;
    private boolean sourceAvailable;
    private ScheduledExecutorService poller;

    @Autowired
    public SanitizedLogStore(InfraLogsProperties properties, ObjectMapper mapper) {
        this(properties, mapper, Clock.systemUTC(), MAX_BYTES, MAX_EVENTS);
    }

    SanitizedLogStore(InfraLogsProperties properties, ObjectMapper mapper, Clock clock, long maxBytes, int maxEvents) {
        this.properties = properties;
        this.mapper = mapper;
        this.clock = clock;
        this.maxBytes = maxBytes;
        this.maxEvents = maxEvents;
    }

    record Stored(long seq, LogsDto.Entry entry, int bytes) {}
    record Segment(String file, long firstSeq, long lastSeq, boolean closed) {}
    record Manifest(String generation, String sourceStatus, Instant heartbeatAt, Instant lastSourceContactAt,
                    Instant lastEventAt, Instant windowStart, long oldestSeq, long headSeq, long omittedCount,
                    boolean retentionTruncated, List<Segment> segments) {}
    private record Tail(Object fileKey, long offset) {}
    record Replay(String generation, long head, List<Stored> entries) {}

    @PostConstruct
    void start() {
        if (!properties.isEnabled()) return;
        poller = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "infra-logs-reader");
            thread.setDaemon(true);
            return thread;
        });
        poller.scheduleWithFixedDelay(this::refresh, 0, 250, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    void stop() {
        if (poller != null) poller.shutdownNow();
    }

    synchronized void refresh() {
        if (!properties.isEnabled()) return;
        try {
            Path root = Path.of(properties.getDir()).toAbsolutePath().normalize();
            if (!root.equals(root.toRealPath()) || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) throw new IOException();
            Manifest next = parseManifest(readFile(root.resolve("manifest.json"), 256 * 1024));
            if (manifest == null || !manifest.generation().equals(next.generation())) {
                entries.clear();
                expiry.clear();
                tails.clear();
                payloadBytes = 0;
                highWatermark = 0;
                truncated = false;
            } else if (next.headSeq() < manifest.headSeq()) {
                throw new IOException();
            }
            manifest = next;
            Set<String> activeFiles = new HashSet<>();
            for (Segment segment : next.segments()) {
                activeFiles.add(segment.file());
                try {
                    readSegment(root.resolve(segment.file()), segment);
                } catch (java.nio.file.NoSuchFileException e) {
                    // Rotation can remove a whole segment before the next manifest rename.
                    var expired = entries.subMap(segment.firstSeq(), true, segment.lastSeq(), true);
                    expired.values().forEach(stored -> { payloadBytes -= stored.bytes(); expiry.remove(stored); });
                    expired.clear();
                    tails.remove(segment.file());
                    truncated = true;
                }
            }
            tails.keySet().retainAll(activeFiles);
            sourceAvailable = true;
        } catch (IOException | IllegalArgumentException e) {
            // Fail closed without logging any source data or filesystem paths.
            sourceAvailable = false;
        }
        prune();
    }

    private byte[] readFile(Path path, int maximum) throws IOException {
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || channel.size() > maximum) throw new IOException();
            ByteBuffer buffer = ByteBuffer.allocate(maximum + 1);
            while (channel.read(buffer) > 0) {
                if (!buffer.hasRemaining()) throw new IOException();
            }
            byte[] bytes = new byte[buffer.position()];
            buffer.flip();
            buffer.get(bytes);
            return bytes;
        }
    }

    private Manifest parseManifest(byte[] bytes) throws IOException {
        JsonNode node = mapper.readTree(bytes);
        if (node == null || !node.isObject() || number(node, "version") != 1
                || !"api-gateway".equals(text(node, "service", 32))
                || !"r2-v1".equals(text(node, "policyVersion", 32))) throw new IOException();
        String generation = text(node, "generation", 64);
        if (!generation.matches("[A-Za-z0-9_-]{1,64}")) throw new IOException();
        String status = text(node, "sourceStatus", 32);
        if (!Set.of("healthy", "disconnected", "starting").contains(status)) throw new IOException();
        Instant heartbeat = instant(node, "heartbeatAt", false);
        Instant contact = instant(node, "lastSourceContactAt", true);
        Instant event = instant(node, "lastEventAt", true);
        Instant window = instant(node, "windowStart", false);
        long oldest = number(node, "oldestSeq"), head = number(node, "headSeq"), omitted = number(node, "omittedCount");
        if (oldest > head && head != 0 || !node.path("retentionTruncated").isBoolean()) throw new IOException();
        JsonNode segments = node.get("segments");
        if (segments == null || !segments.isArray() || segments.size() > 512) throw new IOException();
        List<Segment> parsed = new ArrayList<>();
        Set<String> files = new HashSet<>();
        long previous = 0;
        for (JsonNode segment : segments) {
            String file = text(segment, "file", 96);
            if (!file.matches("seg-" + generation + "-[0-9]{6}\\.ndjson") || !files.add(file)) throw new IOException();
            long first = number(segment, "firstSeq"), last = number(segment, "lastSeq");
            if (first < 1 || first <= previous || last < first || last > head || !segment.path("closed").isBoolean()) throw new IOException();
            parsed.add(new Segment(file, first, last, segment.get("closed").booleanValue()));
            previous = last;
        }
        return new Manifest(generation, status, heartbeat, contact, event, window, oldest, head, omitted,
                node.get("retentionTruncated").booleanValue(), List.copyOf(parsed));
    }

    private void readSegment(Path path, Segment segment) throws IOException {
        BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attrs.isRegularFile() || attrs.size() > 2 * 1024 * 1024 + MAX_LINE_BYTES) throw new IOException();
        Tail tail = tails.get(segment.file());
        long offset = tail == null ? 0 : tail.offset();
        if (tail != null && (!java.util.Objects.equals(tail.fileKey(), attrs.fileKey()) || attrs.size() < offset)) throw new IOException();
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            channel.position(offset);
            ByteBuffer buffer = ByteBuffer.allocate(8192);
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            long position = offset, completeOffset = offset;
            boolean oversized = false;
            while (channel.read(buffer) > 0) {
                buffer.flip();
                while (buffer.hasRemaining()) {
                    byte value = buffer.get();
                    position++;
                    if (value == '\n') {
                        if (!oversized) {
                            Stored stored = parseEvent(line.toByteArray(), segment);
                            // The file may be ahead of the atomic manifest; retry this line later.
                            if (stored != null && (stored.seq() > manifest.headSeq() || stored.entry() == null)) {
                                tails.put(segment.file(), new Tail(attrs.fileKey(), completeOffset));
                                return;
                            }
                            if (stored != null && stored.seq() > highWatermark) {
                                highWatermark = stored.seq();
                                if (!stored.entry().timestamp().isBefore(clock.instant().minusSeconds(RETENTION_SECONDS))) {
                                    entries.put(stored.seq(), stored);
                                    expiry.add(stored);
                                    payloadBytes += stored.bytes();
                                    pruneCapacity();
                                }
                            }
                        }
                        line.reset();
                        oversized = false;
                        completeOffset = position;
                    } else if (line.size() < MAX_LINE_BYTES && !oversized) {
                        line.write(value);
                    } else {
                        oversized = true;
                        line.reset();
                    }
                }
                buffer.clear();
            }
            tails.put(segment.file(), new Tail(attrs.fileKey(), completeOffset));
        }
    }

    private Stored parseEvent(byte[] bytes, Segment segment) {
        try {
            String line = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JsonNode node = mapper.readTree(line);
            if (node == null || !node.isObject() || !"r2-v1".equals(text(node, "policyVersion", 32))) return null;
            long seq = number(node, "seq");
            if (seq < segment.firstSeq()) return null;
            // New tail data beyond lastSeq is deferred rather than consumed.
            if (seq > segment.lastSeq()) return new Stored(seq, null, 0);
            String level = text(node, "level", 5);
            if (!Set.of("INFO", "WARN", "ERROR").contains(level)) return null;
            Instant timestamp = instant(node, "timestamp", false);
            if (timestamp.isAfter(clock.instant().plusSeconds(60))) return null;
            String message = text(node, "message", 2048);
            String trace = optionalText(node, "traceId", 32), span = optionalText(node, "spanId", 16);
            if (trace != null && !trace.matches("[a-fA-F0-9]{32}") || span != null && !span.matches("[a-fA-F0-9]{16}")) return null;
            Long status = optionalNumber(node, "status"), duration = optionalNumber(node, "durationMs");
            if (status != null && (status < 100 || status > 599)) return null;
            LogsDto.Entry entry = new LogsDto.Entry(cursor(seq), timestamp, level, text(node, "logger", 128),
                    text(node, "event", 128), trace, span, optionalText(node, "method", 16),
                    optionalText(node, "route", 512), status == null ? null : status.intValue(), duration,
                    optionalText(node, "reason", 128), List.of(message), true);
            return new Stored(seq, entry, mapper.writeValueAsBytes(entry).length);
        } catch (IOException | IllegalArgumentException e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field, int maximum) throws IOException {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.textValue().length() > maximum
                || value.textValue().chars().anyMatch(Character::isISOControl)) throw new IOException();
        return value.textValue();
    }

    private static String optionalText(JsonNode node, String field, int maximum) throws IOException {
        if (!node.has(field) || node.get(field).isNull()) return null;
        return text(node, field, maximum);
    }

    private static long number(JsonNode node, String field) throws IOException {
        JsonNode value = node.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 0) throw new IOException();
        return value.longValue();
    }

    private static Long optionalNumber(JsonNode node, String field) throws IOException {
        return !node.has(field) || node.get(field).isNull() ? null : number(node, field);
    }

    private static Instant instant(JsonNode node, String field, boolean nullable) throws IOException {
        if (nullable && node.has(field) && node.get(field).isNull()) return null;
        try { return Instant.parse(text(node, field, 40)); }
        catch (java.time.DateTimeException e) { throw new IOException(); }
    }

    private void prune() {
        Instant cutoff = clock.instant().minusSeconds(RETENTION_SECONDS);
        while (!expiry.isEmpty() && expiry.first().entry().timestamp().isBefore(cutoff)) {
            Stored stored = expiry.pollFirst();
            entries.remove(stored.seq());
            payloadBytes -= stored.bytes();
        }
        while (!entries.isEmpty() && manifest != null && entries.firstKey() < manifest.oldestSeq()) {
            Stored stored = entries.pollFirstEntry().getValue();
            expiry.remove(stored);
            payloadBytes -= stored.bytes();
        }
        pruneCapacity();
    }

    private void pruneCapacity() {
        while (entries.size() > maxEvents || payloadBytes > maxBytes) {
            Stored stored = entries.pollFirstEntry().getValue();
            expiry.remove(stored);
            payloadBytes -= stored.bytes();
            truncated = true;
        }
    }

    private String cursor(long seq) { return manifest.generation() + ":" + seq; }
    private long head() { return highWatermark; }
    private long oldest() { return entries.isEmpty() ? head() : entries.firstKey(); }

    private Instant coverageStart() {
        Instant cutoff = clock.instant().minusSeconds(RETENTION_SECONDS);
        Instant start = manifest.windowStart().isAfter(cutoff) ? manifest.windowStart() : cutoff;
        if (truncated && !entries.isEmpty() && entries.firstEntry().getValue().entry().timestamp().isAfter(start)) {
            start = entries.firstEntry().getValue().entry().timestamp();
        }
        return start;
    }

    synchronized LogsDto.Status status(int activeStreams, Instant blockedUntil) {
        prune();
        if (manifest == null) return new LogsDto.Status("starting", null, null, null, null, 0, false, activeStreams, blockedUntil);
        return new LogsDto.Status(sourceStatus(), manifest.generation(), coverageStart(), cursor(head()),
                cursor(oldest()), manifest.omittedCount(), truncated || manifest.retentionTruncated(), activeStreams, blockedUntil);
    }

    private String sourceStatus() {
        return !sourceAvailable || manifest.heartbeatAt().isBefore(clock.instant().minusSeconds(30)) ? "disconnected" : manifest.sourceStatus();
    }

    private void requireAvailable() {
        prune();
        if (manifest == null || !sourceAvailable && entries.isEmpty()) throw LogsException.unavailable();
    }

    private void validate(LogsQuery.Cursor cursor) {
        if (cursor != null && (!manifest.generation().equals(cursor.generation())
                || cursor.seq() > head() || cursor.seq() < oldest() && !(cursor.seq() == 0 && oldest() <= 1))) throw LogsException.expired();
    }

    synchronized LogsDto.Page page(LogsQuery query) {
        if (manifest == null) {
            if (query.before() != null || query.after() != null || query.through() != null) throw LogsException.expired();
            return new LogsDto.Page("api-gateway", null, clock.instant(), RETENTION_SECONDS,
                    null, "starting", null, null, null, false, 0,
                    null, null, null, null, false, false, List.of());
        }
        requireAvailable();
        validate(query.before());
        validate(query.after());
        validate(query.through());
        long through = query.through() == null ? head() : query.through().seq();
        if (query.after() != null && query.after().seq() > through) throw LogsException.invalidQuery();
        boolean forward = query.after() != null;
        long lower = forward ? query.after().seq() : oldest() - 1;
        long upper = query.before() == null ? through : Math.min(through, query.before().seq() - 1);
        NavigableMap<Long, Stored> range = upper <= lower ? new TreeMap<>() : entries.subMap(lower, false, upper, true);
        List<LogsDto.Entry> found = new ArrayList<>();
        long scanned = forward ? lower : upper + 1;
        long firstScanned = scanned;
        int count = 0;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        for (Stored entry : (forward ? range : range.descendingMap()).values()) {
            if (count >= 5000 || System.nanoTime() >= deadline || found.size() >= query.limit()) break;
            scanned = entry.seq();
            if (count == 0) firstScanned = scanned;
            count++;
            if (query.matches(entry.entry())) found.add(entry.entry());
        }
        if (!forward) Collections.reverse(found);
        Long earlier = entries.lowerKey(forward ? firstScanned : scanned), later = entries.higherKey(scanned);
        String nextBefore = cursor(forward ? firstScanned : scanned);
        String nextAfter = cursor(forward ? scanned : through);
        return new LogsDto.Page("api-gateway", manifest.generation(), clock.instant(), RETENTION_SECONDS,
                coverageStart(), sourceStatus(), manifest.lastSourceContactAt(), manifest.lastEventAt(), "r2-v1",
                truncated || manifest.retentionTruncated(), manifest.omittedCount(), cursor(head()), cursor(oldest()),
                nextBefore, nextAfter, earlier != null, forward && later != null && later <= through, List.copyOf(found));
    }

    synchronized Replay replay(LogsQuery.Cursor after, int maximum) {
        requireAvailable();
        validate(after);
        List<Stored> batch = new ArrayList<>();
        for (Stored entry : entries.tailMap(after.seq(), false).values()) {
            batch.add(entry);
            if (batch.size() >= maximum) break;
        }
        return new Replay(manifest.generation(), head(), List.copyOf(batch));
    }

    synchronized long payloadBytes() { return payloadBytes; }
    synchronized int size() { return entries.size(); }
}
