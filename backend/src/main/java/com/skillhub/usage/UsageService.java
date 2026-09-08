package com.skillhub.usage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Puerto de src/server/usage.ts (decision 14).
 *
 * Contrato innegociable: record es sincrono, no bloquea y NUNCA tira. Si la cola
 * se llena, se descartan eventos. La telemetria no puede tirar abajo la
 * funcionalidad que mide.
 *
 * En Next era una cola en memoria + setInterval sobre el proceso Node de larga
 * vida. Aca es una ConcurrentLinkedQueue acotada + @Scheduled cada 5s.
 */
@Service
public class UsageService {

    private static final Logger log = LoggerFactory.getLogger(UsageService.class);
    private static final int MAX_QUEUE = 5_000;
    private static final int MAX_QUERY_LEN = 300;

    public record UsageRow(String apiKeyId, String userId, String team, String skillId, String tool) {}
    public record MissedRow(String queryText, String stack) {}

    private final ConcurrentLinkedQueue<UsageRow> usage = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<MissedRow> missed = new ConcurrentLinkedQueue<>();
    private final AtomicInteger usageSize = new AtomicInteger();
    private final AtomicInteger missedSize = new AtomicInteger();
    private final AtomicInteger dropped = new AtomicInteger();

    private final NamedParameterJdbcTemplate jdbc;

    public UsageService(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void recordUsage(UsageRow row) {
        if (usageSize.get() >= MAX_QUEUE) { dropped.incrementAndGet(); return; }
        usage.add(row);
        usageSize.incrementAndGet();
    }

    public void recordMissedQuery(String queryText, String stack) {
        if (missedSize.get() >= MAX_QUEUE) { dropped.incrementAndGet(); return; }
        String truncated = queryText.length() > MAX_QUERY_LEN
                ? queryText.substring(0, MAX_QUERY_LEN) : queryText;
        missed.add(new MissedRow(truncated, stack));
        missedSize.incrementAndGet();
    }

    @Scheduled(fixedRate = 5_000)
    public void flush() {
        List<UsageRow> u = drain(usage, usageSize);
        List<MissedRow> m = drain(missed, missedSize);
        int d = dropped.getAndSet(0);
        if (d > 0) log.warn("[usage] {} eventos descartados por cola llena", d);
        if (u.isEmpty() && m.isEmpty()) return;

        try {
            if (!u.isEmpty()) {
                for (UsageRow r : u) {
                    jdbc.update("""
                        INSERT INTO usage_events (api_key_id, user_id, team, skill_id, tool)
                        VALUES (:apiKeyId::uuid, :userId::uuid, :team, :skillId::uuid, :tool)
                        """, new MapSqlParameterSource()
                            .addValue("apiKeyId", r.apiKeyId())
                            .addValue("userId", r.userId())
                            .addValue("team", r.team())
                            .addValue("skillId", r.skillId())
                            .addValue("tool", r.tool()));
                }
                rollupToday();
            }
            if (!m.isEmpty()) {
                for (MissedRow r : m) {
                    jdbc.update(
                        "INSERT INTO missed_queries (query_text, stack) VALUES (:q, :stack)",
                        new MapSqlParameterSource().addValue("q", r.queryText()).addValue("stack", r.stack()));
                }
            }
        } catch (RuntimeException err) {
            // Se pierde el lote a proposito: reintentar aca haria crecer la cola
            // hasta matar el proceso por un problema que no es nuestro.
            log.error("[usage] flush fallo, lote descartado", err);
        }
    }

    private void rollupToday() {
        jdbc.getJdbcTemplate().execute("""
            INSERT INTO usage_daily (day, skill_id, team, hits, distinct_users)
            SELECT CURRENT_DATE, skill_id, COALESCE(team, ''),
                   COUNT(*)::int, COUNT(DISTINCT user_id)::int
            FROM usage_events
            WHERE skill_id IS NOT NULL AND created_at >= CURRENT_DATE
            GROUP BY skill_id, COALESCE(team, '')
            ON CONFLICT (day, skill_id, team) DO UPDATE
              SET hits = EXCLUDED.hits, distinct_users = EXCLUDED.distinct_users
            """);
    }

    private static <T> List<T> drain(ConcurrentLinkedQueue<T> q, AtomicInteger size) {
        List<T> out = new ArrayList<>();
        T item;
        while ((item = q.poll()) != null) { out.add(item); size.decrementAndGet(); }
        return out;
    }
}
