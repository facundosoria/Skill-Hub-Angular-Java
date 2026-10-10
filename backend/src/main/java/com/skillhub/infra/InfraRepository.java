package com.skillhub.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;

import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Persistence for the infra schema. Every statement is explicitly
 * schema-qualified ({@code infra.*}) so the existing {@code public} schema and
 * its search_path are never touched.
 */
@Repository
public class InfraRepository {

    public static final String SERVICE_LEVEL_INSTANCE = "_service";
    public static final String REGISTRY_SOURCE = "_registry";

    private final NamedParameterJdbcTemplate jdbc;

    public InfraRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ServiceStateRecord(
            String serviceName,
            InfraState state,
            String reason,
            Instant lastObservedAt,
            Instant lastHealthyAt,
            Instant lastRegistryLeaseAt,
            Instant observedSince,
            int consecutiveFailures,
            int consecutiveSuccesses,
            boolean sourceOk,
            Instant lastRegistryCheckAt,
            String coverage,
            int instances,
            Long uptimeSeconds,
            Integer latencyMs) {
    }

    public record ObservationRecord(
            String serviceName,
            String instanceKey,
            Instant observedAt,
            InfraState state,
            boolean healthy,
            RegistryState registryState,
            boolean sourceOk,
            String source,
            Long uptimeSeconds,
            Integer latencyMs,
            String coverage,
            String reason) {
    }

    public record TransitionRecord(
            String serviceName, InfraState fromState, InfraState toState, String reason, Instant occurredAt) {
    }

    public record FrontendNodeRecord(
            String nodeKey, String label, String hostname, Instant observedAt, Boolean onlineHint, String source) {
    }

    public void ensureCatalogue(List<InfraProperties.ServiceDefinition> catalogue) {
        if (catalogue == null || catalogue.isEmpty()) return;
        String sql = """
                INSERT INTO infra.service_catalog (service_name, display_name, eureka_app, sort_order)
                VALUES (:name, :display, :eurekaApp, :sortOrder)
                ON CONFLICT (service_name) DO UPDATE
                  SET display_name = EXCLUDED.display_name,
                      eureka_app = EXCLUDED.eureka_app,
                      sort_order = EXCLUDED.sort_order
                """;
        List<SqlParameterSource> params = new ArrayList<>();
        for (InfraProperties.ServiceDefinition def : catalogue) {
            String display = def.getName();
            String eurekaApp = def.getEurekaApp() == null || def.getEurekaApp().isBlank()
                    ? def.getName() : def.getEurekaApp();
            params.add(new MapSqlParameterSource()
                    .addValue("name", def.getName())
                    .addValue("display", display)
                    .addValue("eurekaApp", eurekaApp)
                    .addValue("sortOrder", def.getSortOrder()));
        }
        jdbc.batchUpdate(sql, params.toArray(new SqlParameterSource[0]));
    }

    public Map<String, ServiceStateRecord> loadStates() {
        String sql = """
                SELECT service_name, state, reason, last_observed_at, last_healthy_at,
                       last_registry_lease_at, observed_since, consecutive_failures,
                       consecutive_successes, source_ok, last_registry_check_at, coverage, instances,
                       uptime_seconds, latency_ms
                FROM infra.service_state
                """;
        Map<String, ServiceStateRecord> out = new HashMap<>();
        jdbc.query(sql, rs -> {
            Instant lastObserved = toInstant(rs.getObject("last_observed_at"));
            Instant lastHealthy = toInstant(rs.getObject("last_healthy_at"));
            Instant lastLease = toInstant(rs.getObject("last_registry_lease_at"));
            Instant observedSince = toInstant(rs.getObject("observed_since"));
            Instant lastCheck = toInstant(rs.getObject("last_registry_check_at"));
            ServiceStateRecord record = new ServiceStateRecord(
                    rs.getString("service_name"),
                    parseState(rs.getString("state")),
                    rs.getString("reason"),
                    lastObserved,
                    lastHealthy,
                    lastLease,
                    observedSince,
                    rs.getInt("consecutive_failures"),
                    rs.getInt("consecutive_successes"),
                    rs.getBoolean("source_ok"),
                    lastCheck,
                    rs.getString("coverage"),
                    rs.getInt("instances"),
                    (Long) rs.getObject("uptime_seconds"),
                    (Integer) rs.getObject("latency_ms"));
            out.put(record.serviceName(), record);
        });
        return out;
    }

