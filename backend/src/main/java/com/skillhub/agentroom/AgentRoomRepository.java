package com.skillhub.agentroom;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class AgentRoomRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public AgentRoomRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String insertRoom(String title, String topic, String createdBy, String createdByTeam) {
        return jdbc.queryForObject("""
                INSERT INTO agent_rooms (title, topic, created_by, created_by_team)
                VALUES (:title, :topic, :createdBy::uuid, :team)
                RETURNING id::text
                """, new MapSqlParameterSource()
                .addValue("title", title)
                .addValue("topic", topic)
                .addValue("createdBy", createdBy)
                .addValue("team", createdByTeam), String.class);
    }

    public void insertTeam(String roomId, String team) {
        jdbc.update("""
                INSERT INTO agent_room_teams (room_id, team) VALUES (:roomId::uuid, :team)
                ON CONFLICT DO NOTHING
                """, new MapSqlParameterSource("roomId", roomId).addValue("team", team));
    }

    public Room room(String roomId) {
        return findRoom(roomId, false);
    }

    /** Bloquea la fila de la sala: serializa seq, versiones de contrato y aceptaciones. */
    public Room lockRoom(String roomId) {
        return findRoom(roomId, true);
    }

    private Room findRoom(String roomId, boolean lock) {
        List<Room> rows = jdbc.query("""
                SELECT id::text AS id, title, topic, created_by_team, status, last_seq, created_at, updated_at
                FROM agent_rooms WHERE id = :id::uuid
                """ + (lock ? " FOR UPDATE" : ""), new MapSqlParameterSource("id", roomId), (rs, i) -> mapRoom(rs));
        if (rows.isEmpty()) return null;
        Room room = rows.get(0);
        return room.withTeams(teams(roomId));
    }

    public List<String> teams(String roomId) {
        return jdbc.queryForList("SELECT team FROM agent_room_teams WHERE room_id = :id::uuid ORDER BY team",
                new MapSqlParameterSource("id", roomId), String.class);
    }

    /** Salas visibles: las de un equipo, o todas si team es null (admin). */
    public List<Room> listRooms(String team) {
        String filter = team == null ? "" : """
                WHERE EXISTS (SELECT 1 FROM agent_room_teams t WHERE t.room_id = r.id AND t.team = :team)
                """;
        // Los equipos viajan en la misma consulta para no hacer una por sala.
        return jdbc.query("""
                SELECT r.id::text AS id, r.title, r.topic, r.created_by_team, r.status, r.last_seq,
                       r.created_at, r.updated_at,
                       ARRAY(SELECT rt.team FROM agent_room_teams rt WHERE rt.room_id = r.id ORDER BY rt.team) AS teams
                FROM agent_rooms r
                """ + filter + " ORDER BY r.updated_at DESC LIMIT 200",
                new MapSqlParameterSource("team", team),
                (rs, i) -> mapRoom(rs).withTeams(List.of((String[]) rs.getArray("teams").getArray())));
    }

    public long nextSeq(String roomId) {
        Long seq = jdbc.queryForObject("""
                UPDATE agent_rooms SET last_seq = last_seq + 1, updated_at = now()
                WHERE id = :id::uuid RETURNING last_seq
                """, new MapSqlParameterSource("id", roomId), Long.class);
        return seq == null ? 0L : seq;
    }

    public Message insertMessage(String roomId, long seq, RoomActor actor, String authorKind,
                                 String kind, String body) {
        return jdbc.queryForObject("""
                INSERT INTO agent_room_messages
                    (room_id, seq, author_user_id, author_name, author_team, author_kind, api_key_id, kind, body)
                VALUES (:roomId::uuid, :seq, :userId::uuid, :name, :team, :authorKind, :apiKeyId::uuid, :kind, :body)
                RETURNING id::text AS id, seq, author_name, author_team, author_kind, kind, body, created_at
                """, new MapSqlParameterSource()
                .addValue("roomId", roomId)
                .addValue("seq", seq)
                .addValue("userId", actor == null ? null : actor.userId())
                .addValue("name", actor == null ? "Skill Hub" : actor.name())
                .addValue("team", actor == null || !actor.hasTeam() ? "-" : actor.team())
                .addValue("authorKind", authorKind)
                .addValue("apiKeyId", actor == null ? null : actor.apiKeyId())
                .addValue("kind", kind)
                .addValue("body", body), (rs, i) -> mapMessage(rs));
    }

    public List<Message> messagesSince(String roomId, long sinceSeq, int limit) {
        return jdbc.query("""
                SELECT id::text AS id, seq, author_name, author_team, author_kind, kind, body, created_at
                FROM agent_room_messages
                WHERE room_id = :roomId::uuid AND seq > :since
                ORDER BY seq LIMIT :limit
                """, new MapSqlParameterSource("roomId", roomId)
                .addValue("since", sinceSeq)
                .addValue("limit", limit), (rs, i) -> mapMessage(rs));
    }

    public Contract latestContract(String roomId) {
        List<Contract> rows = jdbc.query("""
                SELECT version, format, content, proposed_by_team, created_at
                FROM agent_room_contracts WHERE room_id = :roomId::uuid
                ORDER BY version DESC LIMIT 1
                """, new MapSqlParameterSource("roomId", roomId), (rs, i) -> new Contract(
                rs.getInt("version"), rs.getString("format"), rs.getString("content"),
                rs.getString("proposed_by_team"), instantString(rs.getObject("created_at"))));
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void insertContract(String roomId, int version, String format, String content,
                               RoomActor actor, String messageId) {
        jdbc.update("""
                INSERT INTO agent_room_contracts
                    (room_id, version, format, content, proposed_by, proposed_by_team, message_id)
                VALUES (:roomId::uuid, :version, :format, :content, :userId::uuid, :team, :messageId::uuid)
                """, new MapSqlParameterSource()
                .addValue("roomId", roomId)
                .addValue("version", version)
                .addValue("format", format)
                .addValue("content", content)
                .addValue("userId", actor.userId())
                .addValue("team", actor.hasTeam() ? actor.team() : "-")
                .addValue("messageId", messageId));
    }

    public List<String> acceptedTeams(String roomId, int version) {
        return jdbc.queryForList("""
                SELECT team FROM agent_room_acceptances
                WHERE room_id = :roomId::uuid AND version = :version ORDER BY created_at
                """, new MapSqlParameterSource("roomId", roomId).addValue("version", version), String.class);
    }

    public boolean insertAcceptance(String roomId, int version, String team, String userId) {
        return jdbc.update("""
                INSERT INTO agent_room_acceptances (room_id, version, team, user_id)
                VALUES (:roomId::uuid, :version, :team, :userId::uuid)
                ON CONFLICT DO NOTHING
                """, new MapSqlParameterSource()
                .addValue("roomId", roomId)
                .addValue("version", version)
                .addValue("team", team)
                .addValue("userId", userId)) > 0;
    }

    public void setStatus(String roomId, String status) {
        jdbc.update("UPDATE agent_rooms SET status = :status, updated_at = now() WHERE id = :id::uuid",
                new MapSqlParameterSource("id", roomId).addValue("status", status));
    }

    private Room mapRoom(ResultSet rs) throws SQLException {
        return new Room(rs.getString("id"), rs.getString("title"), rs.getString("topic"),
                rs.getString("created_by_team"), rs.getString("status"), rs.getLong("last_seq"),
                instantString(rs.getObject("created_at")), instantString(rs.getObject("updated_at")), List.of());
    }

    private Message mapMessage(ResultSet rs) throws SQLException {
        return new Message(rs.getString("id"), rs.getLong("seq"), rs.getString("author_name"),
                rs.getString("author_team"), rs.getString("author_kind"), rs.getString("kind"),
                rs.getString("body"), instantString(rs.getObject("created_at")));
    }

    private String instantString(Object value) {
        if (value == null) return null;
        if (value instanceof OffsetDateTime dateTime) return dateTime.toInstant().toString();
        if (value instanceof Timestamp timestamp) return timestamp.toInstant().toString();
        return value.toString();
    }

    public record Room(String id, String title, String topic, String createdByTeam, String status,
                       long lastSeq, String createdAt, String updatedAt, List<String> teams) {
        Room withTeams(List<String> value) {
            return new Room(id, title, topic, createdByTeam, status, lastSeq, createdAt, updatedAt, value);
        }

        public Map<String, Object> toMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", id);
            out.put("title", title);
            out.put("topic", topic);
            out.put("createdByTeam", createdByTeam);
            out.put("status", status);
            out.put("lastSeq", lastSeq);
            out.put("teams", teams);
            out.put("createdAt", createdAt);
            out.put("updatedAt", updatedAt);
            return out;
        }
    }

    public record Message(String id, long seq, String authorName, String authorTeam, String authorKind,
                          String kind, String body, String createdAt) {
        public Map<String, Object> toMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", id);
            out.put("seq", seq);
            out.put("authorName", authorName);
            out.put("authorTeam", authorTeam);
            out.put("authorKind", authorKind);
            out.put("kind", kind);
            out.put("body", body);
            out.put("createdAt", createdAt);
            return out;
        }
    }

    public record Contract(int version, String format, String content, String proposedByTeam, String createdAt) {}
}
