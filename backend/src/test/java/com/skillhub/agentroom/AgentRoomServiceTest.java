package com.skillhub.agentroom;

import com.skillhub.audit.AuditService;
import com.skillhub.web.DomainException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Reglas de las salas de agentes sin base de datos: acceso por equipo,
 * limites de mensajes y acuerdos, aceptaciones y cierre.
 */
class AgentRoomServiceTest {

    private static final String BANCO = "Identidad y Usuarios";
    private static final String MERCADO = "Cursos y Matrícula";
    private static final String OTRO = "Motor de Desafíos";
    private static final String ROOM = UUID.randomUUID().toString();

    private final RoomActor banco = new RoomActor("u1", "Ana", BANCO, false, null, "human");
    private final RoomActor mercado = new RoomActor("u2", "Beto", MERCADO, false, "k2", "agent");
    private final RoomActor outsider = new RoomActor("u3", "Caro", OTRO, false, null, "human");
    private final RoomActor admin = new RoomActor("u4", "Admin", null, true, null, "human");
    private final RoomActor teamless = new RoomActor("u5", "Sin", " ", false, null, "human");

    private AgentRoomRepository repo;
    private AgentRoomEvents events;
    private AuditService audit;
    private AgentRoomService service;
    private long seq;
    private final List<AgentRoomRepository.Message> inserted = new ArrayList<>();

