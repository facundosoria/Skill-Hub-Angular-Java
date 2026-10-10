# Infra monitoring (`app.infra`)

Read-only infrastructure monitoring for the Skill Hub microservice catalogue.
This document defines the honest semantics of every state and number the feature
exposes, plus what is intentionally pending.

The feature is **disabled by default** (`app.infra.enabled=false`). Skill Hub
starts, serves and behaves exactly as before without a registry or any network
call at startup.

## Sources

| Source | What it provides | Failure semantics |
|---|---|---|
| Service registry (Eureka, `app.infra.eureka-url`) | runtime instances, registry status, management metadata | a failed read is a **failed source**: every service is reported `UNKNOWN`, never a cascade of `DOWN` |
| Actuator probe (`/actuator/health`, `/actuator/prometheus`) | process health, `process_uptime_seconds` / `process_start_time_seconds` | a failed probe is limited coverage / `DEGRADED`, never `DOWN` without evidence |
| Tailscale API (optional) | frontend edge nodes | **pending**, see below |

The registry response distinguishes a *known absence* (the registry answered
successfully but a service is not registered → `UNKNOWN`, reason
`absent_from_registry`) from an *unreachable registry* (failed source →
`UNKNOWN`, reason `registry_unreachable`). They are not the same and are never
collapsed into `DOWN`.

## States

| State | Meaning |
|---|---|
| `UP` | registry reports UP **and** the actuator health probe succeeds within the latency threshold |
| `DOWN` | positive evidence of a process problem: registry reports DOWN/OUT_OF_SERVICE, or actuator health returns DOWN |
| `DEGRADED` | registry says UP but the actuator is slow, unreachable or has limited coverage; the process may still be serving, so this is not `DOWN` |
| `UNKNOWN` | known absence in a successful registry response, or the registry source failed |
| `NO_ACCESS` | the service was found but its probe destination is not approved by the allowlist or lacks management metadata |

`NO_ACCESS` is never reported as `DOWN` unless the registry itself carries
failure evidence. Hysteresis (`failure-threshold`, default 3, and
`recovery-threshold`, default 2) withholds a committed transition until the raw
state persists for that many consecutive cycles. `UNKNOWN`/`NO_ACCESS` commit
immediately and reset the counters.

## Availability and coverage

Availability is derived from persisted observation samples, not from a running
average:

- `availability = available-seconds / observed-seconds`
- `coverage = observed-seconds / window-seconds`
- `available` time is `UP` **or** `DEGRADED`. **Degraded contribution:** a
  degraded service is still serving, so it counts as available, and the
  degraded share is exposed separately as `degradedSeconds`. This is a
  deliberate, documented choice, not a silent 100%.
- A gap between two observations larger than `stale-observation-grace`
  (default 90 s) is **unobserved**: it contributes neither observed nor healthy
  seconds. A restart therefore never extends an old `UP` across the outage.
- With no history both `availability` and `coverage` are `null` (`hasData=false`):
  an unknown period is never reported as 100%.

`lastHealthyAt` records the last time the service was actually observed `UP`. It
is **retained** when the service fails. The last observed registry lease
(`lastRegistryLeaseAt`) is tracked separately from the process uptime.

Process uptime is distinct from availability and from observation history: it is
read from the Prometheus exposition (`process_uptime_seconds`, else derived from
`process_start_time_seconds`). No latency percentiles or histogram buckets are
invented.

## Security and privacy

- Probe destinations are derived from validated registry metadata (host +
  `management.port`) and must match the configured allowlist
  (`app.infra.allowed-schemes`, `allowed-hosts` with exact or `*.suffix`
  wildcards, `allowed-ports`). No user-provided probe URL exists.
- Redirects are disabled; a 3xx is surfaced and blocked.
- The public payload (`GET /api/infra/state`) contains only service names, a
  sanitized status/reason, availability/coverage, timestamps, when-known uptime
  and aggregate counters. It never contains mesh IPs, tailnet domains, internal
  endpoints, registry hosts/VIPs, management ports, tokens or raw metrics/log
  responses.
- Reads only touch the database; they never trigger a synchronous poll.

## Persistence and retention

Additive Flyway migration `V24__infra_monitoring.sql` creates a dedicated
`infra` schema (`service_catalog`, `service_state`, `observation`,
`state_transition`, `frontend_node`). It never touches the `public` schema or
`search_path`, and old migrations are untouched. Only compact derived rows are
stored — never a raw metrics response. Cleanup is bounded and configurable
(`app.infra.retention-days`, default 90) and deletes only `infra` rows.

## Configuration

All keys live under `app.infra` and are externally configurable: `enabled`,
`eureka-url`, `interval`, `connect-timeout`, `read-timeout`, `max-concurrency`,
`failure-threshold`, `recovery-threshold`, `degrade-latency`,
`stale-observation-grace`, `retention-days`, `availability-window24h`,
`availability-window7d`, `allowed-schemes`, `allowed-hosts`, `allowed-ports`,
`paths.health`, `paths.prometheus`, `catalogue`, and the `tailscale.*` block.

The default catalogue is the expected list, always visible even when absent from
the registry: `users-service`, `course-service`, `engine-challenge-service`,
`theoretical-challenge-service`, `practical-challenge-service`, `sandbox-service`,
`llm-service`, `accounting-service`, `market-service`, `roadmap-service`,
`notifications-service`, `backoffice-service`, `api-gateway`.

## Pending / excluded

- **Frontend node listing via Tailscale** is pending: it requires credentials
  and an agreed device/tag contract. The API reports an explicit
  `available=false` (`status=pending` when configured, `unavailable` otherwise)
  and **never simulates nodes**. No label is presented as a verified personal
  identity.
- Excluded until a later phase: the beacon script and ingestion, key
  distribution, local-front-through-tailscale-mesh changes, Kafka/MySQL/Redis/
  MinIO probes, production deploy/policy writes, and any change to Hydra/session
  or the existing catalogue behaviour.

## Isolated smoke

`pwsh ./scripts/infra-smoke.ps1` brings up a dedicated project
(`skillhub-infra-local`) with its own volume and loopback ports
(web `18089`, db `15433`, hydra `18445`, fixture `18090`), drives a fake
Eureka/actuator source through UP → failure → recovery and checks login,
unauthorized reads, the infra view and the existing catalogue. It tears down
only its own project. `-Keep` leaves it running; clean up with
`docker compose -p skillhub-infra-local down -v`.
