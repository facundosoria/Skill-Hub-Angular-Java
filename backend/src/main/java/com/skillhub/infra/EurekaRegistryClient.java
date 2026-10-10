package com.skillhub.infra;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.Instant;

/**
 * Reads the Eureka registry. A failed read is returned as a failed source
 * ({@code sourceOk=false}) with a short sanitized reason; it is never turned
 * into per-service DOWN observations by this class.
 */
@Component
public class EurekaRegistryClient {

    private final HttpProbeClient http;
    private final InfraProperties properties;
    private final ObjectMapper mapper;

    public EurekaRegistryClient(HttpProbeClient http, InfraProperties properties, ObjectMapper mapper) {
        this.http = http;
        this.properties = properties;
        this.mapper = mapper;
    }

    public RegistrySnapshot fetch(Instant now) {
        String base = properties.getEurekaUrl();
        if (base == null || base.isBlank()) {
            return RegistrySnapshot.failed(now, "registry_unconfigured");
        }
        URI uri;
        try {
            uri = URI.create(trimTrailingSlash(base.trim()) + "/apps");
        } catch (IllegalArgumentException e) {
            return RegistrySnapshot.failed(now, "registry_url_invalid");
        }
        try {
            HttpProbeClient.Response response = http.get(uri);
            if (response.redirect()) return RegistrySnapshot.failed(now, "registry_redirect_blocked");
            if (!response.ok()) return RegistrySnapshot.failed(now, "registry_unavailable");
            var root = mapper.readTree(response.body() == null || response.body().isBlank() ? "{}" : response.body());
            return new RegistrySnapshot(true, null, now, EurekaParser.parse(root));
        } catch (HttpProbeClient.ProbeException e) {
            return RegistrySnapshot.failed(now, "registry_unreachable");
        } catch (Exception e) {
            return RegistrySnapshot.failed(now, "registry_parse_error");
        }
    }

    private static String trimTrailingSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }
}
