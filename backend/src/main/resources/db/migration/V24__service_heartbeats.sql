CREATE TABLE infra_services (
    id text PRIMARY KEY,
    name text NOT NULL,
    team text NOT NULL,
    port integer
);

INSERT INTO infra_services (id, name, team, port) VALUES ('users-service', 'Users Service', 'Users', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('course-service', 'Course Service', 'Courses', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('llm-service', 'LLM Service', 'AI', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('theoretical-challenge-service', 'Theoretical Challenge Service', 'Theoretical Challenges', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('accounting-service', 'Accounting Service', 'Accounting', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('sandbox-service', 'Sandbox Service', 'Sandbox', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('practical-challenge-service', 'Practical Challenge Service', 'Practical Challenges', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('engine-challenge-service', 'Challenge Engine Service', 'Challenge Engine', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('roadmap-service', 'Roadmap Service', 'Roadmap', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('notification-service', 'Notification Service', 'Notifications', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('market-service', 'Market Service', 'Market', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('backoffice-service', 'Backoffice Service', 'Backoffice', NULL);
INSERT INTO infra_services (id, name, team, port) VALUES ('gateway', 'Gateway', 'Platform', 8080);

CREATE TABLE infra_service_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id text REFERENCES infra_services(id),
    name text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    token_prefix text NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE infra_service_heartbeats (
    instance_id text PRIMARY KEY,
    service_id text NOT NULL REFERENCES infra_services(id),
    node_name text NOT NULL,
    status text NOT NULL CHECK (status IN ('UP','DEGRADED','DOWN')),
    version text,
    uptime_seconds bigint NOT NULL,
    started_at timestamptz NOT NULL,
    remote_ip text,
    details jsonb,
    last_heartbeat_at timestamptz NOT NULL
);
