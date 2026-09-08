package com.skillhub.skill;

import java.util.List;

/**
 * Skill "completo" tal como lo devuelve getSkillBySlug en
 * src/server/skills/service.ts: la fila de skills mas la version vigente, los
 * tags y el slug del reemplazo si esta deprecado.
 */
public record Skill(
        String id,
        String slug,
        String title,
        String description,
        String whenToUse,
        String stack,
        String type,
        String status,
        String ownerTeam,
        String origin,
        String pendingVersionId,
        String supersededBySlug,
        List<String> tags,
        SkillVersion version
) {
    public record SkillVersion(int version, String content, String preview) {}
}
