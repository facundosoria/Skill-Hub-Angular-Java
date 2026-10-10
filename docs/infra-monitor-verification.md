# Infra monitoring — verification report

Worktree: `C:/Users/kron/orca/workspaces/skillhub/feature-infra-monitor`
Branch: `feature/infra-monitor`
HEAD at verification: `56f706d48d35275eea1a57050b2a245013ef5cd2` (unchanged; all
changes left uncommitted as required).

No `git add`, `commit`, `push`, `checkout`, `stash`, `restore` or PR was run.

## Changed files

Modified (5):
- `backend/src/main/resources/application.yml`
- `frontend/src/app/app.routes.ts`
- `frontend/src/app/core/i18n/en.ts`
- `frontend/src/app/core/i18n/es.ts`
- `frontend/src/app/layout/shell.ts`

New (13 paths):
- `backend/src/main/java/com/skillhub/infra/` (14 classes)
- `backend/src/main/resources/db/migration/V24__infra_monitoring.sql`
- `backend/src/test/java/com/skillhub/infra/` (9 test classes)
- `frontend/src/app/core/infra.ts`
- `frontend/src/app/features/infra/` (`infra.ts`, `infra.spec.ts`)
- `docker-compose.infra-smoke.yml`
- `e2e/infra/fixture.mjs`
- `scripts/infra-smoke.ps1`
- `docs/infra-monitor.md`, `docs/infra-monitor-verification.md`

`git status --porcelain` count: 13 entries.

## Baseline (before any change)

| Command | Result |
|---|---|
| `mvn -q -f backend/pom.xml test` | exit 0 |
| `npm ci` (frontend) | exit 0 |
| `npm run build` (frontend) | exit 0 |
| `npm test` (frontend) | exit 1 — **4 pre-existing failures** in `depmap` (`dep-map-graph.spec.ts` 2, `dep-map.spec.ts` 2); 9 files / 67 tests, 63 passed |

The 4 depmap failures predate this work and were left untouched (out of scope).

## RED → GREEN evidence

Genuine failing runs were observed and fixed:

1. Frontend build RED: `TS2300 Duplicate identifier 'state'` and
   `TS2349 not callable` (`core/infra.ts`, `features/infra/infra.ts`) → renamed
   the service-status interface; build then GREEN (exit 0).
2. Integration RED (`mvn test -Dtest=InfraMigrationTest,InfraDisabledIntegrationTest,InfraIntegrationTest`,
   13 tests, 2 failures + 1 error):
   - `cleanDatabaseAppliesAllMigrationsIncludingInfra` expected 24 migrations, was 25.
   - `failureThenRecoveryRespectsThresholdsAndPreservesLastHealthy` expected DOWN, was UP
     (registry DOWN but actuator still UP, plus `lastHealthyAt` advanced on a
     withheld UP).
   - `retentionPurgesObservationsOlderThanConfiguredDays` errored (named param
     passed to a positional update).
   Fixes: correct migration count; test drives the actuator DOWN too; `lastHealthyAt`
   now advances only on an actually observed `UP` (not the hysteresis-committed
   state); positional JDBC update. GREEN after the fixes.
3. Smoke RED: the PowerShell `docker compose` arg splatting was wrong (compose
   printed usage, then web-health timed out) → fixed the arg array; the second run
   reached `SMOKE PASS` (exit 0).

Note: the pure parsers/calculators (`PrometheusParser`, `EurekaParser`,
`ProbeTargetResolver`, `AvailabilityCalculator`, `StateMachine`) were implemented
first and their unit tests confirmed GREEN; the genuine RED→GREEN cycles above
cover the integration, build and smoke layers.

## Final verification (after all changes)

| Command | Result |
|---|---|
| `mvn -o -f backend/pom.xml test -Dtest=<infra unit tests>` | exit 0 — 40 tests, 0 failures |
| `mvn -o -f backend/pom.xml test -Dtest=InfraMigrationTest,InfraDisabledIntegrationTest,InfraIntegrationTest` | exit 0 — 13 tests, 0 failures |
| `mvn -o -f backend/pom.xml test` (full suite) | exit 0 — **172 tests, 0 failures** (baseline suite included, no regressions) |
| `npm run build` (frontend) | exit 0 |
| `npm test` (frontend) | exit 1 — 71 tests, 4 failures, **all 4 are the same pre-existing depmap failures**; 10 files, 8 passed, 2 failed (the new `infra.spec.ts` passes) |
| `pwsh ./scripts/infra-smoke.ps1` | exit 0 — `SMOKE PASS` |

Backend test classes added: `PrometheusParserTest` (5), `ProbeTargetResolverTest`
(8), `EurekaParserTest` (4), `AvailabilityCalculatorTest` (6), `StateMachineTest`
(4), `EurekaRegistryClientTest` (5, local `HttpServer`), `ActuatorProbeTest`
(8, local `HttpServer`), `InfraIntegrationTest` (9, Testcontainers),
`InfraMigrationTest` (2, Testcontainers), `InfraDisabledIntegrationTest`
(2, Testcontainers).

Coverage exercised: clean + pre-feature (V23) migration with existing data
retained; disabled feature with the existing app unaffected; auth negative (401);
privacy payload assertions; discovery; singleton/list replicas; disappearance vs
failed registry; actuator timeout → DEGRADED; recovery thresholds; missing
management metadata; Prometheus uptime parsing; SSRF rejection and redirect
safety; gaps/restart coverage; availability math; `lastHealthyAt` preserved;
retention purge.

## Isolated local smoke

- Compose project: `skillhub-infra-local` (additive overlay
  `docker-compose.infra-smoke.yml`; the production/local `docker-compose.yml`
  behaviour is unchanged).
- Ports: web `http://localhost:18089`, db `127.0.0.1:15433` (own volume
  `skillhub-infra-local_infra_smoke_pgdata`), hydra `127.0.0.1:18445`, source
  fixture `http://localhost:18090`.
- Verified over the public web origin: `/api/infra/state` without session → 401;
  first-user registration/login; authenticated infra view listing the 13 expected
  services; existing `GET /api/skills`; fake source UP → DOWN (threshold 2) → UP.
- Hydra local dependencies were preserved (full base compose incl. hydra,
  hydra-migrate, hydra-keys). No production/raspi script or production DB was used.
- Cleanup: the script tears down only its own project (`down -v`); verified no
  leftover `skillhub-infra-local` containers or `infra_smoke` volumes remain.

## Data sources tested vs still needing real network/credentials

Tested with fixtures: Eureka JSON (singleton and list, replicas, DOWN, absent,
HTTP 500, redirect, unreachable), actuator health/prometheus (UP/DOWN/slow/
unreachable/redirect), SSRF allowlist. Tested against a real Postgres 16
(Testcontainers) and a real Postgres + Caddy + Hydra stack (smoke).

Still requiring real network/credentials: a live Eureka registry with real
management metadata, real actuator endpoints of the 13 micros, and the Tailscale
API (pending by design). No real telemetry was hardcoded or fabricated.

## Pending blockers / limitations

- Tailscale frontend-node listing is deliberately **pending** (needs credentials
  and an agreed device/tag contract); the API reports `available=false` and never
  simulates nodes. No build/commit data is shown without a beacon.
- Long-term availability is computed from persisted compact observations; an
  hourly rollup is a possible future optimization but is not required by the
  current scale.
- Frontend `npm test` still exits non-zero due to the 4 pre-existing depmap
  failures (documented, not weakened or skipped).

## Secrets

The smoke generates ephemeral random secrets into a temp env file and deletes
it; no secret is written to this report or to any committed file.