    @BeforeEach
    void setUp() {
        repo = mock(AgentRoomRepository.class);
        events = mock(AgentRoomEvents.class);
        audit = mock(AuditService.class);
        service = new AgentRoomService(repo, events, audit);
        seq = 0;
        when(repo.nextSeq(anyString())).thenAnswer(call -> ++seq);
        when(repo.insertMessage(anyString(), anyLong(), any(), anyString(), anyString(), anyString())).thenAnswer(call -> {
            AgentRoomRepository.Message message = new AgentRoomRepository.Message("m" + call.getArgument(1), call.getArgument(1),
                    "autor", null, call.getArgument(3), call.getArgument(4), call.getArgument(5), "2026-10-25T10:00:00Z");
            inserted.add(message);
            return message;
        });
        room("open", 3);
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) TransactionSynchronizationManager.clearSynchronization();
    }

    private AgentRoomRepository.Room room(String status, long lastSeq) {
        AgentRoomRepository.Room room = new AgentRoomRepository.Room(ROOM, "Sala", "Tema", BANCO, status, lastSeq,
                "2026-10-25T10:00:00Z", "2026-10-25T10:00:00Z", List.of(BANCO, MERCADO));
        when(repo.room(ROOM)).thenReturn(room);
        when(repo.lockRoom(ROOM)).thenReturn(room);
        return room;
    }

    private void contract(int version) {
        when(repo.latestContract(ROOM)).thenReturn(new AgentRoomRepository.Contract(version, "markdown", "# Acuerdo", BANCO, "2026-10-25T10:00:00Z"));
    }

    // --- listing and creation ----------------------------------------

    @Test
    void listsRoomsForTheTeamOrEverythingForAdmins() {
        AgentRoomRepository.Room room = repo.room(ROOM);
        when(repo.listRooms(BANCO)).thenReturn(List.of(room));
        when(repo.listRooms(null)).thenReturn(List.of(room, room));

        assertThat(service.list(banco)).hasSize(1);
        assertThat(service.list(admin)).hasSize(2);
        assertThat(service.list(teamless)).isEmpty();
    }

    @Test
    void createsARoomWithTheInvitedTeamsAndAnOpeningMessage() {
        when(repo.insertRoom("Sala", "Tema", "u1", BANCO)).thenReturn(ROOM);

        Map<String, Object> detail = service.create(banco, "  Sala ", " Tema ", List.of(MERCADO, BANCO));

        verify(repo).insertTeam(ROOM, BANCO);
        verify(repo).insertTeam(ROOM, MERCADO);
        assertThat(inserted.getFirst().body()).isEqualTo("Ana (" + BANCO + ") abrió la sala con " + BANCO + ", " + MERCADO + ".");
        verify(events).broadcastMessage(eq(ROOM), anyMap(), eq("open"));
        assertThat(detail).containsKey("messages");
    }

    @Test
    void creationValidatesTeamTitleTopicAndGuests() {
        assertThatThrownBy(() -> service.create(teamless, "Sala", null, List.of(MERCADO))).hasMessage("Tu usuario no tiene equipo asignado.");
        assertThatThrownBy(() -> service.create(banco, " ", null, List.of(MERCADO))).hasMessage("Falta el título de la sala.");
        assertThatThrownBy(() -> service.create(banco, null, null, List.of(MERCADO))).hasMessage("Falta el título de la sala.");
        assertThatThrownBy(() -> service.create(banco, "t".repeat(161), null, List.of(MERCADO))).hasMessage("El título supera 160 caracteres.");
        assertThatThrownBy(() -> service.create(banco, "Sala", "t".repeat(4001), List.of(MERCADO))).hasMessage("El tema supera 4000 caracteres.");
        assertThatThrownBy(() -> service.create(banco, "Sala", null, List.of("Inventado"))).hasMessage("Equipo desconocido: Inventado");
        assertThatThrownBy(() -> service.create(banco, "Sala", null, null)).hasMessage("Invitá al menos a otro equipo.");
        assertThatThrownBy(() -> service.create(banco, "Sala", null, List.of(BANCO))).hasMessage("Invitá al menos a otro equipo.");
    }

    // --- access ----------------------------------------------------------

    @Test
    void onlyInvitedTeamsAndAdminsCanSeeARoom() {
        assertThat(service.lastSeq(banco, ROOM)).isEqualTo(3);
        assertThat(service.lastSeq(admin, ROOM)).isEqualTo(3);
        assertThatThrownBy(() -> service.detail(outsider, ROOM)).isInstanceOf(ResponseStatusException.class).hasMessageContaining("no está invitado");
        assertThatThrownBy(() -> service.detail(teamless, ROOM)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void unknownOrMalformedRoomIdsAreNotFound() {
        assertThatThrownBy(() -> service.detail(banco, "no-es-uuid")).hasMessageContaining("La sala no existe.");
        assertThatThrownBy(() -> service.detail(banco, null)).hasMessageContaining("La sala no existe.");
        assertThatThrownBy(() -> service.detail(banco, UUID.randomUUID().toString())).hasMessageContaining("La sala no existe.");
        assertThatThrownBy(() -> service.post(banco, "no-es-uuid", "hola")).hasMessageContaining("La sala no existe.");
    }

    // --- reading -------------------------------------------------------

    @Test
    void detailIncludesTheContractWithPendingTeams() {
        contract(2);
        when(repo.acceptedTeams(ROOM, 2)).thenReturn(List.of(BANCO));

        @SuppressWarnings("unchecked") Map<String, Object> contract = (Map<String, Object>) service.detail(banco, ROOM).get("contract");

        assertThat(contract).containsEntry("version", 2).containsEntry("content", "# Acuerdo");
        assertThat(contract.get("pendingTeams")).isEqualTo(List.of(MERCADO));
        verify(repo).messagesSince(ROOM, 0, 200);
    }

    @Test
    void readsIncrementallyAndOnlyShipsTheContractWhenNeeded() {
        contract(1);
        when(repo.acceptedTeams(ROOM, 1)).thenReturn(List.of());
        when(repo.messagesSince(ROOM, 2, 50)).thenReturn(List.of(new AgentRoomRepository.Message("m3", 3, "a", BANCO, "human", "message", "hola", "t")));
        when(repo.messagesSince(ROOM, 3, 5)).thenReturn(List.of());

        Map<String, Object> page = service.read(banco, ROOM, 2, null);
        assertThat(page).containsEntry("nextSeq", 3L).containsEntry("hasMore", false);
        @SuppressWarnings("unchecked") Map<String, Object> contract = (Map<String, Object>) page.get("contract");
        assertThat(contract).doesNotContainKey("content");

        Map<String, Object> empty = service.read(banco, ROOM, 3, 5);
        assertThat(empty).containsEntry("nextSeq", 3L);

        service.read(banco, ROOM, -5, 1000);
        verify(repo).messagesSince(ROOM, 0, 200);
        service.read(banco, ROOM, 0, 0);
        verify(repo).messagesSince(ROOM, 0, 50);
    }

    @Test
    void aNewProposalInTheBatchShipsTheContractContent() {
        contract(1);
        when(repo.messagesSince(ROOM, 1, 50)).thenReturn(List.of(new AgentRoomRepository.Message("m2", 2, "a", BANCO, "agent", "proposal", "p", "t")));

        @SuppressWarnings("unchecked") Map<String, Object> contract = (Map<String, Object>) service.read(banco, ROOM, 1, null).get("contract");

        assertThat(contract).containsKey("content");
        assertThat(service.read(banco, ROOM, 1, null)).containsEntry("hasMore", true);
    }

    // --- posting -------------------------------------------------------

    @Test
    void postsTrimmedMessagesAndBroadcastsAfterCommit() {
        TransactionSynchronizationManager.initSynchronization();

        service.post(banco, ROOM, "  hola  ");

        assertThat(inserted.getFirst().body()).isEqualTo("hola");
        verify(events, never()).broadcastMessage(anyString(), anyMap(), anyString());
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        verify(events).broadcastMessage(eq(ROOM), anyMap(), eq("open"));
    }

    @Test
    void rejectsEmptyOrOversizedMessagesAndClosedRooms() {
        assertThatThrownBy(() -> service.post(banco, ROOM, " ")).hasMessage("El mensaje está vacío.");
        assertThatThrownBy(() -> service.post(banco, ROOM, null)).hasMessage("El mensaje está vacío.");
        assertThatThrownBy(() -> service.post(banco, ROOM, "ñ".repeat(10_241))).hasMessage("El mensaje supera 20 KB.");
        room("closed", 3);
        assertThatThrownBy(() -> service.post(banco, ROOM, "hola")).isInstanceOf(DomainException.class).hasMessage("La sala está cerrada.");
    }

    // --- contracts -----------------------------------------------------

    @Test
    void proposesTheFirstContractAndReopensAgreedRooms() {
        room("agreed", 3);

        Map<String, Object> result = service.proposeContract(mercado, ROOM, " OpenAPI ", "  openapi: 3  ", " nota ");

        assertThat(result).containsEntry("version", 1);
        verify(repo).setStatus(ROOM, "open");
        verify(repo).insertContract(eq(ROOM), eq(1), eq("openapi"), eq("openapi: 3"), eq(mercado), anyString());
        assertThat(inserted.getFirst().body()).isEqualTo("Propuso el acuerdo v1 (openapi).\n\nnota");
    }

    @Test
    void proposalsBumpTheVersionAndDefaultToMarkdown() {
        contract(4);

        assertThat(service.proposeContract(banco, ROOM, null, "texto", null)).containsEntry("version", 5);
        assertThat(service.proposeContract(banco, ROOM, " ", "texto", "")).containsEntry("version", 5);
        verify(repo, never()).setStatus(anyString(), anyString());
        assertThat(inserted.getFirst().body()).isEqualTo("Propuso el acuerdo v5 (markdown).");
    }

    @Test
    void proposalsAreValidated() {
        assertThatThrownBy(() -> service.proposeContract(admin, ROOM, null, "x", null)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.proposeContract(banco, ROOM, "pdf", "x", null)).hasMessage("Formato inválido: usá markdown u openapi.");
        assertThatThrownBy(() -> service.proposeContract(banco, ROOM, null, null, null)).hasMessage("El acuerdo está vacío.");
        assertThatThrownBy(() -> service.proposeContract(banco, ROOM, null, " ", null)).hasMessage("El acuerdo está vacío.");
        assertThatThrownBy(() -> service.proposeContract(banco, ROOM, null, "x".repeat(100 * 1024 + 1), null)).hasMessage("El acuerdo supera 100 KB.");
        assertThatThrownBy(() -> service.proposeContract(banco, ROOM, null, "x", "n".repeat(20 * 1024 + 1))).hasMessage("La nota supera 20 KB.");
    }

    @Test
    void acceptingRecordsTheTeamAndAgreesWhenEveryoneAccepted() {
        contract(2);
        when(repo.insertAcceptance(ROOM, 2, BANCO, "u1")).thenReturn(true);
        when(repo.acceptedTeams(ROOM, 2)).thenReturn(List.of(BANCO));

        Map<String, Object> partial = service.accept(banco, ROOM, 2);
        assertThat(partial).containsEntry("status", "open");
        verify(repo, never()).setStatus(ROOM, "agreed");

        when(repo.insertAcceptance(ROOM, 2, MERCADO, "u2")).thenReturn(true);
        when(repo.acceptedTeams(ROOM, 2)).thenReturn(List.of(BANCO, MERCADO));
        Map<String, Object> agreed = service.accept(mercado, ROOM, 2);

        assertThat(agreed).containsEntry("status", "agreed");
        verify(repo).setStatus(ROOM, "agreed");
        assertThat(inserted).extracting(AgentRoomRepository.Message::body).last().asString().startsWith("Todos los equipos aceptaron");
        verify(audit).logAudit(eq("u2"), eq("agent_room.contract_accepted"), eq("agent_room"), eq(ROOM), anyMap());
    }

    @Test
    void aRepeatedAcceptanceChangesNothing() {
        contract(2);
        when(repo.insertAcceptance(ROOM, 2, BANCO, "u1")).thenReturn(false);
        when(repo.acceptedTeams(ROOM, 2)).thenReturn(List.of(BANCO));

        service.accept(banco, ROOM, 2);

        assertThat(inserted).isEmpty();
        verify(audit, never()).logAudit(anyString(), anyString(), anyString(), anyString(), anyMap());
    }

    @Test
    void acceptanceNeedsTheLatestProposedVersion() {
        assertThatThrownBy(() -> service.accept(banco, ROOM, 1)).hasMessage("Todavía no hay un acuerdo propuesto.");
        contract(3);
        assertThatThrownBy(() -> service.accept(banco, ROOM, 2)).hasMessage("Solo se puede aceptar la última versión (v3).");
        assertThatThrownBy(() -> service.accept(outsider, ROOM, 3)).isInstanceOf(ResponseStatusException.class);
        verify(repo, never()).insertAcceptance(anyString(), anyInt(), anyString(), anyString());
    }

    // --- closing -------------------------------------------------------

    @Test
    void theOpeningTeamOrAnAdminCanClose() {
        assertThat(service.close(banco, ROOM)).containsEntry("status", "closed");
        assertThat(service.close(admin, ROOM)).containsEntry("status", "closed");
        assertThatThrownBy(() -> service.close(mercado, ROOM)).isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Solo el equipo que abrió la sala");
    }

    @Test
    void roomActorsCarryTheirOrigin() {
        assertThat(banco.hasTeam()).isTrue();
        assertThat(teamless.hasTeam()).isFalse();
        assertThat(new RoomActor("u", "n", null, false, null, "human").hasTeam()).isFalse();
    }
}
