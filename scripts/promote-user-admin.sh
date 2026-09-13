#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
compose_file="${COMPOSE_FILE:-${project_dir}/docker-compose.yml}"

if [[ ! -f "$compose_file" ]]; then
  echo "No se encontro el archivo Docker Compose: $compose_file" >&2
  echo "Podes indicar otro mediante COMPOSE_FILE=/ruta/compose.yml" >&2
  exit 1
fi

if [[ $# -gt 1 ]]; then
  echo "Uso: $0 [usuario]" >&2
  exit 1
fi

target_username="${1:-}"
if [[ -z "$target_username" ]]; then
  read -r -p "Usuario al que queres dar permisos de admin: " target_username
fi

if [[ -z "$target_username" ]]; then
  echo "El usuario no puede estar vacio." >&2
  exit 1
fi

docker compose -f "$compose_file" exec -T db sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v "target_username=$1"' \
  sh "$target_username" <<'SQL'
SELECT EXISTS (
  SELECT 1
  FROM users
  WHERE lower(username) = lower(:'target_username')
) AS user_exists \gset

\if :user_exists
UPDATE users
SET role = 'admin'::role,
    status = 'active'::account_status
WHERE lower(username) = lower(:'target_username')
RETURNING username, role, status;
\else
\echo 'No se encontro el usuario:' :target_username
\quit 3
\endif
SQL
