package com.skillhub.team;

import java.util.Arrays;

/** Equipos oficiales de microservicios. El valor persistido es su etiqueta canónica. */
public enum Team {
    IDENTITY_AND_USERS("Identidad y Usuarios"),
    COURSES_AND_ENROLLMENT("Cursos y Matrícula"),
    CHALLENGE_ENGINE("Motor de Desafíos"),
    THEORY_AND_SURVEYS("Teóricos y Encuestas"),
    PRACTICAL_CHALLENGES("Desafíos Prácticos"),
    SANDBOX_RUNTIME("Sandbox / Runtime"),
    LLM_EVALUATION("Evaluación LLM"),
    BANK("Banco"),
    MARKET("Mercado"),
    ROADMAP_AND_PROGRESS("Roadmap y Progreso"),
    SOCIAL_AND_NOTIFICATIONS("Social y Notificaciones"),
    BACKOFFICE("Backoffice");

    private final String label;

    Team(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static String canonicalOrNull(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String value = raw.trim();
        return Arrays.stream(values())
                .filter(team -> team.label.equals(value))
                .map(Team::label)
                .findFirst()
                .orElse(null);
    }
}
