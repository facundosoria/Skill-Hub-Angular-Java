package com.skillhub.depmap;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.audit.AuditService;
import com.skillhub.session.CurrentUser;
import com.skillhub.web.DomainException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Reglas del mapa de dependencias sin base de datos: validacion de altas e
 * importaciones, resumen de actividad y aviso en vivo despues del commit.
 */
class DepMapServiceTest {

    private final ObjectMapper json = new ObjectMapper();
    private final CurrentUser user = new CurrentUser("u1", "ana", "Ana", "Banco", "member", false);
    private DepMapRepository repo;
    private DepMapEvents events;
    private AuditService audit;
    private DepMapService service;

    @BeforeEach
    void setUp() {
        repo = mock(DepMapRepository.class);
        events = mock(DepMapEvents.class);
        audit = mock(AuditService.class);
        service = new DepMapService(repo, events, audit, json);
        when(repo.nodeExists(anyString())).thenAnswer(call -> List.of("usr", "ops", "pag").contains(call.getArgument(0)));
        when(repo.kindExists(anyString())).thenAnswer(call -> List.of("api", "evento").contains(call.getArgument(0)));
        when(repo.nodeName(anyString())).thenAnswer(call -> "Grupo " + call.getArgument(0));
        when(repo.lockMeta()).thenReturn(4L);
        when(repo.updateMeta(anyLong(), anyString())).thenReturn(OffsetDateTime.parse("2026-10-25T10:00:00Z"));
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    private JsonNode body(String raw) throws Exception {
        return json.readTree(raw.replace('\'', '"'));
    }

    private void commit() {
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
    }

    @Test
    void delegatesStateAndVersionToTheRepository() {
        when(repo.state(List.of("usr"))).thenReturn(Map.of("version", 4));
        when(repo.currentVersion()).thenReturn(4L);

        assertThat(service.state(List.of("usr"))).containsEntry("version", 4);
        assertThat(service.currentVersion()).isEqualTo(4L);
    }

    @Test
    void addsAnEdgeAndBroadcastsOnlyAfterCommit() throws Exception {
        Map<String, Object> result = service.addEdge(user,
                body("{'from':'usr','to':'ops','kind':'api','state':'definir','text':'  Necesitamos   un endpoint '}"));

        assertThat(result.get("version")).isEqualTo(5L);
        @SuppressWarnings("unchecked") Map<String, Object> edge = (Map<String, Object>) result.get("edge");
        assertThat(edge).containsEntry("state", "definir").containsEntry("text", "Necesitamos un endpoint");
        assertThat((String) edge.get("id")).matches("u[0-9a-z]+[0-9a-f]{4}");
        verify(repo).insertEdge(eq((String) edge.get("id")), eq("usr"), eq("ops"), eq("api"), eq("definir"), eq("Necesitamos un endpoint"));
        verify(repo).insertActivity("u1", "Ana", "agregó «Necesitamos un endpoint» (Grupo usr → Grupo ops)");
        verify(audit).logAudit(eq("u1"), eq("depmap.updated"), eq("depmap"), eq(null), anyMap());
        verify(events, never()).broadcastUpdate(anyLong(), anyString(), anyString(), anyMap(), anyString());

        commit();

        verify(events).broadcastUpdate(eq(5L), eq("Ana"), anyString(), anyMap(), eq("2026-10-25T10:00:00Z"));
    }

    @Test
    void defaultsUnknownStatesToPending() throws Exception {
        @SuppressWarnings("unchecked") Map<String, Object> edge = (Map<String, Object>) service.addEdge(user,
                body("{'from':'usr','to':'ops','kind':'api','state':'otro','text':'Algo'}")).get("edge");

        assertThat(edge).containsEntry("state", "pendiente");
    }

    @Test
    void shortensLongTextsInTheActivitySummary() throws Exception {
        String text = "x".repeat(80);

        service.addEdge(user, body("{'from':'usr','to':'ops','kind':'api','text':'" + text + "'}"));

        verify(repo).insertActivity(eq("u1"), eq("Ana"), eq("agregó «" + "x".repeat(57) + "…» (Grupo usr → Grupo ops)"));
    }

    @Test
    void truncatesTheStoredTextAtFiveHundredCharacters() throws Exception {
        @SuppressWarnings("unchecked") Map<String, Object> edge = (Map<String, Object>) service.addEdge(user,
                body("{'from':'usr','to':'ops','kind':'api','text':'" + "t".repeat(600) + "'}")).get("edge");

        assertThat((String) edge.get("text")).hasSize(500);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "{'to':'ops','kind':'api','text':'x'}|Grupo inexistente.",
            "{'from':'usr','kind':'api','text':'x'}|Grupo inexistente.",
            "{'from':'zzz','to':'ops','kind':'api','text':'x'}|Grupo inexistente.",
            "{'from':'usr','to':'zzz','kind':'api','text':'x'}|Grupo inexistente.",
            "{'from':'usr','to':'usr','kind':'api','text':'x'}|Elegí dos grupos distintos.",
            "{'from':'usr','to':'ops','text':'x'}|Tipo de dependencia desconocido.",
            "{'from':'usr','to':'ops','kind':'raro','text':'x'}|Tipo de dependencia desconocido.",
            "{'from':'usr','to':'ops','kind':'api','text':'   '}|Contá qué necesita.",
            "{'from':'usr','to':'ops','kind':'api'}|Contá qué necesita.",
    })
    void rejectsInvalidEdges(String raw, String message) throws Exception {
        assertThatThrownBy(() -> service.addEdge(user, body(raw))).isInstanceOf(DomainException.class).hasMessage(message);
        verify(repo, never()).insertEdge(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsAMissingBody() {
        assertThatThrownBy(() -> service.addEdge(user, null)).isInstanceOf(DomainException.class).hasMessage("Grupo inexistente.");
    }

    @Test
    void acceptsNonTextualValuesByTheirJson() throws Exception {
        when(repo.nodeExists("1")).thenReturn(true);

        service.addEdge(user, body("{'from':1,'to':'ops','kind':'api','text':42}"));

        verify(repo).insertEdge(anyString(), eq("1"), eq("ops"), eq("api"), eq("pendiente"), eq("42"));
    }

    @Test
    void deletesAnExistingEdge() {
        when(repo.edge("e1")).thenReturn(new DepMapRepository.Edge("e1", "usr", "ops", "api", "pendiente", "Alta", false));

        assertThat(service.deleteEdge(user, "e1")).containsEntry("ok", true).containsEntry("version", 5L);

        verify(repo).deleteEdge("e1");
        verify(repo).insertActivity("u1", "Ana", "eliminó «Alta»");
    }

    @Test
    void failsWithNotFoundForUnknownEdges() {
        assertThatThrownBy(() -> service.deleteEdge(user, "nada")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.setDone(user, "nada", null)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void marksAndUnmarksEdgesAsDone() throws Exception {
        when(repo.edge("e1")).thenReturn(new DepMapRepository.Edge("e1", "usr", "ops", "api", "pendiente", "Alta", false));

        service.setDone(user, "e1", body("{'done':true}"));
        service.setDone(user, "e1", body("{'done':false}"));
        service.setDone(user, "e1", null);

        verify(repo).setDone("e1", true, "u1");
        verify(repo, org.mockito.Mockito.times(2)).setDone("e1", false, "u1");
        verify(repo).insertActivity("u1", "Ana", "tildó «Alta»");
    }

    @Test
    void importsEdgesKeepingOnlyDoneFlagsOfImportedIds() throws Exception {
        Map<String, Object> result = service.importState(user, body("""
                {'edges':[
                  {'id':'a','from':'usr','to':'ops','kind':'api','text':'Uno'},
                  {'id':'b','from':'ops','to':'pag','kind':'evento','state':'definir','text':'Dos'}
                ],'done':{'a':true,'b':false,'zzz':true}}
                """));

        assertThat(result).containsEntry("ok", true);
        @SuppressWarnings("unchecked") ArgumentCaptor<List<Map<String, String>>> edges = ArgumentCaptor.forClass(List.class);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Boolean>> done = ArgumentCaptor.forClass(Map.class);
        verify(repo).replaceEdges(edges.capture(), done.capture());
        assertThat(edges.getValue()).extracting(edge -> edge.get("state")).containsExactly("pendiente", "definir");
        assertThat(done.getValue()).containsOnlyKeys("a");
        verify(repo).insertActivity("u1", "Ana", "importó datos (2 dependencias, 1 tildadas)");
    }

    @Test
    void importsWithoutDoneFlags() throws Exception {
        service.importState(user, body("{'edges':[],'done':'no'}"));

        verify(repo).replaceEdges(List.of(), Map.of());
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "{}|Falta la lista \"edges\".",
            "{'edges':'x'}|Falta la lista \"edges\".",
            "{'edges':[1]}|Hay una dependencia inválida.",
            "{'edges':[{'from':'usr'}]}|Id inválido o repetido: undefined",
            "{'edges':[{'id':7}]}|Id inválido o repetido: 7",
            "{'edges':[{'id':''}]}|Id inválido o repetido: \"\"",
            "{'edges':[{'id':'a','from':'usr','to':'ops','kind':'api','text':'x'},{'id':'a'}]}|Id inválido o repetido: \"a\"",
            "{'edges':[{'id':'a','to':'ops','kind':'api','text':'x'}]}|Grupo inexistente en una dependencia (undefined → ops).",
            "{'edges':[{'id':'a','from':'usr','to':'zzz','kind':'api','text':'x'}]}|Grupo inexistente en una dependencia (usr → zzz).",
            "{'edges':[{'id':'a','from':'usr','to':'usr','kind':'api','text':'x'}]}|Una dependencia no puede apuntar al mismo grupo.",
            "{'edges':[{'id':'a','from':'usr','to':'ops','text':'x'}]}|Tipo desconocido: undefined.",
            "{'edges':[{'id':'a','from':'usr','to':'ops','kind':'raro','text':'x'}]}|Tipo desconocido: \"raro\".",
            "{'edges':[{'id':'a','from':'usr','to':'ops','kind':'api','state':'otro','text':'x'}]}|Estado inválido: \"otro\".",
            "{'edges':[{'id':'a','from':'usr','to':'ops','kind':'api','state':null,'text':'x'}]}|Estado inválido: null.",
            "{'edges':[{'id':'a','from':'usr','to':'ops','kind':'api','text':' '}]}|Hay una dependencia sin texto.",
    })
    void rejectsInvalidImports(String raw, String message) throws Exception {
        assertThatThrownBy(() -> service.importState(user, body(raw))).isInstanceOf(DomainException.class).hasMessage(message);
        verify(repo, never()).replaceEdges(any(), any());
    }

    @Test
    void rejectsAnImportWithoutBody() {
        assertThatThrownBy(() -> service.importState(user, null)).hasMessage("Falta la lista \"edges\".");
    }

    @Test
    void resetsToTheSeedEdges() {
        List<Map<String, String>> seed = List.of(Map.of("id", "s1"));
        when(repo.seedEdges()).thenReturn(seed);

        assertThat(service.reset(user)).containsEntry("version", 5L);

        verify(repo).replaceEdges(seed, Map.of());
        verify(repo).insertActivity("u1", "Ana", "restauró los datos originales de la reunión");
    }
}
