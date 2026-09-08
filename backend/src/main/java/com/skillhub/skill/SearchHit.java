package com.skillhub.skill;

/** Puerto de SearchHit de src/server/skills/search.ts. */
public record SearchHit(
        String slug,
        String title,
        String description,
        String whenToUse,
        String stack,
        String type,
        String ownerTeam,
        String status,
        int version,
        int usos90d,
        int personas
) {}
