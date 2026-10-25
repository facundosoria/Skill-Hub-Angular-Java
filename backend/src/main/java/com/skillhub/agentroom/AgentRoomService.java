package com.skillhub.agentroom;

import com.skillhub.audit.AuditService;
import com.skillhub.team.Team;
import com.skillhub.web.DomainException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Salas donde agentes de distintos equipos negocian un acuerdo: un contrato o
 * como resolver un problema entre equipos (que cambia cada lado). Logica unica
 * para la web (AgentRoomController) y el MCP (McpTools): ambos canales pasan
 * un RoomActor y reciben los mismos errores (DomainException = 400,
 * ResponseStatusException = 403/404).
 */
@Service
public class AgentRoomService {

    static final int MAX_TITLE = 160;
    static final int MAX_TOPIC = 4_000;
    static final int MAX_BODY_BYTES = 20 * 1024;
    static final int MAX_CONTRACT_BYTES = 100 * 1024;
    static final int DEFAULT_LIMIT = 50;
    static final int MAX_LIMIT = 200;
    private static final Set<String> FORMATS = Set.of("markdown", "openapi");

    private final AgentRoomRepository repo;
    private final AgentRoomEvents events;
    private final AuditService audit;

    public AgentRoomService(AgentRoomRepository repo, AgentRoomEvents events, AuditService audit) {
        this.repo = repo;
        this.events = events;
        this.audit = audit;
    }

    public List<Map<String, Object>> list(RoomActor actor) {
        if (!actor.admin() && !actor.hasTeam()) return List.of();
        return repo.listRooms(actor.admin() ? null : actor.team()).stream()
                .map(AgentRoomRepository.Room::toMap).toList();
    }

    @Transactional
    public Map<String, Object> create(RoomActor actor, String title, String topic, List<String> inviteTeams) {
        if (!actor.hasTeam()) throw new DomainException("Tu usuario no tiene equipo asignado.");
        String cleanTitle = clean(title);
        if (cleanTitle.isEmpty()) throw new DomainException("Falta el título de la sala.");
        if (cleanTitle.length() > MAX_TITLE) throw new DomainException("El título supera " + MAX_TITLE + " caracteres.");
        String cleanTopic = clean(topic);
        if (cleanTopic.length() > MAX_TOPIC) throw new DomainException("El tema supera " + MAX_TOPIC + " caracteres.");

        Set<String> teams = new LinkedHashSet<>();
        teams.add(actor.team());
        for (String raw : inviteTeams == null ? List.<String>of() : inviteTeams) {
            String team = Team.canonicalOrNull(raw);
            if (team == null) throw new DomainException("Equipo desconocido: " + raw);
            teams.add(team);
        }
        if (teams.size() < 2) throw new DomainException("Invitá al menos a otro equipo.");

        String roomId = repo.insertRoom(cleanTitle, cleanTopic, actor.userId(), actor.team());
        teams.forEach(team -> repo.insertTeam(roomId, team));
        appendMessage(roomId, null, "system", "system",
                actor.name() + " (" + actor.team() + ") abrió la sala con " + String.join(", ", teams) + ".", "open");
        audit.logAudit(actor.userId(), "agent_room.created", "agent_room", roomId,
                Map.of("title", cleanTitle, "teams", List.copyOf(teams), "via", actor.kind()));
        return detail(actor, roomId);
    }

    /** Sala, acuerdo vigente con sus aceptaciones y los ultimos mensajes. */
    public Map<String, Object> detail(RoomActor actor, String roomId) {
        AgentRoomRepository.Room room = accessible(actor, roomId);
        Map<String, Object> out = room.toMap();
        out.put("contract", contractMap(room, true));
        out.put("messages", repo.messagesSince(roomId, Math.max(0, room.lastSeq() - MAX_LIMIT), MAX_LIMIT)
                .stream().map(AgentRoomRepository.Message::toMap).toList());
        return out;
    }

