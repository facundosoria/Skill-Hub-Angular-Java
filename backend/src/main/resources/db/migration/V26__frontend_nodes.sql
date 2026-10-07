CREATE TABLE frontend_nodes (
    tailscale_device_id text PRIMARY KEY,
    hostname text NOT NULL,
    parsed_group text,
    parsed_name text,
    identity_declared boolean NOT NULL DEFAULT false,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    last_status text NOT NULL CHECK (last_status IN ('ONLINE','OFFLINE')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
