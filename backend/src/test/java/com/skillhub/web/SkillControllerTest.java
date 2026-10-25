package com.skillhub.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.auth.ApiKeyIdentity;
import com.skillhub.auth.ApiKeyService;
import com.skillhub.session.CurrentUser;
import com.skillhub.skill.CatalogArtifactService;
import com.skillhub.skill.DuplicatesRepository;
import com.skillhub.skill.Skill;
import com.skillhub.skill.SkillRatingService;
import com.skillhub.skill.SkillRepository;
import com.skillhub.skill.SkillWriteService;
import com.skillhub.skill.VoteService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Endpoints de skills con servicios simulados: lecturas, control de idioma y
 * duplicados al crear, permisos de admin y descarga de adjuntos.
 */
class SkillControllerTest {

    private final CurrentUser member = new CurrentUser("u1", "ana", "Ana", "Banco", "member", false);
    private final CurrentUser admin = new CurrentUser("a1", "admin", "Admin", null, "admin", false);

    private SkillRepository repo;
    private SkillWriteService write;
    private VoteService votes;
    private SkillRatingService ratings;
    private DuplicatesRepository duplicates;
    private CatalogArtifactService artifacts;
    private ApiKeyService apiKeys;
    private SkillController controller;

    @BeforeEach
    void setUp() {
        repo = mock(SkillRepository.class);
        write = mock(SkillWriteService.class);
        votes = mock(VoteService.class);
        ratings = mock(SkillRatingService.class);
        duplicates = mock(DuplicatesRepository.class);
        artifacts = mock(CatalogArtifactService.class);
        apiKeys = mock(ApiKeyService.class);
        controller = new SkillController(repo, write, votes, ratings, duplicates, new ObjectMapper(), artifacts, apiKeys);
    }

    private static SkillController.SkillFormRequest form(String justification, String type, List<String> tags) {
        return new SkillController.SkillFormRequest("mi-skill", "Button styles", "How buttons look in the app.",
                "Use when adding a button to any screen.", "angular", type, "Banco", tags,
                "## Rule\n\nEvery button uses the shared component and a visible label.", null, justification);
    }

    private static SkillController.SkillFormRequest mixedLanguage() {
        return new SkillController.SkillFormRequest("mezcla", "Botones de la aplicacion", "How buttons look in the app.",
                "Usalo cuando agregues un boton en cualquier pantalla de la aplicacion.", "angular", null, null, null,
                "## Regla\n\nCada boton usa el componente compartido y una etiqueta visible siempre.", null, null);
    }

    // --- reads ---------------------------------------------------------

    @Test
    void listsWithFilters() {
        when(repo.listSkillsFull("java", "skill", "published")).thenReturn(List.of(Map.of("slug", "a")));

        assertThat(controller.list(member, "java", "skill", "published")).containsEntry("skills", List.of(Map.of("slug", "a")));
    }

    @Test
    void returnsADetailWithVoteStatusOnlyWhenAnEditIsPending() {
        Skill skill = mock(Skill.class);
        when(skill.id()).thenReturn("s1");
        when(repo.getBySlug("mi-skill", null)).thenReturn(skill);

        assertThat(controller.get(member, "mi-skill", null)).containsEntry("voteStatus", null);

        when(skill.pendingVersionId()).thenReturn("v2");
        VoteService.VoteStatus status = new VoteService.VoteStatus("v2", 1, 2, false, false);
        when(votes.getVoteStatus("s1", "u1")).thenReturn(status);
        assertThat(controller.get(member, "mi-skill", null)).containsEntry("voteStatus", status);
    }

    @Test
    void unknownSkillsAndVersionsAreNotFound() {
        assertThatThrownBy(() -> controller.get(member, "nada", 2)).isInstanceOf(ResponseStatusException.class);
        when(repo.getVersionsContent("nada", 1, 2)).thenReturn(null);
        assertThatThrownBy(() -> controller.diff(member, "nada", 1, 2)).isInstanceOf(ResponseStatusException.class);
        when(repo.getVersionsContent("mi-skill", 1, 2)).thenReturn(Map.of("a", "x"));
        assertThat(controller.diff(member, "mi-skill", 1, 2)).containsEntry("a", "x");
    }

