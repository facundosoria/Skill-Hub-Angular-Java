package com.skillhub;

import com.skillhub.session.UserService;
import com.skillhub.skill.CatalogArtifactService;
import com.skillhub.skill.DuplicatesRepository;
import com.skillhub.skill.ProposeService;
import com.skillhub.skill.VoteService;
import com.skillhub.skill.SkillInput;
import com.skillhub.skill.SkillWriteService;
import com.skillhub.web.DomainException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Escritura de skills contra Postgres real: alta, edicion directa o pendiente,
 * revisiones de agentes, publicacion, deprecacion, renombre y adjuntos.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
class SkillWriteIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("skillhub").withUsername("skillhub").withPassword("skillhub");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("app.session-secret", () -> "test-session-secret-at-least-32-chars-long");
    }

    @Autowired SkillWriteService skills;
    @Autowired CatalogArtifactService artifacts;
    @Autowired UserService users;
    @Autowired JdbcTemplate jdbc;
    @Autowired ProposeService proposals;
    @Autowired VoteService votes;
    @Autowired DuplicatesRepository duplicates;

    static String adminId;
    static String memberId;

    @BeforeEach
    void users() {
        if (adminId != null) return;
        adminId = users.register("admin", "clave-segura-1", "Identidad y Usuarios", null).session().user().id();
        users.register("miembro", "clave-segura-1", "Identidad y Usuarios", null);
        memberId = jdbc.queryForObject("SELECT id::text FROM users WHERE username = 'miembro'", String.class);
        users.approve(adminId, memberId);
    }

    private static String unique(String base) {
        return base + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private static SkillInput input(String slug, String type, List<String> tags, String content, String justification) {
        return new SkillInput(slug, "Titulo " + slug, "Descripcion suficiente", "Cuando haga falta algo",
                "java", type, "Banco", tags, content, null, justification);
    }

    private static SkillInput input(String slug) {
        return input(slug, "skill", List.of("java"), "Contenido con mas de veinte caracteres", null);
    }

    private String status(String slug) {
        return jdbc.queryForObject("SELECT status::text FROM skills WHERE slug = ?", String.class, slug);
    }

    private String skillId(String slug) {
        return jdbc.queryForObject("SELECT id::text FROM skills WHERE slug = ?", String.class, slug);
    }

    private long audits(String action) {
        return jdbc.queryForObject("SELECT count(*) FROM audit_events WHERE action = ?", Long.class, action);
    }

    @Test
    void createsADraftWithTagsAndADefaultChangelog() {
        String slug = unique("alta");

        String id = skills.createSkill(input(slug), adminId);

        assertThat(status(slug)).isEqualTo("draft");
        assertThat(jdbc.queryForList("SELECT tag FROM skill_tags WHERE skill_id = ?::uuid", String.class, id)).containsExactly("java");
        assertThat(jdbc.queryForObject("SELECT changelog FROM skill_versions WHERE skill_id = ?::uuid", String.class, id)).isEqualTo("Version inicial");
    }

    @Test
    void rejectsInvalidInputAndDuplicateSlugs() {
        assertThatThrownBy(() -> skills.createSkill(input("x"), adminId)).isInstanceOf(DomainException.class);
        String slug = unique("dup");
        skills.createSkill(input(slug), adminId);

        assertThatThrownBy(() -> skills.createSkill(input(slug), adminId)).hasMessageContaining("Ya existe un skill");
    }

    @Test
    void recordsForcedDuplicatesAndSkillsWithoutTags() {
        long before = audits("skill.duplicate_forced");

        skills.createSkill(input(unique("forzado"), "skill", null, "Contenido con mas de veinte caracteres", "No es lo mismo"), adminId);

        assertThat(audits("skill.duplicate_forced")).isEqualTo(before + 1);
    }

    @Test
    void pluginsGetAGeneratedManifestOrTheUploadedFile() {
        String generated = unique("plugin");
        skills.createSkill(input(generated, "plugin", List.of(), "Contenido del plugin con detalle", null), adminId);
        var summary = artifacts.findSummary(skillId(generated), 1);
        assertThat(summary.fileName()).isEqualTo(generated + "-plugin.json");
        assertThat(new String(artifacts.findDownload(skillId(generated), 1).content(), StandardCharsets.UTF_8)).contains("\"type\" : \"plugin\"");

        String uploaded = unique("contrato");
        MockMultipartFile file = new MockMultipartFile("artifact", "dir\\openapi.yaml", "", "openapi: 3".getBytes(StandardCharsets.UTF_8));
        skills.createSkill(input(uploaded, "contract", List.of(), "Contrato con suficiente texto", null), adminId, file);
        var uploadedSummary = artifacts.findSummary(skillId(uploaded), 1);
        assertThat(uploadedSummary.fileName()).isEqualTo("openapi.yaml");
        assertThat(uploadedSummary.contentType()).isEqualTo("application/octet-stream");
        assertThat(uploadedSummary.sha256()).hasSize(64);
    }

    @Test
    void artifactUploadsAreValidated() {
        String slug = unique("adjunto");
        skills.createSkill(input(slug), adminId);
        String version = jdbc.queryForObject("SELECT current_version_id::text FROM skills WHERE slug = ?", String.class, slug);

        assertThatThrownBy(() -> artifacts.attachUploaded(version, null, adminId)).hasMessage("Debe adjuntar un archivo no vacio");
        assertThatThrownBy(() -> artifacts.attachUploaded(version, new MockMultipartFile("a", "a.txt", "text/plain", new byte[0]), adminId))
                .hasMessage("Debe adjuntar un archivo no vacio");
        assertThatThrownBy(() -> artifacts.attachBytes(version, "a.txt", "text/plain", null, adminId)).hasMessage("Debe adjuntar un archivo no vacio");
        assertThatThrownBy(() -> artifacts.attachBytes(version, " ", "text/plain", new byte[]{1}, adminId)).hasMessage("El nombre del archivo no es valido");
        assertThatThrownBy(() -> artifacts.attachBytes(version, "a\u0001.txt", "text/plain", new byte[]{1}, adminId)).hasMessage("El nombre del archivo no es valido");
        assertThat(artifacts.hasArtifact(null)).isFalse();
        assertThat(artifacts.hasArtifact(version)).isFalse();
        artifacts.copyFromVersion(null, version, adminId);
        assertThat(artifacts.findSummary(skillId(slug), 9)).isNull();
        assertThat(artifacts.findDownload(skillId(slug), 9)).isNull();
    }

    @Test
    void editsApplyDirectlyWhileTheSkillIsADraft() {
        String slug = unique("borrador");
        skills.createSkill(input(slug), adminId);
        SkillInput changed = new SkillInput(slug, "Titulo nuevo", "Descripcion cambiada", "Cuando haga falta otra cosa",
                "angular", "convention", null, List.of("nuevo"), "Contenido distinto con mas de veinte", "Cambio", null);

        var result = skills.updateSkill(slug, changed, memberId, false);

        assertThat(result.pending()).isFalse();
        assertThat(result.version()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT title FROM skills WHERE slug = ?", String.class, slug)).isEqualTo("Titulo nuevo");
        assertThat(jdbc.queryForList("SELECT tag FROM skill_tags WHERE skill_id = ?::uuid", String.class, skillId(slug))).containsExactly("nuevo");
        Map<String, Object> audit = jdbc.queryForMap("SELECT metadata::text AS m FROM audit_events WHERE action = 'skill.updated' AND target_id = ?::uuid", skillId(slug));
        assertThat((String) audit.get("m")).contains("titulo", "tags", "contenido", "equipo dueno");
    }

    @Test
    void membersOnlyProposeEditsOnPublishedSkillsAndAdminsDecide() {
        String slug = unique("publicado");
        skills.createSkill(input(slug), adminId);
        skills.publishSkill(slug, adminId);
        SkillInput changed = new SkillInput(slug, "Titulo propuesto", "Descripcion suficiente", "Cuando haga falta algo",
                "java", "skill", "Banco", List.of("java"), "Contenido con mas de veinte caracteres", null, null);

        var pending = skills.updateSkill(slug, changed, memberId, false);
        assertThat(pending.pending()).isTrue();
        assertThat(jdbc.queryForObject("SELECT title FROM skills WHERE slug = ?", String.class, slug)).isEqualTo("Titulo " + slug);

        skills.applyPendingEdit(skillId(slug));
        assertThat(jdbc.queryForObject("SELECT title FROM skills WHERE slug = ?", String.class, slug)).isEqualTo("Titulo propuesto");
        assertThatThrownBy(() -> skills.applyPendingEdit(skillId(slug))).hasMessage("No hay ninguna edicion pendiente");

        skills.updateSkill(slug, changed, memberId, false);
        skills.discardPendingEdit(skillId(slug));
        assertThatThrownBy(() -> skills.discardPendingEdit(skillId(slug))).hasMessage("No hay ninguna edicion pendiente");

        assertThat(skills.updateSkill(slug, changed, adminId, true).pending()).isFalse();
    }

    @Test
    void applyingAPendingVersionWithoutSnapshotFails() {
        String slug = unique("sinmeta");
        skills.createSkill(input(slug), adminId);
        jdbc.update("UPDATE skills SET pending_version_id = current_version_id WHERE slug = ?", slug);

        assertThatThrownBy(() -> skills.applyPendingEdit(skillId(slug))).hasMessage("La propuesta pendiente no tiene datos guardados");
    }

    @Test
    void updatesRequireAnExistingSkillValidInputAndArtifactsForPlugins() {
        assertThatThrownBy(() -> skills.updateSkill("no-existe", input("no-existe"), adminId, true)).hasMessageContaining("No existe el skill");
        assertThatThrownBy(() -> skills.updateSkill("no-existe", input("x"), adminId, true)).isInstanceOf(DomainException.class);

        String slug = unique("aplugin");
        skills.createSkill(input(slug), adminId);
        assertThatThrownBy(() -> skills.updateSkill(slug, input(slug, "plugin", List.of(), "Contenido del plugin con detalle", null), adminId, true))
                .hasMessage("Los plugins y contratos requieren un archivo adjunto");

        MockMultipartFile file = new MockMultipartFile("artifact", "plugin.zip", "application/zip", new byte[]{1, 2, 3});
        assertThat(skills.updateSkill(slug, input(slug, "plugin", List.of(), "Contenido del plugin con detalle", null), adminId, true, file).pending()).isFalse();
        assertThat(artifacts.findSummary(skillId(slug), 2).fileName()).isEqualTo("plugin.zip");
        assertThat(skills.updateSkill(slug, input(slug, "plugin", List.of(), "Contenido del plugin con detalle", null), adminId, true).version()).isEqualTo(3);
        assertThat(artifacts.findSummary(skillId(slug), 3).fileName()).isEqualTo("plugin.zip");
    }

    @Test
    void publishingAPluginWithoutFileGeneratesItsManifest() {
        String slug = unique("pubplugin");
        skills.createSkill(input(slug), adminId);
        jdbc.update("UPDATE skills SET type = 'plugin' WHERE slug = ?", slug);

        skills.publishSkill(slug, adminId);

        assertThat(status(slug)).isEqualTo("published");
        assertThat(artifacts.findSummary(skillId(slug), 1)).isNotNull();
    }

    @Test
    void deprecatesWithOrWithoutAReplacement() {
        String old = unique("viejo");
        String replacement = unique("nuevo");
        skills.createSkill(input(old), adminId);
        skills.createSkill(input(replacement), adminId);

        assertThatThrownBy(() -> skills.deprecateSkill(old, "no-existe", adminId)).hasMessageContaining("No existe el reemplazo");
        assertThatThrownBy(() -> skills.deprecateSkill(old, old, adminId)).hasMessage("Un skill no puede reemplazarse a si mismo");

        skills.deprecateSkill(old, replacement, adminId);
        assertThat(status(old)).isEqualTo("deprecated");
        assertThat(jdbc.queryForObject("SELECT superseded_by::text FROM skills WHERE slug = ?", String.class, old)).isEqualTo(skillId(replacement));

        skills.deprecateSkill(replacement, " ", adminId);
        assertThat(status(replacement)).isEqualTo("deprecated");
    }

    @Test
    void agentRevisionsFollowTheLifecycleRules() {
        String slug = unique("revision");
        assertThat(skills.proposeRevision("no-existe", 1, input("no-existe"), memberId, "x").motivo()).isEqualTo("no_existe");

        skills.createSkill(input(slug), adminId);
        assertThat(skills.proposeRevision(slug, 1, input(slug), memberId, "x").motivo()).isEqualTo("no_publicada");

        skills.publishSkill(slug, adminId);
        assertThat(skills.proposeRevision(slug, 9, input(slug), memberId, "x").motivo()).isEqualTo("stale");

        var first = skills.proposeRevision(slug, 1, input(slug), memberId, "r".repeat(500));
        assertThat(first.ok()).isTrue();
        assertThat(first.newVersion()).isEqualTo(2);
        assertThat(first.replaced()).isFalse();
        assertThat(jdbc.queryForObject("SELECT changelog FROM skill_versions WHERE skill_id = ?::uuid AND version = 2", String.class, skillId(slug)))
                .endsWith("r".repeat(400));

        var replaced = skills.proposeRevision(slug, 1, input(slug), memberId, null);
        assertThat(replaced.ok()).isTrue();
        assertThat(replaced.replaced()).isTrue();

        assertThat(skills.proposeRevision(slug, 1, input(slug), adminId, "otro autor").motivo()).isEqualTo("ya_pendiente");

        skills.deprecateSkill(slug, null, adminId);
        assertThat(skills.proposeRevision(slug, 1, input(slug), memberId, "x").motivo()).isEqualTo("deprecada");
    }

    @Test
    void agentRevisionsCanAttachAFileAndRenameTheSkill() {
        String slug = unique("renombrar");
        String renamed = unique("renombrado");
        skills.createSkill(input(slug), adminId);
        skills.publishSkill(slug, adminId);

        var result = skills.proposeRevision(slug, 1, input(renamed), memberId, "renombre",
                "manual.txt".getBytes(StandardCharsets.UTF_8), "manual.txt", "text/plain");
        assertThat(result.ok()).isTrue();
        String id = skillId(slug);
        assertThat(artifacts.findSummary(id, 2).fileName()).isEqualTo("manual.txt");

        skills.applyPendingEdit(id);

        assertThat(jdbc.queryForObject("SELECT slug FROM skills WHERE id = ?::uuid", String.class, id)).isEqualTo(renamed);
        assertThat(status(slug)).isEqualTo("deprecated");
        assertThat(jdbc.queryForObject("SELECT superseded_by::text FROM skills WHERE slug = ?", String.class, slug)).isEqualTo(id);
    }

    @Test
    void aRenameToATakenSlugIsRejected() {
        String slug = unique("origen");
        String taken = unique("ocupado");
        skills.createSkill(input(slug), adminId);
        skills.createSkill(input(taken), adminId);
        skills.publishSkill(slug, adminId);
        skills.proposeRevision(slug, 1, input(taken), memberId, "choque");

        assertThatThrownBy(() -> skills.applyPendingEdit(skillId(slug))).hasMessageContaining("Ya existe un skill");
    }

    @Test
    void agentRevisionsOfPublishedPluginsWithoutVersionGenerateTheirArtifact() {
        String slug = unique("sinversion");
        skills.createSkill(input(slug, "plugin", List.of(), "Contenido del plugin con detalle", null), adminId);
        skills.publishSkill(slug, adminId);
        jdbc.update("UPDATE skills SET current_version_id = NULL WHERE slug = ?", slug);

        var result = skills.proposeRevision(slug, 1, input(slug, "plugin", List.of(), "Contenido del plugin con detalle", null), memberId, "sin version");

        assertThat(result.ok()).isTrue();
        assertThat(result.currentVersion()).isEqualTo(1);
        assertThat(artifacts.findSummary(skillId(slug), 2)).isNotNull();
    }

    // --- agent proposals, peer votes and duplicate search ---------------

    private static final String[] WORDS = {"anchor", "badge", "cabin", "dagger", "eagle", "fabric", "galaxy", "hammer", "island", "jacket", "kettle", "ladder", "magnet", "napkin", "oyster", "pebble", "quiver", "rocket", "saddle", "tablet", "umbrella", "violin", "wagon", "yogurt", "zipper", "acorn", "blossom", "candle", "desert", "engine", "falcon", "glacier", "helmet", "iceberg", "jungle", "kitten", "lantern", "meadow", "needle", "orchard", "pepper", "quilt", "river", "shovel", "thunder", "unicorn", "valley", "walnut", "barrel", "cactus", "dolphin", "feather", "garlic", "harvest", "insect", "jigsaw", "lemon", "mirror", "nugget", "ostrich", "parrot", "riddle", "spider", "tomato", "beetle", "carrot", "donkey", "forest", "goblin", "honey", "lizard", "muffin", "noodle", "otter", "pirate", "rabbit", "salmon", "turtle", "vessel", "window", "bucket", "castle", "dragon", "furnace", "gravel", "hornet", "ladle", "mango", "nectar", "oven", "puzzle", "ribbon", "sponge", "trumpet", "velvet", "whistle", "bridge", "canyon", "drum", "flame", "grape", "harbor", "kayak", "lobster", "marble", "nest", "owl", "planet", "raft", "summit", "tunnel", "volcano", "wizard", "yacht"};
    private static final java.util.concurrent.atomic.AtomicInteger PROPOSALS = new java.util.concurrent.atomic.AtomicInteger();

    /**
     * Doce palabras propias de cada llamada: ningun texto se comparte entre
     * propuestas, asi la deteccion de duplicados no las junta y el idioma es
     * siempre ingles.
     */
    private static String words() {
        int n = PROPOSALS.getAndIncrement();
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 12; i++) out.append(WORDS[(n * 12 + i) % WORDS.length]).append(' ');
        return out.toString().trim();
    }

    private static SkillInput proposal(String slug, String title, String type, List<String> tags) {
        String[] parts = words().split(" ");
        String first = String.join(" ", java.util.Arrays.copyOfRange(parts, 0, 4));
        String second = String.join(" ", java.util.Arrays.copyOfRange(parts, 4, 8));
        String third = String.join(" ", java.util.Arrays.copyOfRange(parts, 8, 12));
        return new SkillInput(slug, title, "Notes about the " + first + " items in this catalogue.",
                "Use when " + second + " show up together.", "java", type, null, tags,
                "## Rule\n\nKeep every " + third + " entry documented and reviewed.", null, null);
    }

    @Test
    void proposalsDeriveTheSlugDefaultTheTypeAndCutLongTexts() {
        String title = "Zz proposal for the derived slug rule";

        var result = proposals.proposeSkill(proposal(" ", title, null, null), memberId, "q".repeat(400), "r".repeat(400));

        assertThat(result.ok()).isTrue();
        assertThat(status(result.slug())).isEqualTo("proposed");
        assertThat(jdbc.queryForObject("SELECT type::text FROM skills WHERE slug = ?", String.class, result.slug())).isEqualTo("convention");
        assertThat(jdbc.queryForObject("SELECT length(proposed_from_query) FROM skills WHERE slug = ?", Integer.class, result.slug())).isEqualTo(300);
    }

    @Test
    void proposalsAreValidatedCheckedForLanguageAndExistingSlugs() {
        assertThat(proposals.proposeSkill(proposal("x", "Zz", null, null), memberId, null, null).motivo()).isEqualTo("invalido");

        SkillInput mixed = new SkillInput(unique("mezcla"), "Botones de la aplicacion", "A description that is long enough for the catalogue.",
                "Usalo cuando agregues un boton en cualquier pantalla de la aplicacion.", "java", "convention", null, null,
                "## Regla\n\nCada boton usa el componente compartido y una etiqueta visible siempre.", null, null);
        assertThat(proposals.proposeSkill(mixed, memberId, null, null).motivo()).isEqualTo("idioma_inconsistente");

        String slug = unique("existente");
        skills.createSkill(input(slug), adminId);
        var duplicate = proposals.proposeSkill(proposal(slug, "Zz completely different words " + slug, "convention", List.of()), memberId, "q", "why");
        assertThat(duplicate.motivo()).isEqualTo("duplicado");
    }

    @Test
    void proposalsOfPluginsGetAnArtifactAndKeepTheirTags() {
        var generated = proposals.proposeSkill(proposal(unique("zz-plugin"), "Zz plugin packaging rule", "plugin", List.of("uno")), memberId, "q", "why");
        assertThat(generated.ok()).as(generated.toString()).isTrue();
        assertThat(artifacts.findSummary(skillId(generated.slug()), 1)).isNotNull();
        assertThat(jdbc.queryForList("SELECT tag FROM skill_tags WHERE skill_id = ?::uuid", String.class, skillId(generated.slug()))).containsExactly("uno");

        var attached = proposals.proposeSkill(proposal(unique("zz-contrato"), "Zz contract shape rule", "contract", null), memberId, "q", "why",
                new ProposeService.FileAttachment("api.yaml", "application/yaml", "openapi: 3".getBytes(StandardCharsets.UTF_8)));
        assertThat(artifacts.findSummary(skillId(attached.slug()), 1).fileName()).isEqualTo("api.yaml");

        var empty = proposals.proposeSkill(proposal(unique("zz-vacio"), "Zz empty attachment rule", "plugin", null), memberId, "q", "why",
                new ProposeService.FileAttachment("x.zip", "application/zip", new byte[0]));
        assertThat(artifacts.findSummary(skillId(empty.slug()), 1).fileName()).endsWith("-plugin.json");
        var nullBytes = proposals.proposeSkill(proposal(unique("zz-nulo"), "Zz missing bytes rule", "skill", null), memberId, "q", "why",
                new ProposeService.FileAttachment("x.zip", "application/zip", null));
        assertThat(nullBytes.ok()).isTrue();
    }

    @Test
    void peersVoteAPendingEditUntilItApplies() {
        String slug = unique("votos");
        skills.createSkill(input(slug), adminId);
        skills.publishSkill(slug, adminId);
        String id = skillId(slug);
        assertThat(votes.getVoteStatus(id, memberId)).isNull();
        assertThatThrownBy(() -> votes.castVote(id, adminId)).hasMessage("No hay ninguna edicion esperando votos");
        assertThatThrownBy(() -> votes.castVote(UUID.randomUUID().toString(), adminId)).hasMessage("No existe el skill");

        SkillInput changed = new SkillInput(slug, "Titulo votado", "Descripcion suficiente", "Cuando haga falta algo",
                "java", "skill", "Banco", List.of("java"), "Contenido con mas de veinte caracteres", null, null);
        skills.updateSkill(slug, changed, memberId, false);

        VoteService.VoteStatus status = votes.getVoteStatus(id, memberId);
        assertThat(status.esAutor()).isTrue();
        assertThat(status.yaVoto()).isFalse();
        assertThatThrownBy(() -> votes.castVote(id, memberId)).hasMessage("No podes votar tu propia propuesta");

        var first = votes.castVote(id, adminId);
        assertThat(first.applied()).isFalse();
        assertThat(votes.getVoteStatus(id, adminId).yaVoto()).isTrue();
        assertThat(votes.castVote(id, adminId).votes()).isEqualTo(1);

        VoteService.CastResult last = null;
        for (int i = 0; i < VoteService.VOTES_REQUIRED - 1; i++) {
            String username = "votante-" + UUID.randomUUID().toString().substring(0, 8);
            users.register(username, "clave-segura-1", "Identidad y Usuarios", null);
            last = votes.castVote(id, jdbc.queryForObject("SELECT id::text FROM users WHERE username = ?", String.class, username));
        }
        assertThat(last.applied()).isTrue();
        assertThat(last.votes()).isEqualTo(VoteService.VOTES_REQUIRED);
        assertThat(jdbc.queryForObject("SELECT title FROM skills WHERE id = ?::uuid", String.class, id)).isEqualTo("Titulo votado");
    }

    @Test
    void duplicateSearchNeedsATitleAndUsesTagsWhenGiven() {
        String slug = unique("parecido");
        skills.createSkill(input(slug), adminId);
        skills.publishSkill(slug, adminId);

        assertThat(duplicates.findSimilarSkills(null, null, 4)).isEmpty();
        assertThat(duplicates.findSimilarSkills(" ab ", List.of("java"), 4)).isEmpty();
        assertThat(duplicates.findSimilarSkills("Titulo " + slug, java.util.Arrays.asList("java", " ", null), 4))
                .extracting(DuplicatesRepository.DuplicateCandidate::slug).contains(slug);
        assertThat(duplicates.findSimilarSkills("Titulo " + slug, null, 4)).isNotEmpty();
        assertThat(duplicates.closestForProposal("ab", null, null, 3)).isEmpty();
        assertThat(duplicates.closestForProposal("Titulo " + slug, null, "x".repeat(2000), 3)).isNotEmpty();
    }

    // --- edge cases of skill writes ---------------------------------------

    @Test
    void keepsTheGivenChangelogOnCreate() {
        String slug = unique("changelog");
        SkillInput withChangelog = new SkillInput(slug, "Titulo " + slug, "Descripcion suficiente", "Cuando haga falta algo",
                "java", "skill", "Banco", List.of("java"), "Contenido con mas de veinte caracteres", "Mi primer cambio", null);

        String id = skills.createSkill(withChangelog, adminId);

        assertThat(jdbc.queryForObject("SELECT changelog FROM skill_versions WHERE skill_id = ?::uuid", String.class, id)).isEqualTo("Mi primer cambio");
    }

    @Test
    void anUpdateWithTheSameContentAndClearedFieldsOnlyRecordsRealChanges() {
        String slug = unique("mismo");
        skills.createSkill(input(slug), adminId);
        SkillInput cleared = new SkillInput(slug, "Titulo " + slug, "Descripcion suficiente", "Cuando haga falta algo",
                "java", null, null, null, "Contenido con mas de veinte caracteres", null, null);

        skills.updateSkill(slug, cleared, adminId, true);

        String meta = jdbc.queryForObject("SELECT metadata::text FROM audit_events WHERE action = 'skill.updated' AND target_id = ?::uuid",
                String.class, skillId(slug));
        assertThat(meta).contains("equipo dueno", "tags").doesNotContain("contenido").doesNotContain("titulo");
        assertThat(jdbc.queryForObject("SELECT type::text FROM skills WHERE slug = ?", String.class, slug)).isEqualTo("skill");

        SkillInput refilled = new SkillInput(slug, "Titulo " + slug, "Descripcion suficiente", "Cuando haga falta algo",
                "java", "skill", "Banco", List.of(), "Contenido con mas de veinte caracteres", null, null);
        skills.updateSkill(slug, refilled, adminId, true);
    }

    @Test
    void updatesASkillThatHasNoVersionYet() {
        String slug = unique("sinversion2");
        skills.createSkill(input(slug), adminId);
        jdbc.update("UPDATE skills SET current_version_id = NULL WHERE slug = ?", slug);
        jdbc.update("DELETE FROM skill_versions WHERE skill_id = ?::uuid", skillId(slug));

        var result = skills.updateSkill(slug, input(slug), adminId, true);

        assertThat(result.version()).isEqualTo(1);
    }

    @Test
    void aPendingWebEditOrAnonymousAgentBlocksAgentRevisions() {
        String slug = unique("bloqueo");
        skills.createSkill(input(slug), adminId);
        skills.publishSkill(slug, adminId);
        skills.updateSkill(slug, input(slug), memberId, false);

        assertThat(skills.proposeRevision(slug, 1, input(slug), memberId, "x").motivo()).isEqualTo("ya_pendiente");

        skills.discardPendingEdit(skillId(slug));
        assertThat(skills.proposeRevision(slug, 1, input(slug), memberId, "x").ok()).isTrue();
        assertThat(skills.proposeRevision(slug, 1, input(slug), null, "x").motivo()).isEqualTo("ya_pendiente");
    }
}
