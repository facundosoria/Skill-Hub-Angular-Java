package com.skillhub.infra.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Component
public class TailscaleClient {
    private final RestClient rest;
    private final String apiToken;
    private final String tailnet;

    @Autowired
    public TailscaleClient(@Value("${app.tailscale.api-token}") String apiToken,
                           @Value("${app.tailscale.tailnet}") String tailnet) {
        this("https://api.tailscale.com/api/v2", apiToken, tailnet);
    }

    /** Constructor for tests using a local HTTP server. */
    protected TailscaleClient(String baseUrl, String apiToken, String tailnet) {
        this.rest = RestClient.builder().baseUrl(baseUrl).build();
        this.apiToken = apiToken;
        this.tailnet = tailnet;
    }

    public boolean isConfigured() {
        return apiToken != null && !apiToken.isBlank() && tailnet != null && !tailnet.isBlank();
    }

    public List<TailscaleDevice> listDevices() {
        if (!isConfigured()) return List.of();
        JsonNode response = rest.get()
                .uri(uriBuilder -> uriBuilder.path("/tailnet/{tailnet}/devices")
                        .queryParam("fields", "all").build(tailnet))
                .header("Authorization", "Bearer " + apiToken)
                .retrieve().body(JsonNode.class);
        if (response == null || !response.path("devices").isArray()) return List.of();
        List<TailscaleDevice> devices = new ArrayList<>();
        for (JsonNode device : response.path("devices")) {
            List<String> tags = new ArrayList<>();
            if (device.path("tags").isArray()) device.path("tags").forEach(tag -> tags.add(tag.asText()));
            String seen = device.path("lastSeen").asText(null);
            devices.add(new TailscaleDevice(device.path("id").asText(), device.path("hostname").asText(),
                    List.copyOf(tags), seen == null || seen.isBlank() ? null : Instant.parse(seen)));
        }
        return List.copyOf(devices);
    }

    public record TailscaleDevice(String id, String hostname, List<String> tags, Instant lastSeen) {}
}
