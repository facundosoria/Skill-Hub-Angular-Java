#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${HYDRA_DB_PASSWORD:?HYDRA_DB_PASSWORD is required}"
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:=5432}"

until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
  sleep 1
done

# The password is passed as a psql variable so psql quotes it as a SQL
# literal. It is never included in SQL output or diagnostic messages.
psql -v ON_ERROR_STOP=1 -v hydra_password="$HYDRA_DB_PASSWORD" \
  -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hydra') THEN
    CREATE ROLE hydra LOGIN;
  END IF;
END
$$;
ALTER ROLE hydra LOGIN PASSWORD :'hydra_password';
SELECT 'CREATE DATABASE hydra OWNER hydra'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hydra')\gexec
ALTER DATABASE hydra OWNER TO hydra;
GRANT ALL PRIVILEGES ON DATABASE hydra TO hydra;
SQL
