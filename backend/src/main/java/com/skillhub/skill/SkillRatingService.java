package com.skillhub.skill;

import com.skillhub.audit.AuditService;
import com.skillhub.web.DomainException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Types;
import java.util.Collections;
import java.util.Map;

/** Calificaciones y comentarios de los usuarios para los elementos del catálogo. */
@Service
public class SkillRatingService {

    private final NamedParameterJdbcTemplate jdbc;
    private final AuditService audit;

    public SkillRatingService(NamedParameterJdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public void rate(String skillId, String voterId, Integer rating, String comment) {
        String type;
        try {
            type = jdbc.queryForObject(
                    "SELECT type::text FROM skills WHERE id = :id::uuid",
                    new MapSqlParameterSource("id", skillId),
                    String.class);
        } catch (EmptyResultDataAccessException e) {
            throw new DomainException("No existe el elemento a calificar");
        }

        boolean isContract = "contract".equalsIgnoreCase(type);
        Integer finalRating;
        if (isContract) {
            finalRating = null;
        } else {
            if (rating == null || rating < 1 || rating > 5) {
                throw new DomainException("La calificacion debe estar entre 1 y 5 estrellas");
            }
            finalRating = rating;
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
                .addValue("rating", finalRating, Types.INTEGER)
                .addValue("comment", normalizedComment));

        if (isContract) {
            audit.logAudit(voterId, "contract.commented", "skill", skillId, Collections.emptyMap());
        } else {
            audit.logAudit(voterId, "skill.rated", "skill", skillId, Map.of("rating", finalRating));
        }
    }
}
