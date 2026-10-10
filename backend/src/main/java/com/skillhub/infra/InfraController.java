package com.skillhub.infra;

import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Authenticated read-only view of infrastructure state. Available to any
 * logged-in user (no admin restriction, matching the existing AuthPrincipal
 * pattern). Reads never trigger a synchronous poll: {@link InfraQueryService}
 * only reads persisted state.
 */
@RestController
@RequestMapping("/api/infra")
public class InfraController {

    private final InfraQueryService query;

    public InfraController(InfraQueryService query) {
        this.query = query;
    }

    @GetMapping({"", "/state"})
    public InfraDto.StateView state(@AuthPrincipal CurrentUser user) {
        return query.current();
    }
}
