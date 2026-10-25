package com.skillhub.skill;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Limites del alta de skills: los mismos que el esquema original, con
 * description y when_to_use acotados porque viajan al agente en cada busqueda.
 */
class SkillInputTest {

    private static SkillInput valid() {
        return new SkillInput("mi-skill", "Mi skill", "Descripcion suficiente", "Cuando haga falta algo",
                "java", "skill", "Banco", List.of("java", "api"), "Contenido con mas de veinte caracteres",
                "Primera version", null);
    }

    private static SkillInput with(java.util.function.UnaryOperator<Object[]> change) {
        SkillInput v = valid();
        Object[] f = {v.slug(), v.title(), v.description(), v.whenToUse(), v.stack(), v.type(), v.ownerTeam(),
                v.tags(), v.content(), v.changelog(), v.duplicateJustification()};
        f = change.apply(f);
        @SuppressWarnings("unchecked") List<String> tags = (List<String>) f[7];
        return new SkillInput((String) f[0], (String) f[1], (String) f[2], (String) f[3], (String) f[4],
                (String) f[5], (String) f[6], tags, (String) f[8], (String) f[9], (String) f[10]);
    }

    private static SkillInput set(int index, Object value) {
        return with(f -> { f[index] = value; return f; });
    }

    @Test
    void aCompleteInputHasNoErrors() {
        assertThat(valid().validate()).isEmpty();
    }

    @Test
    void optionalFieldsMayBeNull() {
        SkillInput input = with(f -> { f[5] = null; f[6] = null; f[7] = null; f[9] = null; f[10] = null; return f; });

        assertThat(input.validate()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"ab", "Mayus", "con espacio", "-inicio", "fin-", "doble--guion"})
    void rejectsInvalidSlugs(String slug) {
        assertThat(set(0, slug).validate()).containsExactly("slug: Solo minusculas, numeros y guiones");
        assertThat(SkillInput.isValidSlug(slug)).isFalse();
    }

    @Test
    void slugLengthLimits() {
        assertThat(set(0, null).validate()).hasSize(1);
        assertThat(set(0, "a".repeat(65)).validate()).hasSize(1);
        assertThat(set(0, "a".repeat(64)).validate()).isEmpty();
        assertThat(SkillInput.isValidSlug(null)).isFalse();
        assertThat(SkillInput.isValidSlug("a".repeat(65))).isFalse();
        assertThat(SkillInput.isValidSlug("abc-123")).isTrue();
    }

    @Test
    void titleMustBeBetweenThreeAndOneHundredTwentyCharacters() {
        assertThat(set(1, null).validate()).containsExactly("title: entre 3 y 120 caracteres");
        assertThat(set(1, "ab").validate()).hasSize(1);
        assertThat(set(1, "t".repeat(121)).validate()).hasSize(1);
        assertThat(set(1, "t".repeat(120)).validate()).isEmpty();
    }

    @Test
    void descriptionHasAMinimumAndTheAgentContextMaximum() {
        assertThat(set(2, null).validate()).containsExactly("description: minimo 10 caracteres");
        assertThat(set(2, "corta").validate()).containsExactly("description: minimo 10 caracteres");
        assertThat(set(2, "d".repeat(201)).validate()).singleElement().asString()
                .startsWith("description: 201 caracteres, el maximo es 200");
        assertThat(set(2, "d".repeat(200)).validate()).isEmpty();
    }

    @Test
    void whenToUseHasAMinimumAndTheAgentContextMaximum() {
        assertThat(set(3, null).validate()).containsExactly("whenToUse: minimo 10 caracteres");
        assertThat(set(3, "corta").validate()).containsExactly("whenToUse: minimo 10 caracteres");
        assertThat(set(3, "w".repeat(201)).validate()).singleElement().asString()
                .startsWith("whenToUse: 201 caracteres, el maximo es 200");
    }

    @Test
    void stackAndTypeMustBeKnownValues() {
        assertThat(set(4, null).validate()).singleElement().asString().startsWith("stack: uno de");
        assertThat(set(4, "python").validate()).singleElement().asString().startsWith("stack: uno de");
        assertThat(set(5, "otro").validate()).singleElement().asString().startsWith("type: uno de");
        for (String type : List.of("skill", "convention", "reference", "plugin", "contract")) {
            assertThat(set(5, type).validate()).as(type).isEmpty();
        }
    }

    @Test
    void ownerTeamIsLimitedToEightyCharacters() {
        assertThat(set(6, "e".repeat(81)).validate()).containsExactly("ownerTeam: maximo 80 caracteres");
        assertThat(set(6, "e".repeat(80)).validate()).isEmpty();
    }

    @Test
    void tagsAreLimitedInCountAndLength() {
        assertThat(set(7, Collections.nCopies(13, "t")).validate()).containsExactly("tags: maximo 12");
        assertThat(set(7, List.of("ok", "")).validate()).containsExactly("tags: cada tag entre 1 y 40 caracteres");
        assertThat(set(7, List.of("x".repeat(41), "")).validate()).containsExactly("tags: cada tag entre 1 y 40 caracteres");
        assertThat(set(7, List.of()).validate()).isEmpty();
    }

    @Test
    void contentChangelogAndJustificationLimits() {
        assertThat(set(8, null).validate()).containsExactly("content: minimo 20 caracteres");
        assertThat(set(8, "corto").validate()).containsExactly("content: minimo 20 caracteres");
        assertThat(set(9, "c".repeat(501)).validate()).containsExactly("changelog: maximo 500 caracteres");
        assertThat(set(10, "j".repeat(501)).validate()).containsExactly("duplicateJustification: maximo 500 caracteres");
        assertThat(set(10, "j".repeat(500)).validate()).isEmpty();
    }

    @Test
    void reportsEveryProblemAtOnce() {
        SkillInput empty = new SkillInput(null, null, null, null, null, null, null, null, null, null, null);

        assertThat(empty.validate()).hasSize(6);
    }

    @Test
    void slugifyRemovesAccentsSymbolsAndEdgeDashes() {
        assertThat(SkillInput.slugify("Ñandú: Guía Rápida!")).isEqualTo("nandu-guia-rapida");
        assertThat(SkillInput.slugify("--Hola   Mundo--")).isEqualTo("hola-mundo");
        assertThat(SkillInput.slugify("x".repeat(70))).hasSize(64);
        assertThat(SkillInput.slugify("¡¿?!")).isEmpty();
    }
}