    public void saveState(ServiceStateRecord row) {
        String sql = """
                INSERT INTO infra.service_state (service_name, state, reason, last_observed_at,
                    last_healthy_at, last_registry_lease_at, observed_since, consecutive_failures,
                    consecutive_successes, source_ok, last_registry_check_at, coverage, instances,
                    uptime_seconds, latency_ms, updated_at)
                VALUES (:serviceName, :state, :reason, :lastObservedAt, :lastHealthyAt,
                    :lastRegistryLeaseAt, :observedSince, :failures, :successes, :sourceOk,
                    :lastRegistryCheckAt, :coverage, :instances, :uptimeSeconds, :latencyMs, now())
                ON CONFLICT (service_name) DO UPDATE SET
                    state = EXCLUDED.state,
                    reason = EXCLUDED.reason,
                    last_observed_at = EXCLUDED.last_observed_at,
                    last_healthy_at = EXCLUDED.last_healthy_at,
                    last_registry_lease_at = EXCLUDED.last_registry_lease_at,
                    observed_since = EXCLUDED.observed_since,
                    consecutive_failures = EXCLUDED.consecutive_failures,
                    consecutive_successes = EXCLUDED.consecutive_successes,
                    source_ok = EXCLUDED.source_ok,
                    last_registry_check_at = EXCLUDED.last_registry_check_at,
                    coverage = EXCLUDED.coverage,
                    instances = EXCLUDED.instances,
                    uptime_seconds = EXCLUDED.uptime_seconds,
                    latency_ms = EXCLUDED.latency_ms,
                    updated_at = now()
                """;
        jdbc.update(sql, stateParams(row));
    }

    public void insertObservations(List<ObservationRecord> rows) {
        if (rows == null || rows.isEmpty()) return;
        String sql = """
                INSERT INTO infra.observation (service_name, instance_key, observed_at, state,
                    healthy, registry_state, source_ok, source, uptime_seconds, latency_ms, coverage, reason)
                VALUES (:serviceName, :instanceKey, :observedAt, :state, :healthy, :registryState,
                    :sourceOk, :source, :uptimeSeconds, :latencyMs, :coverage, :reason)
                """;
        List<SqlParameterSource> params = new ArrayList<>();
        for (ObservationRecord row : rows) {
            params.add(new MapSqlParameterSource()
                    .addValue("serviceName", row.serviceName())
                    .addValue("instanceKey", row.instanceKey())
                    .addValue("observedAt", ts(row.observedAt()), Types.TIMESTAMP_WITH_TIMEZONE)
                    .addValue("state", row.state() == null ? null : row.state().name())
                    .addValue("healthy", row.healthy())
                    .addValue("registryState", row.registryState() == null ? null : row.registryState().name())
                    .addValue("sourceOk", row.sourceOk())
                    .addValue("source", row.source())
                    .addValue("uptimeSeconds", row.uptimeSeconds())
                    .addValue("latencyMs", row.latencyMs())
                    .addValue("coverage", row.coverage())
                    .addValue("reason", row.reason()));
        }
        jdbc.batchUpdate(sql, params.toArray(new SqlParameterSource[0]));
    }

    public void insertTransition(TransitionRecord row) {
        jdbc.update("""
                INSERT INTO infra.state_transition (service_name, from_state, to_state, reason, occurred_at)
                VALUES (:serviceName, :fromState, :toState, :reason, :occurredAt)
                """, new MapSqlParameterSource()
                .addValue("serviceName", row.serviceName())
                .addValue("fromState", row.fromState() == null ? null : row.fromState().name())
                .addValue("toState", row.toState().name())
                .addValue("reason", row.reason())
                .addValue("occurredAt", ts(row.occurredAt()), Types.TIMESTAMP_WITH_TIMEZONE));
    }

    public List<AvailabilitySample> loadServiceSamples(Instant from, Instant to) {
        String sql = """
                SELECT service_name, observed_at, state
                FROM infra.observation
                WHERE instance_key = :instanceKey
                  AND observed_at >= :from AND observed_at <= :to
                ORDER BY service_name, observed_at
                """;
        return jdbc.query(sql, new MapSqlParameterSource()
                        .addValue("instanceKey", SERVICE_LEVEL_INSTANCE)
                        .addValue("from", ts(from), Types.TIMESTAMP_WITH_TIMEZONE)
                        .addValue("to", ts(to), Types.TIMESTAMP_WITH_TIMEZONE),
                (rs, rowNum) -> new AvailabilitySample(
                        rs.getString("service_name"),
                        toInstant(rs.getObject("observed_at")),
                        parseState(rs.getString("state"))));
    }

