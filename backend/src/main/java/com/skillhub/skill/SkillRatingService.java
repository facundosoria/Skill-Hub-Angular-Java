package com.skillhub.skill;

import com.skillhub.audit.AuditService;
import com.skillhub.web.DomainException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

/** Calificaciones y comentarios de los usuarios para los elementos del catálogo. */
@Service
public class SkillRatingService {

    private final NamedParameterJdbcTemplate jdbc;
    private final AuditService audit;

    public SkillRatingService(NamedParameterJdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public void rate(String skillId, String voterId, int rating, String comment) {
        if (rating < 1 || rating > 5) {
            throw new DomainException("La calificacion debe estar entre 1 y 5 estrellas");
        }
        String normalizedComment = comment == null ? "" : comment.trim();
        if (normalizedComment.isEmpty() || normalizedComment.length() > 2000) {
            throw new DomainException("El comentario debe tener entre 1 y 2000 caracteres");
        }

        jdbc.update("""
                INSERT INTO skill_ratings (skill_id, voter_id, rating, comment)
                VALUES (:skillId::uuid, :voterId::uuid, :rating, :comment)
                ON CONFLICT (skill_id, voter_id) DO UPDATE SET
                    rating = EXCLUDED.rating,
                    comment = EXCLUDED.comment,
                    updated_at = now()
                """, new MapSqlParameterSource()
                .addValue("skillId", skillId)
                .addValue("voterId", voterId)
                .addValue("rating", rating)
                .addValue("comment", normalizedComment));
        audit.logAudit(voterId, "skill.rated", "skill", skillId, java.util.Map.of("rating", rating));
    }
}