    @Test
    void searchesDuplicatesOnlyForMeaningfulTitles() {
        assertThat(controller.dupes(member, " ab ", null)).isEmpty();
        verify(duplicates, never()).findSimilarSkills(anyString(), anyList(), anyInt());

        controller.dupes(member, "Buttons", " java, ,api ");
        verify(duplicates).findSimilarSkills("Buttons", List.of("java", "api"), 4);
        controller.dupes(member, "Buttons", " ");
        verify(duplicates).findSimilarSkills("Buttons", List.of(), 4);
    }

    @Test
    void checksTheLanguageOfAForm() {
        var result = controller.checkLanguage(member, Map.of("title", "Buttons", "content", "Every button has a label."));

        assertThat(result.has("consistente")).isTrue();
    }

    // --- create and update --------------------------------------------

    @Test
    void createRejectsMixedLanguages() {
        assertThat(controller.createJson(member, mixedLanguage())).containsEntry("error", "IDIOMA_INCONSISTENTE");
        verify(write, never()).createSkill(any(), anyString(), any());
    }

    @Test
    void createReturnsSimilarSkillsInsteadOfCreatingWithoutJustification() {
        var candidate = mock(DuplicatesRepository.DuplicateCandidate.class);
        when(duplicates.findSimilarSkills(anyString(), anyList(), eq(4))).thenReturn(List.of(candidate));

        Map<String, Object> result = controller.createJson(member, form(null, null, null));

        assertThat(result).containsKey("duplicates");
        verify(write, never()).createSkill(any(), anyString(), any());

        assertThat(controller.createJson(member, form(" ", "skill", List.of("x")))).containsKey("duplicates");
    }

    @Test
    void createWithJustificationOrWithoutSimilarSkillsCreates() {
        assertThat(controller.createJson(member, form("Distinto alcance", "skill", null))).containsEntry("slug", "mi-skill");
        verify(duplicates, never()).findSimilarSkills(anyString(), anyList(), anyInt());

        MockMultipartFile file = new MockMultipartFile("file", "a.zip", "application/zip", new byte[]{1});
        when(duplicates.findSimilarSkills(anyString(), anyList(), eq(4))).thenReturn(List.of());
        assertThat(controller.createMultipart(member, form(null, "plugin", List.of("x")), file)).containsEntry("slug", "mi-skill");
        verify(write).createSkill(any(), eq("u1"), eq(file));
    }

    @Test
    void updateChecksLanguageAndReportsPendingEdits() {
        assertThat(controller.updateJson(member, "mezcla", mixedLanguage())).containsEntry("error", "IDIOMA_INCONSISTENTE");

        when(write.updateSkill(eq("mi-skill"), any(), eq("u1"), eq(false), any())).thenReturn(new SkillWriteService.UpdateResult(3, true));
        assertThat(controller.updateJson(member, "mi-skill", form(null, null, null)))
                .containsEntry("version", 3).containsEntry("pending", true);

        when(write.updateSkill(eq("mi-skill"), any(), eq("a1"), eq(true), any())).thenReturn(new SkillWriteService.UpdateResult(4, false));
        assertThat(controller.updateMultipart(admin, "mi-skill", form(null, null, null), null)).containsEntry("pending", false);
    }

    // --- artifacts -----------------------------------------------------

