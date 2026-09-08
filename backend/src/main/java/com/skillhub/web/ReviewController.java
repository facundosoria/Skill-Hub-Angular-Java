package com.skillhub.web;

import com.skillhub.audit.AuditService;
import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import com.skillhub.skill.SkillRepository;
import com.skillhub.skill.SkillWriteService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** Puerto de la cola de revision (src/app/(app)/review + approve/rejectProposalAction). */
@RestController
@RequestMapping("/api/review")
public class ReviewController {

    private final SkillRepository repo;
    private final SkillWriteService write;
    private final AuditService audit;

    public ReviewController(SkillRepository repo, SkillWriteService write, AuditService audit) {
        this.repo = repo;
        this.write = write;
        this.audit = audit;
    }

    @GetMapping
    public Map<String, Object> list(@AuthPrincipal CurrentUser user) {
        requireAdmin(user);
        return Map.of("proposals", repo.listProposals());
    }

    @PostMapping("/{slug}/approve")
    public Map<String, Object> approve(@AuthPrincipal CurrentUser user, @PathVariable String slug) {
        requireAdmin(user);
        write.publishSkill(slug, user.id());
        audit.logAudit(user.id(), "skill.approved", "skill", null, Map.of("slug", slug));
        return Map.of("ok", true);
    }

    /**
     * Rechazar deja la propuesta como draft, no la borra: que un agente haya
     * inventado una regla que no sirve sigue siendo informacion (dice que ahi
     * falta una convencion y que entendio mal).
     */
    @PostMapping("/{slug}/reject")
    public Map<String, Object> reject(@AuthPrincipal CurrentUser user, @PathVariable String slug,
                                      @RequestBody Map<String, String> body) {
        requireAdmin(user);
        String motivo = body.getOrDefault("motivo", "").trim();
        repo.setStatusDraft(slug);
        audit.logAudit(user.id(), "skill.rejected", "skill", null, Map.of("slug", slug, "motivo", motivo));
        return Map.of("ok", true);
    }

    private void requireAdmin(CurrentUser user) {
        if (!user.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un admin");
    }
}
