package com.skillhub.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import com.skillhub.skill.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Puerto de las server actions de skills (src/server/skills/actions.ts) y de las
 * lecturas de las paginas /skills y /skills/[slug].
 */
@RestController
@RequestMapping("/api/skills")
public class SkillController {

    private final SkillRepository repo;
    private final SkillWriteService write;
    private final VoteService votes;
    private final DuplicatesRepository duplicates;
    private final ObjectMapper json;

    public SkillController(SkillRepository repo, SkillWriteService write,
                           VoteService votes, DuplicatesRepository duplicates, ObjectMapper json) {
        this.repo = repo;
        this.write = write;
        this.votes = votes;
        this.duplicates = duplicates;
        this.json = json;
    }

    // --- lecturas ------------------------------------------------------

    @GetMapping
    public Map<String, Object> list(@AuthPrincipal CurrentUser user,
                                    @RequestParam(required = false) String stack,
                                    @RequestParam(required = false) String type,
                                    @RequestParam(required = false) String status) {
        return Map.of("skills", repo.listSkillsFull(stack, type, status));
    }

    @GetMapping("/{slug}")
    public Map<String, Object> get(@AuthPrincipal CurrentUser user,
                                   @PathVariable String slug,
                                   @RequestParam(name = "v", required = false) Integer version) {
        Skill skill = repo.getBySlug(slug, version);
        if (skill == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No existe el skill");

        Map<String, Object> out = new HashMap<>();
        out.put("skill", skill);
        out.put("history", repo.getHistory(slug));
        out.put("related", repo.getRelated(skill.id()));
        out.put("voteStatus", skill.pendingVersionId() != null
                ? votes.getVoteStatus(skill.id(), user.id()) : null);
        return out;
    }

    @GetMapping("/{slug}/diff")
    public Map<String, Object> diff(@AuthPrincipal CurrentUser user, @PathVariable String slug,
                                    @RequestParam int a, @RequestParam int b) {
        Map<String, Object> d = repo.getVersionsContent(slug, a, b);
        if (d == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Version inexistente");
        return d;
    }

    @GetMapping("/duplicates")
    public List<DuplicatesRepository.DuplicateCandidate> dupes(
            @AuthPrincipal CurrentUser user,
            @RequestParam String title,
            @RequestParam(required = false) String tags) {
        if (title.trim().length() < 3) return List.of();
        return duplicates.findSimilarSkills(title, csv(tags), 4);
    }

    @PostMapping("/check-language")
    public JsonNode checkLanguage(@AuthPrincipal CurrentUser user, @RequestBody Map<String, String> body) {
        var r = LanguageDetector.revisarIdiomaSkill(
                body.getOrDefault("title", ""), body.getOrDefault("description", ""),
                body.getOrDefault("whenToUse", ""), body.getOrDefault("content", ""));
        // null si esta en ingles, {campo, senales} si detecto espanol
        return r == null ? json.nullNode() : json.valueToTree(r);
    }

    // --- escrituras --------------------------------------------------

    public record SkillFormRequest(
            String slug, String title, String description, String whenToUse, String stack,
            String type, String ownerTeam, List<String> tags, String content,
            String changelog, String duplicateJustification) {

        SkillInput toInput() {
            return new SkillInput(slug, title, description, whenToUse, stack,
                    type == null ? "skill" : type, ownerTeam,
                    tags == null ? List.of() : tags, content, changelog, duplicateJustification);
        }
    }

    @PostMapping
    public Map<String, Object> create(@AuthPrincipal CurrentUser user, @RequestBody SkillFormRequest body) {
        SkillInput input = body.toInput();

        var idioma = LanguageDetector.revisarIdiomaSkill(
                input.title(), input.description(), input.whenToUse(), input.content());
        if (idioma != null) {
            return Map.of("error", "EN_SOLO_INGLES",
                    "idioma", Map.of("campo", idioma.campo(), "senales", idioma.senales()));
        }

        // No bloquea, fricciona: si hay parecidos y no vino justificacion, se
        // devuelven los candidatos en vez de crear.
        if (input.duplicateJustification() == null || input.duplicateJustification().isBlank()) {
            var similar = duplicates.findSimilarSkills(input.title(), input.tags(), 4);
            if (!similar.isEmpty()) {
                return Map.of("duplicates", similar,
                        "error", "Ya existe algo muy parecido. Propone un cambio ahi, o justifica por que hace falta uno nuevo.");
            }
        }

        write.createSkill(input, user.id());
        return Map.of("slug", input.slug());
    }

    @PutMapping("/{slug}")
    public Map<String, Object> update(@AuthPrincipal CurrentUser user, @PathVariable String slug,
                                      @RequestBody SkillFormRequest body) {
        SkillInput input = body.toInput();
        var idioma = LanguageDetector.revisarIdiomaSkill(
                input.title(), input.description(), input.whenToUse(), input.content());
        if (idioma != null) {
            return Map.of("error", "EN_SOLO_INGLES",
                    "idioma", Map.of("campo", idioma.campo(), "senales", idioma.senales()));
        }
        var r = write.updateSkill(slug, input, user.id(), user.isAdmin());
        return Map.of("version", r.version(), "pending", r.pending(), "slug", slug);
    }

    @PostMapping("/{slug}/publish")
    public Map<String, Object> publish(@AuthPrincipal CurrentUser user, @PathVariable String slug) {
        requireAdmin(user);
        write.publishSkill(slug, user.id());
        return Map.of("ok", true);
    }

    @PostMapping("/{slug}/deprecate")
    public Map<String, Object> deprecate(@AuthPrincipal CurrentUser user, @PathVariable String slug,
                                         @RequestBody(required = false) Map<String, String> body) {
        requireAdmin(user);
        String supersededBy = body == null ? null : body.get("supersededBy");
        write.deprecateSkill(slug, supersededBy, user.id());
        return Map.of("ok", true);
    }

    @PostMapping("/{slug}/vote")
    public VoteService.CastResult vote(@AuthPrincipal CurrentUser user, @PathVariable String slug) {
        String id = repo.skillId(slug);
        if (id == null) throw new DomainException("No existe el skill \"" + slug + "\"");
        return votes.castVote(id, user.id());
    }

    @PostMapping("/{slug}/apply-edit")
    public Map<String, Object> applyEdit(@AuthPrincipal CurrentUser user, @PathVariable String slug) {
        requireAdmin(user);
        String id = repo.skillId(slug);
        if (id == null) throw new DomainException("No existe el skill \"" + slug + "\"");
        write.applyPendingEdit(id);
        return Map.of("ok", true);
    }

    @PostMapping("/{slug}/discard-edit")
    public Map<String, Object> discardEdit(@AuthPrincipal CurrentUser user, @PathVariable String slug) {
        requireAdmin(user);
        String id = repo.skillId(slug);
        if (id == null) throw new DomainException("No existe el skill \"" + slug + "\"");
        write.discardPendingEdit(id);
        return Map.of("ok", true);
    }

    // --- helpers ----------------------------------------------------

    private void requireAdmin(CurrentUser user) {
        if (!user.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un admin");
    }

    private static List<String> csv(String s) {
        if (s == null || s.isBlank()) return List.of();
        List<String> out = new ArrayList<>();
        for (String p : s.split(",")) if (!p.trim().isEmpty()) out.add(p.trim());
        return out;
    }
}
