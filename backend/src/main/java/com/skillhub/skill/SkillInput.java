package com.skillhub.skill;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Puerto de skillInputSchema de src/server/skills/schema.ts.
 *
 * Los topes de longitud (decision 16): description y when_to_use viajan al
 * contexto del agente en CADA busqueda. Sin limite, alguien pega tres parrafos
 * y le encarece todas las tareas a toda la organizacion.
 */
public record SkillInput(
        String slug,
        String title,
        String description,
        String whenToUse,
        String stack,
        String type,
        String ownerTeam,
        List<String> tags,
        String content,
        String changelog,
        String duplicateJustification
) {
    public static final int MAX_DESCRIPTION = 200;
    public static final int MAX_WHEN_TO_USE = 200;
    public static final int SEARCH_RESULT_LIMIT = 5;

    private static final Pattern SLUG_RE = Pattern.compile("^[a-z0-9]+(-[a-z0-9]+)*$");
    private static final List<String> STACKS = List.of("angular", "java", "shared", "infra");
    private static final List<String> TYPES = List.of("skill", "convention", "reference");

    /** Mismo criterio que validate(): 3-64 chars, solo minusculas, numeros y guiones. */
    public static boolean isValidSlug(String slug) {
        return slug != null && slug.length() >= 3 && slug.length() <= 64
                && SLUG_RE.matcher(slug).matches();
    }

    /** Igual que slugify() del original: NFD, sin diacriticos, [^a-z0-9]->'-', trim, 64. */
    public static String slugify(String input) {
        String noDiacritics = Normalizer.normalize(input, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "");
        String s = noDiacritics.toLowerCase()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return s.length() > 64 ? s.substring(0, 64) : s;
    }

    /**
     * Valida los mismos limites que skillInputSchema. Devuelve la lista de
     * errores con el formato "campo: mensaje" (igual que el .map de propose.ts).
     */
    public List<String> validate() {
        List<String> errs = new ArrayList<>();
        if (slug == null || slug.length() < 3 || slug.length() > 64 || !SLUG_RE.matcher(slug).matches())
            errs.add("slug: Solo minusculas, numeros y guiones");
        if (title == null || title.length() < 3 || title.length() > 120)
            errs.add("title: entre 3 y 120 caracteres");
        if (description == null || description.length() < 10)
            errs.add("description: minimo 10 caracteres");
        else if (description.length() > MAX_DESCRIPTION)
            errs.add("description: Maximo " + MAX_DESCRIPTION
                    + " caracteres: viaja al contexto del agente en cada busqueda");
        if (whenToUse == null || whenToUse.length() < 10)
            errs.add("whenToUse: minimo 10 caracteres");
        else if (whenToUse.length() > MAX_WHEN_TO_USE)
            errs.add("whenToUse: Maximo " + MAX_WHEN_TO_USE
                    + " caracteres: viaja al contexto del agente en cada busqueda");
        if (stack == null || !STACKS.contains(stack))
            errs.add("stack: uno de " + STACKS);
        if (type != null && !TYPES.contains(type))
            errs.add("type: uno de " + TYPES);
        if (ownerTeam != null && ownerTeam.length() > 80)
            errs.add("ownerTeam: maximo 80 caracteres");
        if (tags != null) {
            if (tags.size() > 12) errs.add("tags: maximo 12");
            for (String t : tags) {
                if (t.isEmpty() || t.length() > 40) { errs.add("tags: cada tag entre 1 y 40 caracteres"); break; }
            }
        }
        if (content == null || content.length() < 20)
            errs.add("content: minimo 20 caracteres");
        if (changelog != null && changelog.length() > 500)
            errs.add("changelog: maximo 500 caracteres");
        if (duplicateJustification != null && duplicateJustification.length() > 500)
            errs.add("duplicateJustification: maximo 500 caracteres");
        return errs;
    }
}
