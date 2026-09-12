package com.skillhub.skill;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Puerto de src/server/skills/language.ts.
 *
 * Clasificador de idioma por campo (ingles/espanol/ambiguo). El catalogo
 * admite los dos idiomas (hay indice full-text para los dos, ver
 * V17__skill_language.sql); lo que no se admite es que un mismo skill mezcle
 * idiomas entre sus campos, porque eso degrada la lectura tanto para una
 * persona como para un agente.
 *
 * Por campo se cuentan coincidencias contra dos listas chicas de palabras
 * funcionales (articulos, preposiciones, conectores) mas los caracteres
 * propios del espanol (ñ, acentos, ¿¡); gana el idioma con mas coincidencias,
 * y CUALQUIER empate -- incluido 0 a 0, el caso tipico de un titulo corto o
 * generico ("Plantilla de historia de usuario" solo pega en "de") -- queda
 * ambiguo y no vota. Es deliberadamente conservador en los dos sentidos:
 * nunca decide por una palabra suelta ("Modal", "Toast", "Skeleton" son
 * iguales en los dos idiomas), y jerga o nombres propios que no estan en
 * ninguna lista (Figma, Swagger, WCAG, backlog, Mock API...) no cuentan para
 * ningun lado, asi que no empujan un campo hacia el idioma equivocado.
 */
public final class LanguageDetector {

    private LanguageDetector() {}

    private static final Pattern CARACTERES_ES = Pattern.compile("[ñÑ¿¡áéíóúÁÉÍÓÚ]");
    private static final Pattern TOKEN_RE = Pattern.compile("[a-záéíóúñü]+");
    private static final Pattern FENCE_RE = Pattern.compile("```[\\s\\S]*?```");
    private static final Pattern INLINE_CODE_RE = Pattern.compile("`[^`]*`");

    private static final int MIN_CHARS_DECIDIBLE = 12;

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

    private static List<String> tokenize(String texto) {
        String limpio = INLINE_CODE_RE.matcher(
                FENCE_RE.matcher(texto.toLowerCase()).replaceAll(" ")).replaceAll(" ");
        List<String> out = new ArrayList<>();
        Matcher m = TOKEN_RE.matcher(limpio);
        while (m.find()) out.add(m.group());
        return out;
    }

    /**
     * Idioma de UN campo ("es"/"en"), o null si no hay evidencia suficiente:
     * texto corto (menos de {@link #MIN_CHARS_DECIDIBLE} caracteres), o
     * empate entre las dos listas -- 0 a 0 incluido, que es exactamente lo
     * que pasa con un titulo generico o con jerga tecnica en ingles que no
     * aparece en ninguna de las dos listas.
     */
    private static String idiomaDeCampo(String texto) {
        String limpio = texto == null ? "" : texto.trim();
        if (limpio.length() < MIN_CHARS_DECIDIBLE) return null;

        String sinCodigo = INLINE_CODE_RE.matcher(
                FENCE_RE.matcher(limpio).replaceAll(" ")).replaceAll(" ");
        boolean hayAcentos = CARACTERES_ES.matcher(sinCodigo).find();

        List<String> tokens = tokenize(limpio);
        long es = tokens.stream().filter(PALABRAS_ES::contains).count() + (hayAcentos ? 1 : 0);
        long en = tokens.stream().filter(PALABRAS_EN::contains).count();

        if (es > en) return "es";
        if (en > es) return "en";
        return null;
    }

    /**
     * Idioma resuelto para el skill ("es"/"en") y si sus campos son
     * consistentes entre si. `camposEnMinoria` lista los campos decididos que
     * quedaron del lado minoritario: eso es lo unico que de verdad hay que
     * bloquear, no el idioma en si. Un campo ambiguo (ver
     * {@link #idiomaDeCampo}) no vota ni puede quedar en minoria.
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
            String idiomaCampo = idiomaDeCampo(par[1]);
            porCampo.add(new String[]{par[0], idiomaCampo});
            if (idiomaCampo != null) decididos.add(idiomaCampo);
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
