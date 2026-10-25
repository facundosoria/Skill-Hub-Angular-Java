package com.skillhub.agentroom;

import com.fasterxml.jackson.databind.JsonNode;
import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Vista web de las salas de agentes: los humanos observan e intervienen. */
@RestController
@RequestMapping("/api/rooms")
public class AgentRoomController {

    private final AgentRoomService service;
    private final AgentRoomEvents events;

    public AgentRoomController(AgentRoomService service, AgentRoomEvents events) {
        this.service = service;
        this.events = events;
    }

    @GetMapping
    public List<Map<String, Object>> list(@AuthPrincipal CurrentUser user) {
        return service.list(RoomActor.human(user));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@AuthPrincipal CurrentUser user, @RequestBody JsonNode body) {
        List<String> teams = new ArrayList<>();
        body.path("teams").forEach(team -> teams.add(team.asText()));
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(RoomActor.human(user),
                body.path("title").asText(""), body.path("topic").asText(""), teams));
    }

    @GetMapping("/{id}")
    public Map<String, Object> detail(@AuthPrincipal CurrentUser user, @PathVariable String id) {
        return service.detail(RoomActor.human(user), id);
    }

    @GetMapping("/{id}/messages")
    public Map<String, Object> messages(@AuthPrincipal CurrentUser user, @PathVariable String id,
                                        @RequestParam(defaultValue = "0") long since,
                                        @RequestParam(required = false) Integer limit) {
        return service.read(RoomActor.human(user), id, since, limit);
    }

    @PostMapping("/{id}/messages")
    public ResponseEntity<Map<String, Object>> post(@AuthPrincipal CurrentUser user, @PathVariable String id,
                                                    @RequestBody JsonNode body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(service.post(RoomActor.human(user), id, body.path("body").asText("")));
    }

    @PostMapping("/{id}/contracts")
    public ResponseEntity<Map<String, Object>> propose(@AuthPrincipal CurrentUser user, @PathVariable String id,
                                                       @RequestBody JsonNode body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.proposeContract(RoomActor.human(user), id,
                body.path("format").asText("markdown"), body.path("content").asText(""), body.path("note").asText("")));
    }

    @PostMapping("/{id}/contracts/{version}/accept")
    public Map<String, Object> accept(@AuthPrincipal CurrentUser user, @PathVariable String id,
                                      @PathVariable int version) {
        return service.accept(RoomActor.human(user), id, version);
    }

    @PostMapping("/{id}/close")
    public Map<String, Object> close(@AuthPrincipal CurrentUser user, @PathVariable String id) {
        return service.close(RoomActor.human(user), id);
    }

    @GetMapping(value = "/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@AuthPrincipal CurrentUser user, @PathVariable String id) {
        long lastSeq = service.lastSeq(RoomActor.human(user), id);
        return events.connect(id, lastSeq);
    }
}
