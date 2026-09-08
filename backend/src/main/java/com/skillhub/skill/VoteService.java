package com.skillhub.skill;

import com.skillhub.audit.AuditService;
import com.skillhub.web.DomainException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Puerto de src/server/skills/votes.ts.
 *
 * Un voto por persona por version propuesta. Al llegar a VOTES_REQUIRED la
 * propuesta se aplica sola, en el mismo paso: nadie tiene que volver a entrar a
 * "aprobar" algo que la comunidad ya decidio. Un admin puede saltear esto con
 * applyPendingEdit directo.
 */
@Service
public class VoteService {

    public static final int VOTES_REQUIRED = 3;

    private final NamedParameterJdbcTemplate jdbc;
    private final AuditService audit;
    private final SkillWriteService write;

    public VoteService(NamedParameterJdbcTemplate jdbc, AuditService audit, SkillWriteService write) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.write = write;
    }

    public record VoteStatus(String pendingVersionId, int votes, int required,
                             boolean yaVoto, boolean esAutor) {}

    public VoteStatus getVoteStatus(String skillId, String userId) {
        String pending = jdbc.query(
                "SELECT pending_version_id::text FROM skills WHERE id = :id::uuid",
                new MapSqlParameterSource("id", skillId), rs -> rs.next() ? rs.getString(1) : null);
        if (pending == null) return null;

        String authorId = jdbc.query(
                "SELECT author_id::text FROM skill_versions WHERE id = :id::uuid",
                new MapSqlParameterSource("id", pending), rs -> rs.next() ? rs.getString(1) : null);
        int count = countVotes(pending);
        boolean yaVoto = !jdbc.queryForList("""
                SELECT 1 FROM skill_edit_votes WHERE version_id = :v::uuid AND voter_id = :u::uuid LIMIT 1
                """, new MapSqlParameterSource().addValue("v", pending).addValue("u", userId)).isEmpty();

        return new VoteStatus(pending, count, VOTES_REQUIRED, yaVoto, userId.equals(authorId));
    }

    public record CastResult(int votes, int required, boolean applied) {}

    @Transactional
    public CastResult castVote(String skillId, String voterId) {
        Map<String, Object> skill;
        try {
            skill = jdbc.queryForMap(
                    "SELECT slug, pending_version_id::text AS pid FROM skills WHERE id = :id::uuid",
                    new MapSqlParameterSource("id", skillId));
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new DomainException("No existe el skill");
        }
        String versionId = (String) skill.get("pid");
        if (versionId == null) throw new DomainException("No hay ninguna edicion esperando votos");

        String authorId = jdbc.query(
                "SELECT author_id::text FROM skill_versions WHERE id = :id::uuid",
                new MapSqlParameterSource("id", versionId), rs -> rs.next() ? rs.getString(1) : null);
        if (voterId.equals(authorId)) throw new DomainException("No podes votar tu propia propuesta");

        jdbc.update("""
                INSERT INTO skill_edit_votes (skill_id, version_id, voter_id)
                VALUES (:s::uuid, :v::uuid, :u::uuid) ON CONFLICT DO NOTHING
                """, new MapSqlParameterSource().addValue("s", skillId).addValue("v", versionId).addValue("u", voterId));

        int count = countVotes(versionId);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("slug", skill.get("slug"));
        meta.put("versionId", versionId);
        meta.put("votes", count);
        meta.put("required", VOTES_REQUIRED);
        audit.logAudit(voterId, "skill.vote_cast", "skill", skillId, meta);

        boolean applied = false;
        if (count >= VOTES_REQUIRED) {
            write.applyPendingEdit(skillId);
            applied = true;
            audit.logAudit(null, "skill.vote_applied", "skill", skillId,
                    Map.of("slug", skill.get("slug"), "versionId", versionId));
        }
        return new CastResult(Math.min(count, VOTES_REQUIRED), VOTES_REQUIRED, applied);
    }

    private int countVotes(String versionId) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*)::int FROM skill_edit_votes WHERE version_id = :v::uuid",
                new MapSqlParameterSource("v", versionId), Integer.class);
        return n == null ? 0 : n;
    }
}
