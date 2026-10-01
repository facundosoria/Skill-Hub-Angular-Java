package com.skillhub.depmap;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.audit.AuditService;
import com.skillhub.session.CurrentUser;
import com.skillhub.web.DomainException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class DepMapService {

    private static final int MAX_TEXT = 500;
    private static final Set<String> STATES = Set.of("pendiente", "definir");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final DepMapRepository repo;
    private final DepMapEvents events;
    private final AuditService audit;
    private final ObjectMapper json;

    public DepMapService(DepMapRepository repo, DepMapEvents events, AuditService audit, ObjectMapper json) {
        this.repo = repo;
        this.events = events;
        this.audit = audit;
        this.json = json;
    }

    public Map<String, Object> state(List<String> presence) {
        return repo.state(presence);
    }

    public long currentVersion() {
        return repo.currentVersion();
    }

    @Transactional
    public Map<String, Object> addEdge(CurrentUser user, JsonNode body) {
        String from = text(body, "from");
        String to = text(body, "to");
        String kind = text(body, "kind");
        if (from == null || to == null || !repo.nodeExists(from) || !repo.nodeExists(to)) {
            throw new DomainException("Grupo inexistente.");
        }
        if (from.equals(to)) throw new DomainException("Elegí dos grupos distintos.");
        if (kind == null || !repo.kindExists(kind)) throw new DomainException("Tipo de dependencia desconocido.");
        String text = clean(body == null ? null : body.get("text"), MAX_TEXT);
        if (text.isEmpty()) throw new DomainException("Contá qué necesita.");
        String requestedState = text(body, "state");
        String state = requestedState != null && STATES.contains(requestedState) ? requestedState : "pendiente";
        String id = "u" + Long.toString(System.currentTimeMillis(), 36) + randomHex();
        Map<String, Object> edge = edgeMap(new DepMapRepository.Edge(id, from, to, kind, state, text, false));
        String summary = "agregó «" + shortText(text) + "» (" + repo.nodeName(from) + " → " + repo.nodeName(to) + ")";
        long version = mutate(user, summary, map("kind", "edge", "id", id), () -> repo.insertEdge(id, from, to, kind, state, text));
        return Map.of("edge", edge, "version", version);
    }

    @Transactional
    public Map<String, Object> deleteEdge(CurrentUser user, String id) {
        DepMapRepository.Edge edge = lockAndFind(id);
        String summary = "eliminó «" + shortText(edge.text()) + "»";
        long version = mutate(user, summary, map("kind", "edge", "id", id, "removed", true), () -> repo.deleteEdge(id));
        return Map.of("ok", true, "version", version);
    }

    @Transactional
    public Map<String, Object> setDone(CurrentUser user, String id, JsonNode body) {
        DepMapRepository.Edge edge = lockAndFind(id);
        boolean done = body != null && body.path("done").asBoolean(false);
        String summary = (done ? "tildó «" : "destildó «") + shortText(edge.text()) + "»";
        long version = mutate(user, summary, map("kind", "done", "id", id, "done", done),
                () -> repo.setDone(id, done, user.id()));
        return Map.of("ok", true, "version", version);
    }

    @Transactional
    public Map<String, Object> importState(CurrentUser user, JsonNode body) {
        JsonNode edgesNode = body == null ? null : body.get("edges");
        String validation = validateEdges(edgesNode);
        if (validation != null) throw new DomainException(validation);
        List<Map<String, String>> edges = new ArrayList<>();
        for (JsonNode item : edgesNode) {
            Map<String, String> edge = new LinkedHashMap<>();
            edge.put("id", clean(item.get("id"), 80));
            edge.put("from", text(item, "from"));
            edge.put("to", text(item, "to"));
            edge.put("kind", text(item, "kind"));
            String requestedState = text(item, "state");
            edge.put("state", requestedState != null && STATES.contains(requestedState) ? requestedState : "pendiente");
            edge.put("text", clean(item.get("text"), MAX_TEXT));
            edges.add(edge);
        }
        Map<String, Boolean> done = new LinkedHashMap<>();
        JsonNode doneNode = body == null ? null : body.get("done");
        if (doneNode != null && doneNode.isObject()) {
            for (Map.Entry<String, JsonNode> entry : doneNode.properties()) {
                if (entry.getValue().asBoolean(false) && edges.stream().anyMatch(e -> e.get("id").equals(entry.getKey()))) {
                    done.put(entry.getKey(), true);
                }
            }
        }
        String summary = "importó datos (" + edges.size() + " dependencias, " + done.size() + " tildadas)";
        long version = mutate(user, summary, map("kind", "import"), () -> repo.replaceEdges(edges, done));
        return Map.of("ok", true, "version", version);
    }

    @Transactional
    public Map<String, Object> reset(CurrentUser user) {
        List<Map<String, String>> edges = repo.seedEdges();
        long version = mutate(user, "restauró los datos originales de la reunión", map("kind", "reset"),
                () -> repo.replaceEdges(edges, Map.of()));
        return Map.of("ok", true, "version", version);
    }

    private DepMapRepository.Edge lockAndFind(String id) {
        repo.lockMeta();
        DepMapRepository.Edge edge = repo.edge(id);
        if (edge == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Esa dependencia ya no existe.");
        return edge;
    }

    private long mutate(CurrentUser user, String summary, Map<String, Object> entity, Runnable change) {
        long version = repo.lockMeta() + 1;
        change.run();
        OffsetDateTime updatedAt = repo.updateMeta(version, user.name());
        repo.insertActivity(user.id(), user.name(), summary);
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("version", version);
        metadata.put("summary", summary);
        metadata.put("entity", entity);
        audit.logAudit(user.id(), "depmap.updated", "depmap", null, metadata);
        afterCommit(version, user.name(), summary, entity, updatedAt.toInstant().toString());
        return version;
    }

    private void afterCommit(long version, String by, String summary, Map<String, Object> entity, String ts) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                events.broadcastUpdate(version, by, summary, entity, ts);
            }
        });
    }

    private String validateEdges(JsonNode list) {
        if (list == null || !list.isArray()) return "Falta la lista \"edges\".";
        java.util.HashSet<String> ids = new java.util.HashSet<>();
        for (JsonNode edge : list) {
            if (edge == null || !edge.isObject()) return "Hay una dependencia inválida.";
            JsonNode idNode = edge.get("id");
            String id = idNode != null && idNode.isTextual() ? idNode.asText() : null;
            if (id == null || id.isEmpty() || !ids.add(id)) {
                return "Id inválido o repetido: " + jsonValue(idNode);
            }
            String from = text(edge, "from");
            String to = text(edge, "to");
            if (from == null || to == null || !repo.nodeExists(from) || !repo.nodeExists(to)) {
                return "Grupo inexistente en una dependencia (" + display(from, edge.get("from")) + " → "
                        + display(to, edge.get("to")) + ").";
            }
            if (from.equals(to)) return "Una dependencia no puede apuntar al mismo grupo.";
            String edgeKind = text(edge, "kind");
            if (edgeKind == null || !repo.kindExists(edgeKind)) {
                return "Tipo desconocido: " + jsonValue(edge.get("kind")) + ".";
            }
            if (edge.has("state") && (text(edge, "state") == null || !STATES.contains(text(edge, "state")))) {
                return "Estado inválido: " + jsonValue(edge.get("state")) + ".";
            }
            if (clean(edge.get("text"), 200).isEmpty()) return "Hay una dependencia sin texto.";
        }
        return null;
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.isTextual() ? value.asText() : value.toString();
    }

    private String clean(JsonNode value, int max) {
        String source = value == null || value.isNull() ? "" : value.isTextual() ? value.asText() : value.toString();
        return source.replaceAll("\\s+", " ").trim().substring(0, Math.min(max, source.replaceAll("\\s+", " ").trim().length()));
    }

    private String shortText(String text) {
        return text.length() > 60 ? text.substring(0, 57) + "…" : text;
    }

    private String randomHex() {
        byte[] bytes = new byte[2];
        RANDOM.nextBytes(bytes);
        return String.format("%02x%02x", bytes[0] & 0xff, bytes[1] & 0xff);
    }

    private Map<String, Object> edgeMap(DepMapRepository.Edge edge) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", edge.id()); result.put("from", edge.from()); result.put("to", edge.to());
        result.put("kind", edge.kind()); result.put("state", edge.state()); result.put("text", edge.text());
        return result;
    }

    private Map<String, Object> map(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) result.put((String) values[i], values[i + 1]);
        return result;
    }

    private String jsonValue(JsonNode value) {
        if (value == null || value.isMissingNode()) return "undefined";
        try { return json.writeValueAsString(value); }
        catch (Exception e) { return "null"; }
    }

    private String display(String value, JsonNode original) {
        return original == null || original.isMissingNode() ? "undefined" : value;
    }
}
