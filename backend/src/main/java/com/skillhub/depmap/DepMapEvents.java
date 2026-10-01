package com.skillhub.depmap;

import jakarta.annotation.PreDestroy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class DepMapEvents {

    private final Map<String, Connection> connections = new ConcurrentHashMap<>();

    public SseEmitter connect(String name, long version) {
        String id = UUID.randomUUID().toString();
        SseEmitter emitter = new SseEmitter(0L);
        connections.put(id, new Connection(emitter, name == null ? "" : name));
        emitter.onCompletion(() -> disconnect(id));
        emitter.onTimeout(() -> disconnect(id));
        emitter.onError(ignored -> disconnect(id));
        send(id, map("type", "hello", "version", version, "presence", presence()));
        broadcastPresence();
        return emitter;
    }

    public void broadcastUpdate(long version, String by, String summary,
                                Map<String, Object> entity, String ts) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", "update");
        event.put("version", version);
        event.put("by", by);
        event.put("summary", summary);
        event.put("entity", entity);
        event.put("ts", ts);
        broadcast(event);
    }

    public List<String> currentPresence() {
        return presence();
    }

    @Scheduled(fixedRate = 25_000)
    public void heartbeat() {
        for (Map.Entry<String, Connection> entry : connections.entrySet()) {
            try {
                entry.getValue().emitter().send(SseEmitter.event().comment(" ping"));
            } catch (Exception e) {
                disconnect(entry.getKey());
            }
        }
    }

    @PreDestroy
    public void closeAll() {
        for (Connection connection : connections.values()) connection.emitter().complete();
        connections.clear();
    }

    private void broadcastPresence() {
        broadcast(map("type", "presence", "presence", presence()));
    }

    private void broadcast(Map<String, Object> event) {
        for (String id : connections.keySet()) send(id, event);
    }

    private void send(String id, Map<String, Object> event) {
        Connection connection = connections.get(id);
        if (connection == null) return;
        try {
            connection.emitter().send(SseEmitter.event().data(event));
        } catch (Exception e) {
            disconnect(id);
        }
    }

    private void disconnect(String id) {
        if (connections.remove(id) != null) broadcastPresence();
    }

    private List<String> presence() {
        Set<String> names = ConcurrentHashMap.newKeySet();
        for (Connection connection : connections.values()) {
            if (!connection.name().isBlank()) names.add(connection.name());
        }
        return new ArrayList<>(names);
    }

    private Map<String, Object> map(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) result.put((String) values[i], values[i + 1]);
        return result;
    }

    private record Connection(SseEmitter emitter, String name) {}
}
