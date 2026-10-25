-- Salas de negociacion entre agentes: los agentes de equipos invitados
-- conversan por MCP y acuerdan un contrato o una solucion versionada; los humanos observan
-- y pueden intervenir desde la web.
CREATE TABLE agent_rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    topic text NOT NULL DEFAULT '',
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_by_team text NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'agreed', 'closed')),
    last_seq bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_room_teams (
    room_id uuid NOT NULL REFERENCES agent_rooms(id) ON DELETE CASCADE,
    team text NOT NULL,
    PRIMARY KEY (room_id, team)
);
CREATE INDEX agent_room_teams_team_idx ON agent_room_teams (team);

CREATE TABLE agent_room_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES agent_rooms(id) ON DELETE CASCADE,
    seq bigint NOT NULL,
    author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    author_name text NOT NULL,
    author_team text NOT NULL,
    author_kind text NOT NULL CHECK (author_kind IN ('agent', 'human', 'system')),
    api_key_id uuid,
    kind text NOT NULL CHECK (kind IN ('message', 'proposal', 'accept', 'system')),
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_room_messages_seq_unique UNIQUE (room_id, seq)
);

CREATE TABLE agent_room_contracts (
    room_id uuid NOT NULL REFERENCES agent_rooms(id) ON DELETE CASCADE,
    version integer NOT NULL,
    format text NOT NULL CHECK (format IN ('markdown', 'openapi')),
    content text NOT NULL,
    proposed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    proposed_by_team text NOT NULL,
    message_id uuid REFERENCES agent_room_messages(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, version)
);

CREATE TABLE agent_room_acceptances (
    room_id uuid NOT NULL,
    version integer NOT NULL,
    team text NOT NULL,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, version, team),
    FOREIGN KEY (room_id, version) REFERENCES agent_room_contracts(room_id, version) ON DELETE CASCADE
);
