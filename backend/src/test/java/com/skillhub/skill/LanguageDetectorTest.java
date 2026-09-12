package com.skillhub.skill;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Reproduccion de un caso reportado: una plantilla en espanol que incrusta
 * jerga tecnica en ingles (MoSCoW, nombres de herramientas, siglas) no deberia
 * quedar marcada como "content en ingles" solo por esas palabras sueltas.
 */
class LanguageDetectorTest {

    private static final String TITLE = "Plantilla de historia de usuario";
    private static final String DESCRIPTION =
            "Plantilla estandar para escribir una historia de usuario, con criterios de aceptacion, "
            + "definicion de terminado y priorizacion MoSCoW.";
    private static final String WHEN_TO_USE =
            "Usar al redactar una historia de usuario nueva para el backlog antes de estimarla en el "
            + "sprint planning.";
    private static final String CONTENT = """
            ## Regla

            Escribir la historia de usuario en espanol usando el formato Como/Quiero/Para.

            Priorizacion MoSCoW: Must / Should / Could / Won't.

            Incluir criterios de aceptacion, un Mock API documentado con Swagger, capturas de diseno de Figma,
            validacion de accesibilidad segun WCAG 2.1 AA, y mantener los componentes sincronizados en Storybook.

            Definition of Done: codigo revisado, tests verdes, deploy a staging, y aprobacion de diseno.

            No mover la tarjeta del backlog a Done sin pasar por code review.
            """;

    @Test
    void plantillaEnEspanolConJergaTecnicaQuedaConsistente() {
        var r = LanguageDetector.clasificarIdiomaSkill(TITLE, DESCRIPTION, WHEN_TO_USE, CONTENT);
        assertThat(r.idioma()).isEqualTo("es");
        assertThat(r.consistente()).isTrue();
    }

    @Test
    void tituloGenericoSinPalabrasFuncionalesNoQuedaAmbiguoPorFalta() {
        // "de" es la unica palabra de la lista funcional -> antes, cualquier
        // campo sin 3+ coincidencias caia por defecto a "en". Con un solo "de"
        // y cero palabras en ingles, ahora domina el espanol igual.
        var r = LanguageDetector.clasificarIdiomaSkill(
                "Plantilla de historia de usuario",
                DESCRIPTION, WHEN_TO_USE, CONTENT);
        assertThat(r.consistente()).isTrue();
    }

    @Test
    void tituloSinNingunaSenalQuedaAmbiguoYNoVota() {
        // ni palabras funcionales ni acentos en ningun idioma -> ambiguo, no
        // fuerza ingles ni español.
        var r = LanguageDetector.clasificarIdiomaSkill(
                "Loading indicators", DESCRIPTION, WHEN_TO_USE, CONTENT);
        assertThat(r.consistente()).isTrue();
    }

    @Test
    void campoRealmenteEnInglesEntreCamposEnEspanolQuedaEnMinoria() {
        var r = LanguageDetector.clasificarIdiomaSkill(
                "Save this button", DESCRIPTION, WHEN_TO_USE, CONTENT);
        assertThat(r.consistente()).isFalse();
        assertThat(r.camposEnMinoria()).containsExactly("title");
    }

    @Test
    void skillEnteramenteEnInglesQuedaConsistente() {
        var r = LanguageDetector.clasificarIdiomaSkill(
                "Buttons",
                "Every clickable action rendered in the interface.",
                "Use when rendering a button, a call to action, or a submit in a form.",
                "## Rule\n\nNever render a bare button. Use the shared AppButton component.");
        assertThat(r.idioma()).isEqualTo("en");
        assertThat(r.consistente()).isTrue();
    }
}
