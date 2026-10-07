CREATE TABLE infra_service_status_samples (
    id bigserial PRIMARY KEY,
    service_id text NOT NULL REFERENCES infra_services(id),
    sampled_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL CHECK (status IN ('OK','DEGRADED','DOWN','UNKNOWN'))
);

CREATE INDEX idx_infra_service_status_samples_service_sampled
    ON infra_service_status_samples (service_id, sampled_at);
