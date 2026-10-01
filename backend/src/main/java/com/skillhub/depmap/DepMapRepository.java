package com.skillhub.depmap;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.io.InputStream;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class DepMapRepository {

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper json;

    public DepMapRepository(NamedParameterJdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public long currentVersion() {
        Long version = jdbc.queryForObject("SELECT version FROM dep_map_meta WHERE id = 1", Map.of(), Long.class);
        return version == null ? 0L : version;
    }

    public Map<String, Object> state(List<String> presence) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", currentVersion());
        jdbc.query("""
                SELECT id, name, short_name, x, y, transversal
                FROM dep_map_nodes ORDER BY sort_order
                """, (rs, i) -> {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("n", rs.getString("name"));
            node.put("s", rs.getString("short_name"));
            node.put("x", rs.getInt("x"));
            node.put("y", rs.getInt("y"));
            if (rs.getBoolean("transversal")) node.put("transv", true);
            result.computeIfAbsent("nodes", ignored -> new LinkedHashMap<String, Object>());
            @SuppressWarnings("unchecked") Map<String, Object> nodes = (Map<String, Object>) result.get("nodes");
            nodes.put(rs.getString("id"), node);
            return null;
        });
        result.putIfAbsent("nodes", new LinkedHashMap<>());

        Map<String, Object> kinds = new LinkedHashMap<>();
        jdbc.query("SELECT id, label FROM dep_map_kinds ORDER BY sort_order", rs -> {
            while (rs.next()) kinds.put(rs.getString("id"), rs.getString("label"));
        });
        result.put("kinds", kinds);

        Map<String, Object> info = new LinkedHashMap<>();
        jdbc.query("""
                SELECT id, objective, note, own_tasks::text AS own_tasks
                FROM dep_map_nodes ORDER BY sort_order
                """, rs -> {
            while (rs.next()) {
                Map<String, Object> group = new LinkedHashMap<>();
                if (rs.getString("objective") != null) group.put("obj", rs.getString("objective"));
                group.put("own", readJsonArray(rs.getString("own_tasks")));
                if (rs.getString("note") != null) group.put("note", rs.getString("note"));
                info.put(rs.getString("id"), group);
            }
        });
        result.put("info", info);

        Map<String, Object> done = new LinkedHashMap<>();
        List<Map<String, Object>> edges = jdbc.query("""
                SELECT id, from_node, to_node, kind, state, text, done
                FROM dep_map_edges ORDER BY sort_order
                """, (rs, i) -> {
            Map<String, Object> edge = new LinkedHashMap<>();
            edge.put("id", rs.getString("id"));
            edge.put("from", rs.getString("from_node"));
            edge.put("to", rs.getString("to_node"));
            edge.put("kind", rs.getString("kind"));
            edge.put("state", rs.getString("state"));
            edge.put("text", rs.getString("text"));
            if (rs.getBoolean("done")) done.put(rs.getString("id"), true);
            return edge;
        });
        result.put("edges", edges);
        result.put("done", done);

        List<Map<String, Object>> activity = jdbc.query("""
                SELECT id, ts, actor_name, summary
                FROM dep_map_activity ORDER BY id DESC LIMIT 20
                """, (rs, i) -> {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("id", "a" + rs.getLong("id"));
            event.put("ts", instantString(rs.getObject("ts")));
            event.put("by", rs.getString("actor_name"));
            event.put("summary", rs.getString("summary"));
            return event;
        });
        result.put("activity", activity);

        Map<String, Object> meta = jdbc.queryForMap("""
                SELECT updated_at, updated_by FROM dep_map_meta WHERE id = 1
                """, Map.of());
        result.put("updatedAt", instantString(meta.get("updated_at")));
        result.put("updatedBy", meta.get("updated_by"));
        result.put("presence", presence == null ? List.of() : List.copyOf(presence));
        result.put("serverTime", OffsetDateTime.now(ZoneOffset.UTC).toInstant().toString());
        return result;
    }

    public boolean nodeExists(String id) {
        return count("SELECT count(*) FROM dep_map_nodes WHERE id = :id", Map.of("id", id)) > 0;
    }

    public boolean kindExists(String id) {
        return count("SELECT count(*) FROM dep_map_kinds WHERE id = :id", Map.of("id", id)) > 0;
    }

    public String nodeName(String id) {
        return jdbc.query("SELECT name FROM dep_map_nodes WHERE id = :id", Map.of("id", id),
                rs -> rs.next() ? rs.getString(1) : null);
    }

    public long lockMeta() {
        Long version = jdbc.queryForObject("SELECT version FROM dep_map_meta WHERE id = 1 FOR UPDATE", Map.of(), Long.class);
        return version == null ? 0L : version;
    }

    public OffsetDateTime updateMeta(long version, String updatedBy) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        jdbc.update("""
                UPDATE dep_map_meta SET version = :version, updated_at = :updatedAt, updated_by = :updatedBy
                WHERE id = 1
                """, new MapSqlParameterSource()
                .addValue("version", version)
                .addValue("updatedAt", now)
                .addValue("updatedBy", updatedBy));
        return now;
    }

    public void insertEdge(String id, String from, String to, String kind, String state, String text) {
        jdbc.update("""
                INSERT INTO dep_map_edges (id, from_node, to_node, kind, state, text, done)
                VALUES (:id, :fromNode, :toNode, :kind, :state, :text, false)
                """, new MapSqlParameterSource()
                .addValue("id", id).addValue("fromNode", from).addValue("toNode", to)
                .addValue("kind", kind).addValue("state", state).addValue("text", text));
    }

    public Edge edge(String id) {
        List<Edge> rows = jdbc.query("""
                SELECT id, from_node, to_node, kind, state, text, done
                FROM dep_map_edges WHERE id = :id
                """, Map.of("id", id), (rs, i) -> new Edge(
                rs.getString("id"), rs.getString("from_node"), rs.getString("to_node"),
                rs.getString("kind"), rs.getString("state"), rs.getString("text"), rs.getBoolean("done")));
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void deleteEdge(String id) {
        jdbc.update("DELETE FROM dep_map_edges WHERE id = :id", Map.of("id", id));
    }

    public void setDone(String id, boolean done, String actorId) {
        jdbc.update("""
                UPDATE dep_map_edges SET done = :done, done_by = :actorId::uuid WHERE id = :id
                """, new MapSqlParameterSource().addValue("id", id).addValue("done", done)
                .addValue("actorId", done ? actorId : null));
    }

    public void replaceEdges(List<Map<String, String>> edges, Map<String, Boolean> done) {
        jdbc.update("DELETE FROM dep_map_edges", Map.of());
        int order = 0;
        for (Map<String, String> edge : edges) {
            jdbc.update("""
                    INSERT INTO dep_map_edges (id, from_node, to_node, kind, state, text, done, sort_order)
                    VALUES (:id, :fromNode, :toNode, :kind, :state, :text, :done, :sortOrder)
                    """, new MapSqlParameterSource()
                    .addValue("id", edge.get("id")).addValue("fromNode", edge.get("from"))
                    .addValue("toNode", edge.get("to")).addValue("kind", edge.get("kind"))
                    .addValue("state", edge.get("state")).addValue("text", edge.get("text"))
                    .addValue("done", Boolean.TRUE.equals(done.get(edge.get("id"))))
                    .addValue("sortOrder", order++));
        }
        jdbc.queryForObject("SELECT setval(pg_get_serial_sequence('dep_map_edges','sort_order'), COALESCE((SELECT MAX(sort_order) FROM dep_map_edges), -1) + 1, false)", Map.of(), Long.class);
    }

    public List<Map<String, String>> seedEdges() {
        try (InputStream in = new ClassPathResource("depmap/seed.json").getInputStream()) {
            JsonNode root = json.readTree(in);
            List<Map<String, String>> result = new ArrayList<>();
            for (JsonNode edge : root.path("edges")) {
                Map<String, String> row = new LinkedHashMap<>();
                row.put("id", edge.path("id").asText());
                row.put("from", edge.path("from").asText());
                row.put("to", edge.path("to").asText());
                row.put("kind", edge.path("kind").asText());
                row.put("state", edge.path("state").asText("pendiente"));
                row.put("text", edge.path("text").asText());
                result.add(row);
            }
            return result;
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo cargar el seed del mapa", e);
        }
    }

    public void insertActivity(String actorId, String actorName, String summary) {
        jdbc.update("""
                INSERT INTO dep_map_activity (ts, actor_id, actor_name, summary)
                VALUES (now(), :actorId::uuid, :actorName, :summary)
                """, new MapSqlParameterSource().addValue("actorId", actorId)
                .addValue("actorName", actorName).addValue("summary", summary));
        jdbc.update("""
                DELETE FROM dep_map_activity
                WHERE id NOT IN (SELECT id FROM dep_map_activity ORDER BY id DESC LIMIT 60)
                """, Map.of());
    }

    private int count(String sql, Map<String, ?> params) {
        Integer count = jdbc.queryForObject(sql, params, Integer.class);
        return count == null ? 0 : count;
    }

    private List<String> readJsonArray(String value) {
        try {
            List<String> result = new ArrayList<>();
            if (value == null) return result;
            for (JsonNode item : json.readTree(value)) result.add(item.asText());
            return result;
        } catch (Exception e) {
            throw new IllegalStateException("own_tasks invalido", e);
        }
    }

    private String instantString(Object value) {
        if (value == null) return null;
        if (value instanceof OffsetDateTime dateTime) return dateTime.toInstant().toString();
        if (value instanceof Timestamp timestamp) return timestamp.toInstant().toString();
        return value.toString();
    }

    public record Edge(String id, String from, String to, String kind, String state, String text, boolean done) {}
}
