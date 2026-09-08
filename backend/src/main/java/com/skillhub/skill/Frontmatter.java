package com.skillhub.skill;

import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Puerto de src/server/skills/frontmatter.ts.
 *
 * Un skill es markdown con frontmatter YAML. El bloque ```preview es HTML+CSS
 * autocontenido para que lo mire una persona; nunca se le manda al agente.
 */
public final class Frontmatter {

    private static final Pattern FRONTMATTER_RE =
            Pattern.compile("^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?");
    private static final Pattern PREVIEW_RE =
            Pattern.compile("```preview\\r?\\n([\\s\\S]*?)```");

    private Frontmatter() {}

    public static String extractPreview(String body) {
        if (body == null) return null;
        Matcher m = PREVIEW_RE.matcher(body);
        return m.find() ? m.group(1).trim() : null;
    }

    /**
     * Reconstruye el frontmatter DETERMINISTICAMENTE desde las columnas
     * canonicas. Orden de claves fijo: un test snapshotea el string resultante.
     * slug/title/description/when_to_use/stack/type siempre; owner_team y tags
     * solo si tienen valor; version despues de type.
     */
    public static Map<String, Object> buildSkillFrontmatter(
            String slug, String title, String description, String whenToUse,
            String stack, String type, String ownerTeam, int version, List<String> tags) {
        Map<String, Object> fm = new LinkedHashMap<>();
        fm.put("slug", slug);
        fm.put("title", title);
        fm.put("description", description);
        fm.put("when_to_use", whenToUse);
        fm.put("stack", stack);
        fm.put("type", type);
        if (ownerTeam != null && !ownerTeam.isBlank()) fm.put("owner_team", ownerTeam);
        fm.put("version", version);
        if (tags != null && !tags.isEmpty()) fm.put("tags", tags);
        return fm;
    }

    public static String serializeSkillFile(Map<String, Object> frontmatter, String body) {
        DumperOptions opts = new DumperOptions();
        opts.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        opts.setWidth(100);
        opts.setPrettyFlow(false);
        String fm = new Yaml(opts).dump(frontmatter).stripTrailing();
        return "---\n" + fm + "\n---\n\n" + body.stripLeading();
    }

    /**
     * Texto plano que alimenta el indice full-text. title + description +
     * when_to_use + tags + content, en ese orden, unidos por saltos de linea.
     */
    public static String buildSearchText(String title, String description, String whenToUse,
                                         List<String> tags, String content) {
        String tagStr = tags == null ? "" : String.join(" ", tags);
        return String.join("\n", List.of(
                        nz(title), nz(description), nz(whenToUse), tagStr, nz(content)).stream()
                .filter(s -> s != null && !s.isEmpty())
                .toList());
    }

    /**
     * Saca el bloque ```preview antes de mandar el cuerpo al agente. Devuelve el
     * cuerpo limpio y, si habia preview, un aviso de que existe.
     */
    public record Stripped(String content, String visualExample) {}

    public static Stripped stripPreview(String content) {
        if (content == null) return new Stripped("", null);
        String sinPreview = PREVIEW_RE.matcher(content).replaceAll("")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();
        if (sinPreview.equals(content.trim())) {
            return new Stripped(content, null);
        }
        return new Stripped(sinPreview,
                "This skill has a rendered visual example. It is not included here because it is "
                        + "HTML meant for people; point the user to the skill page in the web app if "
                        + "they want to see it.");
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