    public int purgeObservationsBefore(Instant cutoff) {
        return jdbc.update("DELETE FROM infra.observation WHERE observed_at < :cutoff",
                new MapSqlParameterSource().addValue("cutoff", ts(cutoff), Types.TIMESTAMP_WITH_TIMEZONE));
    }

    public int purgeTransitionsBefore(Instant cutoff) {
        return jdbc.update("DELETE FROM infra.state_transition WHERE occurred_at < :cutoff",
                new MapSqlParameterSource().addValue("cutoff", ts(cutoff), Types.TIMESTAMP_WITH_TIMEZONE));
    }

    public long countObservations() {
        Long count = jdbc.getJdbcTemplate().queryForObject(
                "SELECT count(*) FROM infra.observation", Long.class);
        return count == null ? 0 : count;
    }

    public void replaceFrontendNodes(List<FrontendNodeRecord> nodes) {
        JdbcTemplate plain = jdbc.getJdbcTemplate();
        plain.execute("DELETE FROM infra.frontend_node");
        if (nodes == null) return;
        for (FrontendNodeRecord node : nodes) {
            jdbc.update("""
                    INSERT INTO infra.frontend_node (node_key, label, hostname, observed_at, online_hint, source)
                    VALUES (:nodeKey, :label, :hostname, :observedAt, :onlineHint, :source)
                    """, new MapSqlParameterSource()
                    .addValue("nodeKey", node.nodeKey())
                    .addValue("label", node.label())
                    .addValue("hostname", node.hostname())
                    .addValue("observedAt", ts(node.observedAt()), Types.TIMESTAMP_WITH_TIMEZONE)
                    .addValue("onlineHint", node.onlineHint())
                    .addValue("source", node.source()));
        }
    }

    public List<FrontendNodeRecord> loadFrontendNodes() {
        return jdbc.query("""
                SELECT node_key, label, hostname, observed_at, online_hint, source
                FROM infra.frontend_node ORDER BY label, node_key
                """, (rs, rowNum) -> new FrontendNodeRecord(
                rs.getString("node_key"),
                rs.getString("label"),
                rs.getString("hostname"),
                toInstant(rs.getObject("observed_at")),
                (Boolean) rs.getObject("online_hint"),
                rs.getString("source")));
    }

    private MapSqlParameterSource stateParams(ServiceStateRecord row) {
        return new MapSqlParameterSource()
                .addValue("serviceName", row.serviceName())
                .addValue("state", row.state() == null ? null : row.state().name())
                .addValue("reason", row.reason())
                .addValue("lastObservedAt", ts(row.lastObservedAt()), Types.TIMESTAMP_WITH_TIMEZONE)
                .addValue("lastHealthyAt", ts(row.lastHealthyAt()), Types.TIMESTAMP_WITH_TIMEZONE)
                .addValue("lastRegistryLeaseAt", ts(row.lastRegistryLeaseAt()), Types.TIMESTAMP_WITH_TIMEZONE)
                .addValue("observedSince", ts(row.observedSince()), Types.TIMESTAMP_WITH_TIMEZONE)
                .addValue("failures", row.consecutiveFailures())
                .addValue("successes", row.consecutiveSuccesses())
                .addValue("sourceOk", row.sourceOk())
                .addValue("lastRegistryCheckAt", ts(row.lastRegistryCheckAt()), Types.TIMESTAMP_WITH_TIMEZONE)
                .addValue("coverage", row.coverage())
                .addValue("instances", row.instances())
                .addValue("uptimeSeconds", row.uptimeSeconds())
                .addValue("latencyMs", row.latencyMs());
    }

    static OffsetDateTime ts(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    static Instant toInstant(Object value) {
        if (value == null) return null;
        if (value instanceof OffsetDateTime odt) return odt.toInstant();
        if (value instanceof java.sql.Timestamp timestamp) return timestamp.toInstant();
        if (value instanceof Instant instant) return instant;
        return null;
    }

    static InfraState parseState(String value) {
        if (value == null) return null;
        try {
            return InfraState.valueOf(value);
        } catch (IllegalArgumentException e) {
            return InfraState.UNKNOWN;
        }
    }
}
