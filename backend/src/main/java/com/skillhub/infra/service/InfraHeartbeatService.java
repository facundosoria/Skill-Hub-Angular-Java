package com.skillhub.infra.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.infra.model.HeartbeatRequest;
import com.skillhub.infra.model.InfraOverviewDto;
import com.skillhub.infra.model.ServiceStatusDto;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class InfraHeartbeatService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper json;

    public InfraHeartbeatService(NamedParameterJdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record InfraStatus(List<ServiceStatusDto> services, InfraOverviewDto overview) {}

    public void recordHeartbeat(HeartbeatRequest req, String remoteIp) {
        Instant now = Instant.now();
        Instant startedAt = req.startedAt() != null
                ? req.startedAt()
                : now.minusSeconds(Math.max(0L, req.uptimeSeconds()));
        String details = writeDetails(req.details());

        jdbc.update("""
                INSERT INTO infra_service_heartbeats (
                    instance_id, service_id, node_name, status, version, uptime_seconds,
                    started_at, remote_ip, details, last_heartbeat_at
                ) VALUES (
                    :instanceId, :serviceId, :node, :status, :version, :uptimeSeconds,
                    :startedAt, :remoteIp, CAST(:details AS jsonb), now()
                )
                ON CONFLICT (instance_id) DO UPDATE SET
                    service_id = EXCLUDED.service_id,
                    node_name = EXCLUDED.node_name,
                    status = EXCLUDED.status,
                    version = EXCLUDED.version,
                    uptime_seconds = EXCLUDED.uptime_seconds,
                    started_at = EXCLUDED.started_at,
                    remote_ip = EXCLUDED.remote_ip,
                    details = EXCLUDED.details,
                    last_heartbeat_at = now()
                """, new MapSqlParameterSource()
                .addValue("instanceId", req.serviceId() + "@" + req.node())
                .addValue("serviceId", req.serviceId())
                .addValue("node", req.node())
                .addValue("status", req.status())
                .addValue("version", req.version())
                .addValue("uptimeSeconds", req.uptimeSeconds())
                .addValue("startedAt", Timestamp.from(startedAt))
                .addValue("remoteIp", remoteIp)
                .addValue("details", details));
    }

    public InfraStatus getInfraStatus() {
        Map<String, Availability> availabilityByService = jdbc.query("""
                SELECT service_id,
                       COUNT(*) FILTER (WHERE sampled_at >= now() - interval '24 hours') AS samples_24h,
                       COUNT(*) FILTER (WHERE sampled_at >= now() - interval '24 hours' AND status = 'OK') AS ok_24h,
                       COUNT(*) FILTER (WHERE sampled_at >= now() - interval '24 hours' AND status = 'DEGRADED') AS degraded_24h,
                       COUNT(*) AS samples_7d,
                       COUNT(*) FILTER (WHERE status = 'OK') AS ok_7d,
                       COUNT(*) FILTER (WHERE status = 'DEGRADED') AS degraded_7d
                FROM infra_service_status_samples
                WHERE sampled_at >= now() - interval '7 days'
                GROUP BY service_id
                """, (rs, rowNum) -> new Availability(
                rs.getString("service_id"), percentage(rs.getLong("ok_24h"), rs.getLong("samples_24h")),
                percentage(rs.getLong("degraded_24h"), rs.getLong("samples_24h")),
                percentage(rs.getLong("ok_7d"), rs.getLong("samples_7d")),
                percentage(rs.getLong("degraded_7d"), rs.getLong("samples_7d"))))
                .stream().collect(Collectors.toMap(Availability::serviceId, a -> a));
        List<ServiceStatusDto> services = jdbc.query("""
                SELECT s.id AS service_id, s.name, s.team, s.port,
                       h.instance_id, h.node_name, h.status AS reported_status,
                       h.uptime_seconds, h.last_heartbeat_at, h.version,
                       CASE WHEN h.instance_id IS NULL THEN false
                            ELSE h.last_heartbeat_at < now() - interval '60 seconds'
                       END AS timed_out
                FROM infra_services s
                LEFT JOIN infra_service_heartbeats h ON h.service_id = s.id
                ORDER BY s.id, h.last_heartbeat_at DESC NULLS LAST, h.instance_id
                """, (rs, rowNum) -> {
            String reportedStatus = rs.getString("reported_status");
            boolean hasHeartbeat = rs.getString("instance_id") != null;
            boolean timedOut = rs.getBoolean("timed_out");
            String status;
            String reason;
            if (!hasHeartbeat) {
                status = "UNKNOWN";
                reason = "absent_from_registry";
            } else if (timedOut) {
                status = "DOWN";
                reason = "timeout";
            } else if ("UP".equals(reportedStatus)) {
                status = "OK";
                reason = "healthy";
            } else {
                status = reportedStatus;
                reason = reportedStatus.toLowerCase();
            }

            Instant lastHeartbeatAt = hasHeartbeat
                    ? rs.getTimestamp("last_heartbeat_at").toInstant()
                    : null;
            long uptimeSeconds = rs.getLong("uptime_seconds");
            Long uptime = rs.wasNull() ? null : uptimeSeconds;
            Availability availability = availabilityByService.get(rs.getString("service_id"));
            return new ServiceStatusDto(
                    rs.getString("service_id"),
                    rs.getString("name"),
                    rs.getString("team"),
                    (Integer) rs.getObject("port"),
                    status,
                    reason,
                    rs.getString("node_name"),
                    uptime,
                    formatUptime(uptime),
                    lastHeartbeatAt,
                    formatLastSeen(lastHeartbeatAt),
                    rs.getString("version"),
                    availability == null ? null : availability.availability24h(),
                    availability == null ? null : availability.degraded24h(),
                    availability == null ? null : availability.availability7d(),
                    availability == null ? null : availability.degraded7d());
        });

        int ok = 0;
        int down = 0;
        int degraded = 0;
        int noData = 0;
        for (ServiceStatusDto service : services) {
            switch (service.status()) {
                case "OK" -> ok++;
                case "DOWN" -> down++;
                case "DEGRADED" -> degraded++;
                case "UNKNOWN" -> noData++;
                default -> { }
            }
        }

        InfraOverviewDto overview = new InfraOverviewDto(
                catalogServiceCount(), ok, down, degraded, noData, 0,
                "Registro de servicios", Instant.now());
        return new InfraStatus(List.copyOf(services), overview);
    }

    private static Double percentage(long count, long total) {
        return total == 0 ? null : count * 100.0 / total;
    }

    private record Availability(String serviceId, Double availability24h, Double degraded24h,
                                Double availability7d, Double degraded7d) {}

    private int catalogServiceCount() {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM infra_services", Map.of(), Integer.class);
        return count == null ? 0 : count;
    }

    private String writeDetails(Object details) {
        if (details == null) return null;
        try {
            return json.writeValueAsString(details);
        } catch (Exception e) {
            throw new IllegalStateException("No se pudieron serializar los detalles del heartbeat", e);
        }
    }

    private String formatUptime(Long uptimeSeconds) {
        if (uptimeSeconds == null) return "Sin dato";
        long seconds = Math.max(0L, uptimeSeconds);
        long days = seconds / 86_400;
        long hours = (seconds % 86_400) / 3_600;
        long minutes = (seconds % 3_600) / 60;
        if (days > 0) return hours > 0 ? days + "d " + hours + "h" : days + "d";
        if (hours > 0) return minutes > 0 ? hours + "h " + minutes + "m" : hours + "h";
        if (minutes > 0) return minutes + "m";
        return seconds + "s";
    }

    private String formatLastSeen(Instant lastHeartbeatAt) {
        if (lastHeartbeatAt == null) return "nunca";
        Duration elapsed = Duration.between(lastHeartbeatAt, Instant.now());
        long seconds = Math.max(0L, elapsed.getSeconds());
        if (seconds < 60) return "recién";
        long minutes = seconds / 60;
        if (minutes < 60) return "hace " + minutes + "m";
        long hours = minutes / 60;
        if (hours < 24) return "hace " + hours + "h";
        return "hace " + (hours / 24) + "d";
    }
}
