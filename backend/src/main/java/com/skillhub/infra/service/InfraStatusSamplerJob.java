package com.skillhub.infra.service;

import com.skillhub.infra.model.ServiceStatusDto;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class InfraStatusSamplerJob {

    private final InfraHeartbeatService heartbeatService;
    private final NamedParameterJdbcTemplate jdbc;

    public InfraStatusSamplerJob(InfraHeartbeatService heartbeatService, NamedParameterJdbcTemplate jdbc) {
        this.heartbeatService = heartbeatService;
        this.jdbc = jdbc;
    }

    @Scheduled(fixedRate = 60_000)
    public void sample() {
        Map<String, String> statusByService = new LinkedHashMap<>();
        for (ServiceStatusDto instance : heartbeatService.getInfraStatus().services()) {
            statusByService.merge(instance.serviceId(), instance.status(), InfraStatusSamplerJob::aggregate);
        }
        for (Map.Entry<String, String> sample : statusByService.entrySet()) {
            jdbc.update("""
                    INSERT INTO infra_service_status_samples (service_id, status)
                    VALUES (:serviceId, :status)
                    """, new MapSqlParameterSource()
                    .addValue("serviceId", sample.getKey())
                    .addValue("status", sample.getValue()));
        }
        jdbc.update("DELETE FROM infra_service_status_samples WHERE sampled_at < now() - interval '8 days'",
                new MapSqlParameterSource());
    }

    private static String aggregate(String current, String next) {
        if ("OK".equals(current) || "OK".equals(next)) return "OK";
        if ("DEGRADED".equals(current) || "DEGRADED".equals(next)) return "DEGRADED";
        if ("DOWN".equals(current) || "DOWN".equals(next)) return "DOWN";
        return "UNKNOWN";
    }
}
