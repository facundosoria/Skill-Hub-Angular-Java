package com.skillhub.skill;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Frontmatter de los skills: orden fijo de claves, serializacion YAML, texto
 * de busqueda y el bloque ```preview que nunca debe llegar al agente.
 */
class FrontmatterTest {

    @Test
    void extraePreviewSinEspaciosAlrededor() {
        String body = "# Titulo\n\n```preview\n  <div>hola</div>\n```\n\nresto";

        assertThat(Frontmatter.extractPreview(body)).isEqualTo("<div>hola</div>");
    }

    @Test
    void extraePreviewConFinDeLineaWindows() {
        String body = "intro\r\n```preview\r\n<p>x</p>\r\n```";

        assertThat(Frontmatter.extractPreview(body)).isEqualTo("<p>x</p>");
    }

    @Test
    void extraeSoloElPrimerPreview() {
        String body = "```preview\nuno\n```\n\n```preview\ndos\n```";

        assertThat(Frontmatter.extractPreview(body)).isEqualTo("uno");
    }

    @Test
    void sinPreviewDevuelveNull() {
        assertThat(Frontmatter.extractPreview("# Solo markdown\n```js\ncode\n```")).isNull();
        assertThat(Frontmatter.extractPreview(null)).isNull();
    }

    @Test
    void armaElFrontmatterEnOrdenFijo() {
        Map<String, Object> fm = Frontmatter.buildSkillFrontmatter(
                "mi-skill", "Mi skill", "Hace cosas", "Cuando haga falta",
                "java", "guia", "Banco", 3, List.of("a", "b"));

        assertThat(fm.keySet()).containsExactly(
                "slug", "title", "description", "when_to_use", "stack", "type",
                "owning_team", "version", "tags");
        assertThat(fm.get("owning_team")).isEqualTo("Banco");
        assertThat(fm.get("version")).isEqualTo(3);
        assertThat(fm.get("tags")).isEqualTo(List.of("a", "b"));
    }

    @Test
    void omiteEquipoYTagsVacios() {
        Map<String, Object> sinNada = Frontmatter.buildSkillFrontmatter(
                "s", "t", "d", "w", "java", "guia", null, 1, null);
        Map<String, Object> enBlanco = Frontmatter.buildSkillFrontmatter(
                "s", "t", "d", "w", "java", "guia", "   ", 1, List.of());

        assertThat(sinNada).doesNotContainKeys("owning_team", "tags");
        assertThat(enBlanco).doesNotContainKeys("owning_team", "tags");
        assertThat(sinNada.keySet()).containsExactly(
                "slug", "title", "description", "when_to_use", "stack", "type", "version");
    }

    @Test
    void serializaComoYamlEnBloqueEntreSeparadores() {
        Map<String, Object> fm = Frontmatter.buildSkillFrontmatter(
                "mi-skill", "Mi skill", "Hace cosas", "Siempre", "java", "guia", null, 2, List.of("x", "y"));

        String file = Frontmatter.serializeSkillFile(fm, "\n\n# Cuerpo\n");

        assertThat(file).isEqualTo("""
                ---
                slug: mi-skill
                title: Mi skill
                description: Hace cosas
                when_to_use: Siempre
                stack: java
                type: guia
                version: 2
                tags:
                - x
                - y
                ---

                # Cuerpo
                """);
    }

    @Test
    void serializarEsDeterminista() {
        Map<String, Object> a = Frontmatter.buildSkillFrontmatter(
                "s", "t", "d", "w", "java", "guia", "Banco", 1, List.of("k"));
        Map<String, Object> b = Frontmatter.buildSkillFrontmatter(
                "s", "t", "d", "w", "java", "guia", "Banco", 1, List.of("k"));

        assertThat(Frontmatter.serializeSkillFile(a, "x")).isEqualTo(Frontmatter.serializeSkillFile(b, "x"));
    }

    @Test
    void serializaTextosConCaracteresEspecialesSinRomperElYaml() {
        Map<String, Object> fm = Frontmatter.buildSkillFrontmatter(
                "s", "Titulo: con dos puntos", "# no es comentario", "w", "java", "guia", null, 1, null);

        String file = Frontmatter.serializeSkillFile(fm, "body");
        String yaml = file.substring(4, file.indexOf("\n---\n"));
        Map<String, Object> parsed = new org.yaml.snakeyaml.Yaml().load(yaml);

        assertThat(parsed.get("title")).isEqualTo("Titulo: con dos puntos");
        assertThat(parsed.get("description")).isEqualTo("# no es comentario");
    }

    @Test
    void elTextoDeBusquedaUneLosCamposEnOrden() {
        String text = Frontmatter.buildSearchText("Titulo", "Desc", "Cuando", List.of("t1", "t2"), "Contenido");

        assertThat(text).isEqualTo("Titulo\nDesc\nCuando\nt1 t2\nContenido");
    }

    @Test
    void elTextoDeBusquedaSaltaLosCamposVacios() {
        String text = Frontmatter.buildSearchText("Titulo", null, "", null, "Contenido");

        assertThat(text).isEqualTo("Titulo\nContenido");
    }

    @Test
    void elTextoDeBusquedaPuedeQuedarVacio() {
        assertThat(Frontmatter.buildSearchText(null, null, null, List.of(), null)).isEmpty();
    }

    @Test
    void quitaElPreviewYAvisaQueExiste() {
        String content = "# Skill\n\n```preview\n<div>visual</div>\n```\n\n\n\nInstrucciones";

        Frontmatter.Stripped stripped = Frontmatter.stripPreview(content);

        assertThat(stripped.content()).isEqualTo("# Skill\n\nInstrucciones");
        assertThat(stripped.content()).doesNotContain("visual");
        assertThat(stripped.visualExample()).contains("rendered visual example");
    }

    @Test
    void quitaTodosLosPreviews() {
        String content = "a\n```preview\nuno\n```\nb\n```preview\ndos\n```\nc";

        Frontmatter.Stripped stripped = Frontmatter.stripPreview(content);

        assertThat(stripped.content()).doesNotContain("uno").doesNotContain("dos");
        assertThat(stripped.content()).contains("a").contains("b").contains("c");
        assertThat(stripped.visualExample()).isNotNull();
    }

    @Test
    void sinPreviewDevuelveElContenidoOriginalSinAviso() {
        String content = "  # Skill\n\nTexto  \n";

        Frontmatter.Stripped stripped = Frontmatter.stripPreview(content);

        assertThat(stripped.content()).isSameAs(content);
        assertThat(stripped.visualExample()).isNull();
    }

    @Test
    void contenidoNuloQuedaVacio() {
        Frontmatter.Stripped stripped = Frontmatter.stripPreview(null);

        assertThat(stripped.content()).isEmpty();
        assertThat(stripped.visualExample()).isNull();
    }

    @Test
    void otrosBloquesDeCodigoNoSeTocan() {
        String content = "```html\n<div>no es preview</div>\n```";

        assertThat(Frontmatter.stripPreview(content).content()).isEqualTo(content);
    }
}
