-- Infra monitoring (feature: infra-monitor). Additive only.
--
-- Creates a dedicated `infra` schema and its own tables. It never touches the
-- existing `public` tables and never changes `search_path`, so the rest of the
-- application keeps working exactly as before. All access from application code
-- is explicitly schema-qualified (`infra.*`).
--
-- Honest source semantics:
--   * observation.state is the state we actually observed for one registry
--     instance in one cycle: UP, DOWN, DEGRADED, UNKNOWN or NO_ACCESS.
--   * observation.registry_state is what the registry (Eureka) reported for
--     that instance (UP / DOWN / OUT_OF_SERVICE / UNKNOWN). It is kept apart
--     from the process state so a failed registry source never masquerades as
--     a process DOWN.
--   * When the registry itself is unreachable we persist one observation per
--     configured service with state = UNKNOWN and source_ok = false; it is a
--     failed source, not a cascade of DOWNs.
--   * Availability is derived from consecutive observations (healthy duration
--     over observed duration) and gaps beyond the configured grace are treated
--     as unobserved, so a restart never extends an old UP across an outage.

CREATE SCHEMA IF NOT EXISTS infra;

-- Catalogue declared by configuration. Persisted so the UI can always list the
-- expected services and so historical observations keep a stable key even if a
-- service disappears from the registry.
CREATE TABLE infra.service_catalog (
    service_name    text PRIMARY KEY,
    display_name    text NOT NULL,
    eureka_app      text,
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Current aggregate state per service (single row per service).
CREATE TABLE infra.service_state (
    service_name           text PRIMARY KEY,
    state                  text NOT NULL,
    reason                 text,
    last_observed_at       timestamptz,
    last_healthy_at        timestamptz,
    last_registry_lease_at timestamptz,
    observed_since         timestamptz,
    consecutive_failures   integer NOT NULL DEFAULT 0,
    consecutive_successes  integer NOT NULL DEFAULT 0,
    source_ok              boolean NOT NULL DEFAULT false,
    last_registry_check_at timestamptz,
    coverage               text,
    instances              integer NOT NULL DEFAULT 0,
    uptime_seconds         bigint,
    latency_ms             integer,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- One compact row per (service, instance) per cycle. No raw metrics body is
-- ever stored: only the derived state, the parsed uptime (when known) and the
-- seeds needed to compute availability.
CREATE TABLE infra.observation (
    id             bigserial PRIMARY KEY,
    service_name   text NOT NULL,
    instance_key   text NOT NULL,
    observed_at    timestamptz NOT NULL,
    state          text NOT NULL,
    healthy        boolean NOT NULL,
    registry_state text,
    source_ok      boolean NOT NULL DEFAULT true,
    source         text NOT NULL,
    uptime_seconds bigint,
    latency_ms     integer,
    coverage       text,
    reason         text
);
CREATE INDEX infra_observation_service_time_idx ON infra.observation(service_name, observed_at);
CREATE INDEX infra_observation_time_idx ON infra.observation(observed_at);

-- Status transitions, append-only.
CREATE TABLE infra.state_transition (
    id           bigserial PRIMARY KEY,
    service_name text NOT NULL,
    from_state   text,
    to_state     text NOT NULL,
    reason       text,
    occurred_at  timestamptz NOT NULL
);
CREATE INDEX infra_state_transition_service_time_idx
    ON infra.state_transition(service_name, occurred_at);

-- Optional frontend-edge nodes discovered through the Tailscale API. Kept
-- separate from the micro service catalogue because it is a different source
-- with different guarantees (labels are a group tag, never a verified identity).
CREATE TABLE infra.frontend_node (
    node_key        text PRIMARY KEY,
    label           text NOT NULL,
    hostname        text,
    observed_at     timestamptz NOT NULL,
    online_hint     boolean,
    source          text NOT NULL
);
