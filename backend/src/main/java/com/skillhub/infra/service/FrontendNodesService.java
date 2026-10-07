package com.skillhub.infra.service;

import com.skillhub.infra.model.FrontendNodeDto;
import com.skillhub.infra.model.FrontendNodesStatusDto;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class FrontendNodesService {
    private static final System.Logger LOG = System.getLogger(FrontendNodesService.class.getName());
    private static final String FRONTEND_TAG = "tag:frontend-edge";
    private static final Pattern HOSTNAME_PATTERN = Pattern.compile("^group-(\\d{2})-frontend-(.+)$");
    private static final String UPSERT = """
            INSERT INTO frontend_nodes (tailscale_device_id, hostname, parsed_group, parsed_name,
                identity_declared, last_seen_at, last_status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, now())
            ON CONFLICT (tailscale_device_id) DO UPDATE SET
                hostname = EXCLUDED.hostname, parsed_group = EXCLUDED.parsed_group,
                parsed_name = EXCLUDED.parsed_name, identity_declared = EXCLUDED.identity_declared,
                last_seen_at = EXCLUDED.last_seen_at, last_status = EXCLUDED.last_status,
                updated_at = now()
            """;

    private final JdbcTemplate jdbc;
    private final TailscaleClient tailscaleClient;
    private final boolean configured;

    public FrontendNodesService(JdbcTemplate jdbc, TailscaleClient tailscaleClient,
                                @Value("${app.tailscale.api-token:}") String apiToken,
                                @Value("${app.tailscale.tailnet:}") String tailnet) {
        this.jdbc = jdbc;
        this.tailscaleClient = tailscaleClient;
        this.configured = apiToken != null && !apiToken.isBlank() && tailnet != null && !tailnet.isBlank();
    }

    public void syncFromTailscale() {
        if (!configured) {
            LOG.log(System.Logger.Level.INFO, "Sync de nodos frontend omitida: Tailscale no configurado");
            return;
        }
        final List<TailscaleClient.TailscaleDevice> devices;
        try {
            devices = tailscaleClient.listDevices();
        } catch (Exception e) {
            LOG.log(System.Logger.Level.WARNING, "No se pudo sincronizar nodos frontend desde Tailscale: {0}", e.toString());
            return;
        }

        Instant now = Instant.now();
        List<TailscaleClient.TailscaleDevice> frontendDevices = devices.stream()
                .filter(device -> device.tags() != null && device.tags().contains(FRONTEND_TAG))
                .toList();
        for (TailscaleClient.TailscaleDevice device : frontendDevices) {
            Matcher matcher = HOSTNAME_PATTERN.matcher(device.hostname() == null ? "" : device.hostname());
            String parsedGroup = matcher.matches() ? matcher.group(1) : null;
            String parsedName = matcher.matches() ? matcher.group(2) : null;
            boolean declared = parsedGroup != null;
            Instant lastSeen = device.lastSeen() == null ? now : device.lastSeen();
            String status = Duration.between(lastSeen, now).compareTo(Duration.ofMinutes(5)) <= 0
                    ? "ONLINE" : "OFFLINE";
            jdbc.update(UPSERT, device.id(), device.hostname(), parsedGroup, parsedName,
                    declared, Timestamp.from(lastSeen), status);
        }
        if (frontendDevices.isEmpty()) {
            jdbc.update("UPDATE frontend_nodes SET last_status = 'OFFLINE', updated_at = now()");
        } else {
            List<String> ids = frontendDevices.stream().map(TailscaleClient.TailscaleDevice::id).toList();
            String placeholders = ids.stream().map(id -> "?").collect(Collectors.joining(","));
            jdbc.update("UPDATE frontend_nodes SET last_status = 'OFFLINE', updated_at = now() WHERE tailscale_device_id NOT IN ("
                    + placeholders + ")", ids.toArray());
        }
    }

    public FrontendNodesStatusDto getFrontendNodesStatus() {
        Instant lastSync = jdbc.queryForObject("SELECT max(updated_at) FROM frontend_nodes", (rs, rowNum) -> {
            Timestamp value = rs.getTimestamp(1);
            return value == null ? null : value.toInstant();
        });
        List<FrontendNodeDto> nodes = jdbc.query("""
                SELECT hostname, parsed_group, parsed_name, identity_declared, last_status,
                       last_seen_at, first_seen_at
                FROM frontend_nodes ORDER BY hostname
                """, (rs, rowNum) -> new FrontendNodeDto(
                rs.getString("hostname"), rs.getString("parsed_group"), rs.getString("parsed_name"),
                rs.getBoolean("identity_declared"), rs.getString("last_status"),
                formatRelative(rs.getTimestamp("last_seen_at").toInstant()),
                formatRelative(rs.getTimestamp("first_seen_at").toInstant())));
        return new FrontendNodesStatusDto(configured, configured ? "tailscale_api" : "no_configurado",
                lastSync, List.copyOf(nodes));
    }

    private static String formatRelative(Instant timestamp) {
        if (timestamp == null) return "nunca";
        long seconds = Math.max(0L, Duration.between(timestamp, Instant.now()).getSeconds());
        if (seconds < 60) return "recién";
        long minutes = seconds / 60;
        if (minutes < 60) return "hace " + minutes + "m";
        long hours = minutes / 60;
        if (hours < 24) return "hace " + hours + "h";
        return "hace " + (hours / 24) + "d";
    }
}
