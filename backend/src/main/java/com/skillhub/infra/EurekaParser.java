package com.skillhub.infra;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Parses the two shapes Eureka can answer with: the full registry (a list of
 * applications) and a single application (a singleton object). Both the
 * {@code application} and {@code instance} collections may be a single object or
 * an array, so both are normalised here without dropping replicas.
 */
public final class EurekaParser {

    private EurekaParser() {
    }

    public static Map<String, List<ServiceInstance>> parse(JsonNode root) {
        Map<String, List<ServiceInstance>> result = new LinkedHashMap<>();
        if (root == null || root.isNull()) return result;

        JsonNode appNodes = null;
        JsonNode applications = root.get("applications");
        if (applications != null && !applications.isNull()) {
            appNodes = applications.get("application");
        } else if (root.has("application")) {
            appNodes = root.get("application");
        }
        if (appNodes == null || appNodes.isNull()) return result;

        for (JsonNode appNode : asIterable(appNodes)) {
            String appName = text(appNode.get("name"));
            JsonNode instanceNodes = appNode.get("instance");
            if (instanceNodes == null || instanceNodes.isNull()) continue;
            List<ServiceInstance> instances = new ArrayList<>();
            for (JsonNode instanceNode : asIterable(instanceNodes)) {
                ServiceInstance instance = parseInstance(instanceNode, appName);
                if (instance != null) instances.add(instance);
            }
            String key = appName == null ? null : appName.toUpperCase();
            if (key == null && instances.isEmpty()) continue;
            if (key == null) key = instances.get(0).app().toUpperCase();
            result.put(key, instances);
        }
        return result;
    }

    private static ServiceInstance parseInstance(JsonNode node, String fallbackApp) {
        if (node == null || node.isNull()) return null;
        String app = text(node.get("app"));
        if (app == null) app = fallbackApp;
        String instanceId = text(node.get("instanceId"));
        if (instanceId == null) instanceId = text(node.get("hostName"));
        String host = text(node.get("hostName"));
        String ipAddr = text(node.get("ipAddr"));
        Integer port = port(node.get("port"));
        SecurePort securePort = securePort(node.get("securePort"));
        RegistryState state = RegistryState.fromEureka(text(node.get("status")));
        Map<String, String> metadata = metadata(node.get("metadata"));
        return new ServiceInstance(instanceId, app == null ? null : app.toUpperCase(),
                host, ipAddr, port, securePort.number(), securePort.enabled(), state, metadata);
    }

    private static Iterable<JsonNode> asIterable(JsonNode node) {
        if (node == null || node.isNull()) return List.of();
        if (node.isArray()) return node;
        return List.of(node);
    }

    private static String text(JsonNode node) {
        if (node == null || node.isNull()) return null;
        String value = node.asText(null);
        return value == null || value.isBlank() ? null : value;
    }

    private static Integer port(JsonNode node) {
        if (node == null || node.isNull()) return null;
        int value;
        if (node.isObject()) value = node.path("$").asInt(0);
        else value = node.asInt(0);
        return value > 0 ? value : null;
    }

    /**
     * Eureka may advertise the secure port as an object carrying the value and an
     * {@code enabled} flag, or as a bare numeric/textual value. The enabled flag
     * is kept separately so a disabled secure port is never probed over TLS; a
     * bare value carries no flag and preserves the previous "positive means TLS"
     * behaviour.
     */
    private static SecurePort securePort(JsonNode node) {
        if (node == null || node.isNull()) return new SecurePort(null, null);
        if (node.isObject()) {
            JsonNode value = node.get("$");
            return new SecurePort(positiveInt(value), enabledFlag(node));
        }
        return new SecurePort(positiveInt(node), Boolean.TRUE);
    }

    private static Integer positiveInt(JsonNode node) {
        if (node == null || node.isNull()) return null;
        int value = node.asInt(0);
        return value > 0 ? value : null;
    }

    private static Boolean enabledFlag(JsonNode node) {
        JsonNode flag = node.get("@enabled");
        if (flag == null || flag.isNull()) flag = node.get("enabled");
        if (flag == null || flag.isNull()) return null;
        if (flag.isBoolean()) return flag.asBoolean();
        String value = flag.asText(null);
        return value == null || value.isBlank() ? null : Boolean.parseBoolean(value.trim());
    }

    private record SecurePort(Integer number, Boolean enabled) {
    }

    private static Map<String, String> metadata(JsonNode node) {
        if (node == null || !node.isObject()) return Map.of();
        Map<String, String> out = new LinkedHashMap<>();
        node.fields().forEachRemaining(e -> {
            if (!e.getValue().isNull()) out.put(e.getKey(), e.getValue().asText());
        });
        return out;
    }
}