    /**
     * Lectura incremental por cursor: mensajes con seq > sinceSeq. El contenido
     * del acuerdo solo viaja en la primera lectura o cuando en el lote hay una
     * propuesta nueva, para que el polling de los agentes sea barato.
     */
    public Map<String, Object> read(RoomActor actor, String roomId, long sinceSeq, Integer limit) {
        AgentRoomRepository.Room room = accessible(actor, roomId);
        int size = limit == null || limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
        long since = Math.max(0, sinceSeq);
        List<AgentRoomRepository.Message> messages = repo.messagesSince(roomId, since, size);
        boolean newProposal = messages.stream().anyMatch(m -> "proposal".equals(m.kind()));
        long nextSeq = messages.isEmpty() ? since : messages.get(messages.size() - 1).seq();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("room", room.toMap());
        out.put("contract", contractMap(room, since == 0 || newProposal));
        out.put("messages", messages.stream().map(AgentRoomRepository.Message::toMap).toList());
        out.put("nextSeq", nextSeq);
        out.put("hasMore", nextSeq < room.lastSeq());
        return out;
    }

    @Transactional
    public Map<String, Object> post(RoomActor actor, String roomId, String body) {
        AgentRoomRepository.Room room = lockedForWrite(actor, roomId);
        String text = clean(body);
        if (text.isEmpty()) throw new DomainException("El mensaje está vacío.");
        if (bytes(text) > MAX_BODY_BYTES) throw new DomainException("El mensaje supera 20 KB.");
        AgentRoomRepository.Message message = appendMessage(roomId, actor, actor.kind(), "message", text, room.status());
        return message.toMap();
    }

    @Transactional
    public Map<String, Object> proposeContract(RoomActor actor, String roomId, String format,
                                               String content, String note) {
        AgentRoomRepository.Room room = lockedForWrite(actor, roomId);
        requireInvitedTeam(actor, room);
        String fmt = format == null || format.isBlank() ? "markdown" : format.trim().toLowerCase();
        if (!FORMATS.contains(fmt)) throw new DomainException("Formato inválido: usá markdown u openapi.");
        String text = content == null ? "" : content.strip();
        if (text.isEmpty()) throw new DomainException("El acuerdo está vacío.");
        if (bytes(text) > MAX_CONTRACT_BYTES) throw new DomainException("El acuerdo supera 100 KB.");
        String cleanNote = clean(note);
        if (bytes(cleanNote) > MAX_BODY_BYTES) throw new DomainException("La nota supera 20 KB.");

        AgentRoomRepository.Contract current = repo.latestContract(roomId);
        int version = current == null ? 1 : current.version() + 1;
        String summary = "Propuso el acuerdo v" + version + " (" + fmt + ")."
                + (cleanNote.isEmpty() ? "" : "\n\n" + cleanNote);
        if (!"open".equals(room.status())) repo.setStatus(roomId, "open");
        AgentRoomRepository.Message message = appendMessage(roomId, actor, actor.kind(), "proposal", summary, "open");
        repo.insertContract(roomId, version, fmt, text, actor, message.id());
        audit.logAudit(actor.userId(), "agent_room.contract_proposed", "agent_room", roomId,
                Map.of("version", version, "format", fmt, "team", actor.team(), "via", actor.kind()));
        return Map.of("version", version, "message", message.toMap());
    }

