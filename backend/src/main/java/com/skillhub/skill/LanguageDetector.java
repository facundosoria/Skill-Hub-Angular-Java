package com.skillhub.skill;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Puerto de src/server/skills/language.ts.
 *
 * Detector conservador de espanol/ingles. El catalogo admite ambos idiomas
 * (hay indice full-text para los dos, ver V17__skill_language.sql); lo que no
 * se admite es que un mismo skill mezcle idiomas entre sus campos, porque eso
 * degrada la lectura tanto para una persona como para un agente. Solo marca
 * con evidencia clara y nunca por una palabra suelta ("Modal", "Toast",
 * "Skeleton" son iguales en los dos idiomas).
 */
public final class LanguageDetector {

    private LanguageDetector() {}

    private static final Pattern CARACTERES_ES = Pattern.compile("[ñÑ¿¡áéíóúÁÉÍÓÚ]");
    private static final Pattern TOKEN_RE = Pattern.compile("[a-záéíóúñü]+");
    private static final Pattern FENCE_RE = Pattern.compile("```[\\s\\S]*?```");
    private static final Pattern INLINE_CODE_RE = Pattern.compile("`[^`]*`");

    private static final Set<String> PALABRAS_ES = Set.of(
            "el","la","los","las","un","una","unos","unas",
            "de","del","al","en","con","por","para","sin","sobre",
            "que","cuando","donde","como","porque","si","no",
            "es","son","está","estan","están","ser","hay","tiene","tienen",
            "se","su","sus","este","esta","estos","estas","eso","esto",
            "usar","usa","use","debe","deben","puede","pueden","hacer",
            "siempre","nunca","cada","todo","toda","todos","todas",
            "mismo","misma","más","mas","muy","también","pero","o","y");

    private static final Set<String> PALABRAS_EN = Set.of(
            "the","a","an","of","to","in","on","for","with","without","about",
            "and","or","but","if","not","when","where","how","why","because",
            "is","are","be","was","were","has","have","does","do",
            "it","its","this","that","these","those","there",
            "use","uses","used","should","must","can","never","always",
            "every","each","all","one","same","more","also","than","then");

    public record Deteccion(boolean esEspanol, List<String> senales) {}

    public static Deteccion detectarEspanol(String texto) {
        String limpio = texto == null ? "" : texto.trim();
        if (limpio.length() < 12) return new Deteccion(false, List.of());

        List<String> senales = new ArrayList<>();
        String sinCodigo = INLINE_CODE_RE.matcher(
                FENCE_RE.matcher(limpio).replaceAll(" ")).replaceAll(" ");

        Matcher acentosM = CARACTERES_ES.matcher(sinCodigo);
        Set<String> acentos = new LinkedHashSet<>();
        while (acentosM.find()) acentos.add(acentosM.group());
        boolean hayAcentos = !acentos.isEmpty();
        if (hayAcentos) senales.add("caracteres del espanol: " + String.join(" ", acentos));

        List<String> tokens = tokenize(limpio);
        List<String> es = tokens.stream().filter(PALABRAS_ES::contains).toList();
        List<String> en = tokens.stream().filter(PALABRAS_EN::contains).toList();
        List<String> esUnicas = new ArrayList<>(new LinkedHashSet<>(es));
        if (!esUnicas.isEmpty())
            senales.add("palabras en espanol: " + String.join(", ", esUnicas.subList(0, Math.min(6, esUnicas.size()))));

        boolean porCaracteres = hayAcentos && !esUnicas.isEmpty();
        boolean porVocabulario = es.size() >= 3 && es.size() > en.size() * 1.5;
        return new Deteccion(porCaracteres || porVocabulario, senales);
    }

    private static List<String> tokenize(String texto) {
        String limpio = INLINE_CODE_RE.matcher(
                FENCE_RE.matcher(texto.toLowerCase()).replaceAll(" ")).replaceAll(" ");
        List<String> out = new ArrayList<>();
        Matcher m = TOKEN_RE.matcher(limpio);
        while (m.find()) out.add(m.group());
        return out;
    }

    /**
     * Idioma resuelto para el skill ("es"/"en") y si sus campos son
     * consistentes entre si. `camposEnMinoria` lista los campos decididos que
     * quedaron del lado minoritario: eso es lo unico que de verdad hay que
     * bloquear, no el idioma en si.
     */
    public record Clasificacion(String idioma, boolean consistente, List<String> camposEnMinoria) {}

    public static Clasificacion clasificarIdiomaSkill(String title, String description,
                                                       String whenToUse, String content) {
        String[][] campos = {
                {"title", title}, {"description", description},
                {"whenToUse", whenToUse}, {"content", content}};

        List<String[]> porCampo = new ArrayList<>(); // {campo, "es"|"en"|null si ambiguo}
        List<String> decididos = new ArrayList<>();
        for (String[] par : campos) {
            String texto = par[1] == null ? "" : par[1].trim();
            if (texto.length() < 12) {
                porCampo.add(new String[]{par[0], null});
                continue;
            }
            String idiomaCampo = detectarEspanol(texto).esEspanol() ? "es" : "en";
            porCampo.add(new String[]{par[0], idiomaCampo});
            decididos.add(idiomaCampo);
        }
        if (decididos.isEmpty()) return new Clasificacion("en", true, List.of());

        long esCount = decididos.stream().filter("es"::equals).count();
        long enCount = decididos.size() - esCount;
        String mayoria = esCount > enCount ? "es" : "en";
        List<String> minoria = porCampo.stream()
                .filter(c -> c[1] != null && !c[1].equals(mayoria))
                .map(c -> c[0])
                .toList();
        return new Clasificacion(mayoria, minoria.isEmpty(), minoria);
    }
}
