package com.skillhub.depmap;

import com.fasterxml.jackson.databind.JsonNode;
import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestController
@RequestMapping("/api/depmap")
public class DepMapController {

    private final DepMapService service;
    private final DepMapEvents events;

    public DepMapController(DepMapService service, DepMapEvents events) {
        this.service = service;
        this.events = events;
    }

    @GetMapping("/state")
    public Map<String, Object> state(@AuthPrincipal CurrentUser user) {
        return service.state(events.currentPresence());
    }

    @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@AuthPrincipal CurrentUser user) {
        return events.connect(user.name(), service.currentVersion());
    }

    @PostMapping("/edges")
    public ResponseEntity<Map<String, Object>> add(@AuthPrincipal CurrentUser user, @RequestBody JsonNode body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.addEdge(user, body));
    }

    @DeleteMapping("/edges/{id}")
    public Map<String, Object> delete(@AuthPrincipal CurrentUser user, @PathVariable String id) {
        return service.deleteEdge(user, id);
    }

    @PutMapping("/done/{id}")
    public Map<String, Object> done(@AuthPrincipal CurrentUser user, @PathVariable String id,
                                    @RequestBody(required = false) JsonNode body) {
        return service.setDone(user, id, body);
    }

    @PostMapping("/import")
    public Map<String, Object> importState(@AuthPrincipal CurrentUser user, @RequestBody JsonNode body) {
        requireAdmin(user);
        return service.importState(user, body);
    }

    @PostMapping("/reset")
    public Map<String, Object> reset(@AuthPrincipal CurrentUser user) {
        requireAdmin(user);
        return service.reset(user);
    }

    private void requireAdmin(CurrentUser user) {
        if (!user.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un admin");
    }
}
