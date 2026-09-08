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

        // Cada insert va aislado: un evento con un skill borrado entre el encolado
        // y el flush (FK) no puede tumbar el resto del lote, y menos las missed
        // queries. Un evento perdido es aceptable; romper la telemetria no.
        int okUsage = 0;
        for (UsageRow r : u) {
            try {
                jdbc.update("""
                    INSERT INTO usage_events (api_key_id, user_id, team, skill_id, tool)
                    VALUES (:apiKeyId::uuid, :userId::uuid, :team, :skillId::uuid, :tool)
                    """, new MapSqlParameterSource()
                        .addValue("apiKeyId", r.apiKeyId())
                        .addValue("userId", r.userId())
                        .addValue("team", r.team())
                        .addValue("skillId", r.skillId())
                        .addValue("tool", r.tool()));
                okUsage++;
            } catch (RuntimeException err) {
                log.warn("[usage] evento descartado ({} sobre {}): {}", r.tool(), r.skillId(), err.getMessage());
            }
        }
        if (okUsage > 0) {
            try {
                rollupToday();
            } catch (RuntimeException err) {
                log.error("[usage] rollup fallo", err);
            }
        }
        for (MissedRow r : m) {
            try {
                jdbc.update(
                    "INSERT INTO missed_queries (query_text, stack) VALUES (:q, :stack)",
                    new MapSqlParameterSource().addValue("q", r.queryText()).addValue("stack", r.stack()));
            } catch (RuntimeException err) {
                log.warn("[usage] missed query descartada: {}", err.getMessage());
            }
        }
    }

    /**
     * Rollup del dia a usage_daily. La senal es "que tan canonica es la
     * convencion", asi que se filtra el ruido (decision 14 + revision):
     *
     *  - Solo get_skill / get_port_registry. Una busqueda que la roza no es
     *    "consultarla"; contar search_skills inflaba el numero.
     *  - Deduplicado por actor + dia: el mismo agente pidiendo la misma skill
     *    diez veces en un dia cuenta como 1, no como 10.
     *  - Sin las llamadas del equipo dueno sobre su propia skill: el owner
     *    corroborando su propia convencion no es senal de adopcion.
     *
     * Recalcula el dia entero en cada flush (idempotente por el ON CONFLICT).
     */
    private void rollupToday() {
        jdbc.getJdbcTemplate().execute("""
            INSERT INTO usage_daily (day, skill_id, team, hits, distinct_users)
            SELECT CURRENT_DATE, d.skill_id, d.team,
                   COUNT(*)::int,                     -- 1 fila por actor/skill/team, ya deduplicado
                   COUNT(DISTINCT d.actor)::int
            FROM (
              SELECT e.skill_id,
                     COALESCE(e.team, '') AS team,
                     COALESCE(e.user_id::text, e.api_key_id::text, 'anon') AS actor
              FROM usage_events e
              JOIN skills s ON s.id = e.skill_id
              WHERE e.skill_id IS NOT NULL
                AND e.created_at >= CURRENT_DATE
                AND e.tool IN ('get_skill', 'get_port_registry')
                AND (e.team IS NULL OR s.owner_team IS NULL OR e.team <> s.owner_team)
              GROUP BY e.skill_id, COALESCE(e.team, ''),
                       COALESCE(e.user_id::text, e.api_key_id::text, 'anon')
            ) d
            GROUP BY d.skill_id, d.team
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
