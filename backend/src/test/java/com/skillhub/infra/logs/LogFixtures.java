package com.skillhub.infra.logs;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

final class LogFixtures {
    static final Instant NOW = Instant.parse("2026-10-14T06:51:00Z");
    static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules()
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    static final String FILE = "seg-g7-000001.ndjson";
    private LogFixtures() {}

    static class MutableClock extends Clock {
        Instant now = NOW;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void advance(long seconds) { now = now.plusSeconds(seconds); }
    }

    static InfraLogsProperties properties(Path dir) {
        InfraLogsProperties properties = new InfraLogsProperties();
        properties.setEnabled(true);
        properties.setDir(dir.toString());
        return properties;
    }

    static void copy(Path dir) throws Exception {
        for (String file : List.of("manifest.json", FILE)) {
            try (var input = LogFixtures.class.getResourceAsStream("/infra-logs/" + file)) {
                Files.copy(input, dir.resolve(file));
            }
        }
    }

    static ObjectNode manifest(Path dir) throws Exception {
        return (ObjectNode) MAPPER.readTree(dir.resolve("manifest.json").toFile());
    }

    static void manifest(Path dir, ObjectNode manifest) throws Exception {
        Files.writeString(dir.resolve("manifest.json"), MAPPER.writeValueAsString(manifest));
    }

    static String event(long seq, String level, String message) throws Exception {
        ObjectNode event = (ObjectNode) MAPPER.readTree(LogFixtures.class.getResourceAsStream("/infra-logs/" + FILE));
        event.put("seq", seq).put("level", level).put("message", message);
        return MAPPER.writeValueAsString(event);
    }

    static void events(Path dir, int count) throws Exception {
        StringBuilder content = new StringBuilder();
        for (int seq = 1; seq <= count; seq++) content.append(event(seq, "INFO", "Synthetic request " + seq)).append('\n');
        Files.writeString(dir.resolve(FILE), content);
        ObjectNode manifest = manifest(dir);
        manifest.put("headSeq", count);
        ((ObjectNode) manifest.withArray("segments").get(0)).put("lastSeq", count);
        manifest(dir, manifest);
    }

    static LogsQuery query(String... pairs) {
        java.util.Map<String, String[]> parameters = new java.util.HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) parameters.put(pairs[i], new String[]{pairs[i + 1]});
        return LogsQuery.parse(parameters, null, false, null);
    }
}