    @Test
    void downloadsArtifactsForUsersOrValidApiKeys() {
        when(repo.skillId("mi-skill")).thenReturn("s1");
        var summary = new CatalogArtifactService.Summary("paquete.zip", "application/zip", 3, "abc");
        when(artifacts.findDownload("s1", 1)).thenReturn(new CatalogArtifactService.Download(summary, new byte[]{1, 2, 3}));

        var forUser = controller.downloadArtifact(member, new MockHttpServletRequest(), "mi-skill", 1);
        assertThat(forUser.getHeaders().getContentType()).isEqualTo(MediaType.parseMediaType("application/zip"));
        assertThat(forUser.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");

        MockHttpServletRequest withKey = new MockHttpServletRequest();
        withKey.addHeader("Authorization", "Bearer sk_hub_x");
        when(apiKeys.identifyByAuthHeader("Bearer sk_hub_x")).thenReturn(new ApiKeyIdentity("k1", "u1", "ana", "Banco", "member"));
        assertThat(controller.downloadArtifact(null, withKey, "mi-skill", 1).getStatusCode().value()).isEqualTo(200);
        verify(apiKeys).touchApiKey("k1");
    }

    @Test
    void downloadsRejectAnonymousMissingSkillsAndVersionsWithoutFiles() {
        assertThatThrownBy(() -> controller.downloadArtifact(null, new MockHttpServletRequest(), "mi-skill", 1))
                .isInstanceOf(ResponseStatusException.class).extracting("statusCode").isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThatThrownBy(() -> controller.downloadArtifact(member, new MockHttpServletRequest(), "nada", 1))
                .extracting("statusCode").isEqualTo(HttpStatus.NOT_FOUND);
        when(repo.skillId("mi-skill")).thenReturn("s1");
        assertThatThrownBy(() -> controller.downloadArtifact(member, new MockHttpServletRequest(), "mi-skill", 9))
                .hasMessageContaining("no tiene archivo adjunto");
    }

    @Test
    void unparseableContentTypesFallBackToOctetStream() {
        when(repo.skillId("mi-skill")).thenReturn("s1");
        var summary = new CatalogArtifactService.Summary("raro.bin", "no/es/valido;;", 1, "abc");
        when(artifacts.findDownload("s1", 1)).thenReturn(new CatalogArtifactService.Download(summary, new byte[]{1}));

        var response = controller.downloadArtifact(member, new MockHttpServletRequest(), "mi-skill", 1);

        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_OCTET_STREAM);
    }

    // --- admin actions, votes and ratings -----------------------------

    @Test
    void adminActionsRequireAnAdmin() {
        assertThatThrownBy(() -> controller.publish(member, "mi-skill")).extracting("statusCode").isEqualTo(HttpStatus.FORBIDDEN);
        assertThatThrownBy(() -> controller.deprecate(member, "mi-skill", null)).extracting("statusCode").isEqualTo(HttpStatus.FORBIDDEN);
        assertThatThrownBy(() -> controller.applyEdit(member, "mi-skill")).extracting("statusCode").isEqualTo(HttpStatus.FORBIDDEN);
        assertThatThrownBy(() -> controller.discardEdit(member, "mi-skill")).extracting("statusCode").isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void adminsPublishDeprecateApplyAndDiscard() {
        when(repo.skillId("mi-skill")).thenReturn("s1");

        assertThat(controller.publish(admin, "mi-skill")).containsEntry("ok", true);
        assertThat(controller.deprecate(admin, "mi-skill", Map.of("supersededBy", "otro"))).containsEntry("ok", true);
        assertThat(controller.deprecate(admin, "mi-skill", null)).containsEntry("ok", true);
        assertThat(controller.applyEdit(admin, "mi-skill")).containsEntry("ok", true);
        assertThat(controller.discardEdit(admin, "mi-skill")).containsEntry("ok", true);

        verify(write).deprecateSkill("mi-skill", "otro", "a1");
        verify(write).deprecateSkill("mi-skill", null, "a1");
        verify(write).applyPendingEdit("s1");
        verify(write).discardPendingEdit("s1");
    }

    @Test
    void actionsOnUnknownSkillsFailWithADomainError() {
        assertThatThrownBy(() -> controller.vote(member, "nada")).isInstanceOf(DomainException.class);
        assertThatThrownBy(() -> controller.rate(member, "nada", new SkillController.SkillRatingRequest(5, null))).isInstanceOf(DomainException.class);
        assertThatThrownBy(() -> controller.applyEdit(admin, "nada")).isInstanceOf(DomainException.class);
        assertThatThrownBy(() -> controller.discardEdit(admin, "nada")).isInstanceOf(DomainException.class);
        verify(write, never()).applyPendingEdit(anyString());
    }

    @Test
    void votesAndRatesExistingSkills() {
        when(repo.skillId("mi-skill")).thenReturn("s1");
        when(votes.castVote("s1", "u1")).thenReturn(new VoteService.CastResult(1, 2, false));

        assertThat(controller.vote(member, "mi-skill").votes()).isEqualTo(1);
        assertThat(controller.rate(member, "mi-skill", new SkillController.SkillRatingRequest(4, "Bien"))).containsEntry("ok", true);
        verify(ratings).rate("s1", "u1", 4, "Bien");
        verify(write, never()).updateSkill(anyString(), any(), anyString(), anyBoolean(), any());
    }
}
