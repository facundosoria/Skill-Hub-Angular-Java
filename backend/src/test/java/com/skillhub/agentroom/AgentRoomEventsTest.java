package com.skillhub.agentroom;

import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.lang.reflect.Field;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Registro de conexiones SSE por sala: saludo inicial, difusion solo a la
 * sala correcta y limpieza de emisores que ya no aceptan eventos.
 */
class AgentRoomEventsTest {

    private final AgentRoomEvents events = new AgentRoomEvents();

    private int connections() throws Exception {
        Field field = AgentRoomEvents.class.getDeclaredField("connections");
        field.setAccessible(true);
        return ((Map<?, ?>) field.get(events)).size();
    }

    @Test
    void connectingRegistersAnEmitterPerRoom() throws Exception {
        SseEmitter first = events.connect("sala-1", 3);
        SseEmitter second = events.connect("sala-2", 0);

        assertThat(first).isNotSameAs(second);
        assertThat(connections()).isEqualTo(2);
    }

    @Test
    void broadcastsReachOnlyTheMatchingRoomAndDropClosedEmitters() throws Exception {
        SseEmitter open = events.connect("sala-1", 0);
        SseEmitter closed = events.connect("sala-1", 0);
        events.connect("sala-2", 0);
        closed.complete();

        events.broadcastMessage("sala-1", Map.of("body", "hola"), "open");

        // El emisor completado falla al enviar y se quita; los demas siguen.
        assertThat(connections()).isEqualTo(2);
        open.complete();
        events.broadcastMessage("sala-2", Map.of("body", "otra"), "open");
        assertThat(connections()).isEqualTo(2);
    }

    @Test
    void heartbeatsDropEmittersThatCannotReceive() throws Exception {
        events.connect("sala-1", 0);
        SseEmitter dead = events.connect("sala-1", 0);
        dead.complete();

        events.heartbeat();

        assertThat(connections()).isEqualTo(1);
    }

    @Test
    void closingCompletesAndForgetsEveryConnection() throws Exception {
        events.connect("sala-1", 0);
        events.connect("sala-2", 0);

        events.closeAll();

        assertThat(connections()).isZero();
        events.heartbeat();
        events.broadcastMessage("sala-1", Map.of(), "open");
        assertThat(connections()).isZero();
    }
}
