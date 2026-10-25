package com.skillhub.agentroom;

import jakarta.annotation.PreDestroy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** SSE por sala, mismo patron que DepMapEvents. Solo lo consume la web. */
@Component
public class AgentRoomEvents {

    private final Map<String, Connection> connections = new ConcurrentHashMap<>();

    public SseEmitter connect(String roomId, long lastSeq) {
        String id = UUID.randomUUID().toString();
        SseEmitter emitter = new SseEmitter(0L);
        connections.put(id, new Connection(emitter, roomId));
        emitter.onCompletion(() -> connections.remove(id));
        emitter.onTimeout(() -> connections.remove(id));
        emitter.onError(ignored -> connections.remove(id));
        send(id, map("type", "hello", "lastSeq", lastSeq));
        return emitter;
    }

    public void broadcastMessage(String roomId, Map<String, Object> message, String status) {
        Map<String, Object> event = map("type", "message", "message", message, "status", status);
        for (Map.Entry<String, Connection> entry : connections.entrySet()) {
            if (entry.getValue().roomId().equals(roomId)) send(entry.getKey(), event);
        }
    }

    @Scheduled(fixedRate = 25_000)
    public void heartbeat() {
        for (Map.Entry<String, Connection> entry : connections.entrySet()) {
            try {
                entry.getValue().emitter().send(SseEmitter.event().comment(" ping"));
            } catch (Exception e) {
                connections.remove(entry.getKey());
            }
        }
    }

    @PreDestroy
    public void closeAll() {
        for (Connection connection : connections.values()) connection.emitter().complete();
        connections.clear();
    }

    private void send(String id, Map<String, Object> event) {
        Connection connection = connections.get(id);
        if (connection == null) return;
        try {
            connection.emitter().send(SseEmitter.event().data(event));
        } catch (Exception e) {
            connections.remove(id);
        }
    }

    private Map<String, Object> map(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) result.put((String) values[i], values[i + 1]);
        return result;
    }

    private record Connection(SseEmitter emitter, String roomId) {}
}