    @Transactional
    public Map<String, Object> accept(RoomActor actor, String roomId, int version) {
        AgentRoomRepository.Room room = lockedForWrite(actor, roomId);
        requireInvitedTeam(actor, room);
        AgentRoomRepository.Contract current = repo.latestContract(roomId);
        if (current == null) throw new DomainException("Todavía no hay un acuerdo propuesto.");
        if (current.version() != version) {
            throw new DomainException("Solo se puede aceptar la última versión (v" + current.version() + ").");
        }
        boolean inserted = repo.insertAcceptance(roomId, version, actor.team(), actor.userId());
        List<String> accepted = repo.acceptedTeams(roomId, version);
        boolean agreed = accepted.containsAll(room.teams());
        String status = agreed ? "agreed" : room.status();
        if (inserted) {
            if (agreed) repo.setStatus(roomId, "agreed");
            appendMessage(roomId, actor, actor.kind(), "accept",
                    actor.team() + " aceptó el acuerdo v" + version + ".", status);
            if (agreed) {
                appendMessage(roomId, null, "system", "system",
                        "Todos los equipos aceptaron el acuerdo v" + version + ". Sala en estado acordado.", status);
            }
            audit.logAudit(actor.userId(), "agent_room.contract_accepted", "agent_room", roomId,
                    Map.of("version", version, "team", actor.team(), "agreed", agreed, "via", actor.kind()));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", version);
        out.put("acceptedBy", accepted);
        out.put("status", status);
        return out;
    }

    @Transactional
    public Map<String, Object> close(RoomActor actor, String roomId) {
        AgentRoomRepository.Room room = lockedForWrite(actor, roomId);
        if (!actor.admin() && !room.createdByTeam().equals(actor.team())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo el equipo que abrió la sala o un admin puede cerrarla.");
        }
        repo.setStatus(roomId, "closed");
        appendMessage(roomId, null, "system", "system", actor.name() + " cerró la sala.", "closed");
        audit.logAudit(actor.userId(), "agent_room.closed", "agent_room", roomId, Map.of("via", actor.kind()));
        return Map.of("status", "closed");
    }

    public long lastSeq(RoomActor actor, String roomId) {
        return accessible(actor, roomId).lastSeq();
    }

    private AgentRoomRepository.Room accessible(RoomActor actor, String roomId) {
        AgentRoomRepository.Room room = isUuid(roomId) ? repo.room(roomId) : null;
        return checkAccess(actor, room);
    }

    private AgentRoomRepository.Room lockedForWrite(RoomActor actor, String roomId) {
        AgentRoomRepository.Room room = checkAccess(actor, isUuid(roomId) ? repo.lockRoom(roomId) : null);
        if ("closed".equals(room.status())) throw new DomainException("La sala está cerrada.");
        return room;
    }

    private AgentRoomRepository.Room checkAccess(RoomActor actor, AgentRoomRepository.Room room) {
        if (room == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "La sala no existe.");
        if (actor.admin() || (actor.hasTeam() && room.teams().contains(actor.team()))) return room;
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Tu equipo no está invitado a esta sala.");
    }

    private void requireInvitedTeam(RoomActor actor, AgentRoomRepository.Room room) {
        if (!actor.hasTeam() || !room.teams().contains(actor.team())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un equipo invitado puede proponer o aceptar acuerdos.");
        }
    }

    private Map<String, Object> contractMap(AgentRoomRepository.Room room, boolean withContent) {
        AgentRoomRepository.Contract contract = repo.latestContract(room.id());
        if (contract == null) return null;
        List<String> accepted = repo.acceptedTeams(room.id(), contract.version());
        List<String> pending = new ArrayList<>(room.teams());
        pending.removeAll(accepted);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", contract.version());
        out.put("format", contract.format());
        out.put("proposedByTeam", contract.proposedByTeam());
        out.put("createdAt", contract.createdAt());
        out.put("acceptedBy", accepted);
        out.put("pendingTeams", pending);
        if (withContent) out.put("content", contract.content());
        return out;
    }

    private AgentRoomRepository.Message appendMessage(String roomId, RoomActor actor, String authorKind,
                                                      String kind, String body, String status) {
        long seq = repo.nextSeq(roomId);
        AgentRoomRepository.Message message = repo.insertMessage(roomId, seq, actor, authorKind, kind, body);
        Map<String, Object> payload = message.toMap();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() {
                    events.broadcastMessage(roomId, payload, status);
                }
            });
        } else {
            events.broadcastMessage(roomId, payload, status);
        }
        return message;
    }

    private static boolean isUuid(String value) {
        if (value == null) return false;
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.strip();
    }

    private static int bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }
}
