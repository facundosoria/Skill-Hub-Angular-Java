#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
compose_file="${COMPOSE_FILE:-${project_dir}/docker-compose.yml}"
env_file="${ENV_FILE:-${project_dir}/.env}"

if [[ ! -f "$compose_file" ]]; then
  echo "No se encontro el archivo Docker Compose: $compose_file" >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "No se encontro el archivo de entorno: $env_file" >&2
  exit 1
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")

"${compose[@]}" config --quiet

db_id="$("${compose[@]}" ps -q db)"
if [[ -z "$db_id" ]] || [[ "$(docker inspect --format '{{.State.Running}}' "$db_id")" != "true" ]]; then
  echo "La base de datos no esta ejecutandose. Se cancela sin modificar contenedores." >&2
  exit 1
fi

echo "Construyendo las imagenes de backend y frontend..."
"${compose[@]}" build --pull backend web

echo "Recreando solamente el backend..."
"${compose[@]}" up -d --no-deps --force-recreate backend

backend_healthy=false
for _ in {1..60}; do
  backend_id="$("${compose[@]}" ps -q backend)"
  if [[ -z "$backend_id" ]]; then
    break
  fi

  backend_state="$(docker inspect --format '{{.State.Status}}' "$backend_id")"
  backend_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$backend_id")"

  if [[ "$backend_health" == "healthy" ]]; then
    backend_healthy=true
    break
  fi

  if [[ "$backend_state" == "exited" ]] || [[ "$backend_state" == "dead" ]]; then
    break
  fi

  sleep 2
done

if [[ "$backend_healthy" != "true" ]]; then
  echo "El backend no quedo saludable. El frontend no sera recreado." >&2
  "${compose[@]}" logs --tail=200 backend >&2
  exit 1
fi

echo "Backend saludable. Recreando solamente el frontend..."
"${compose[@]}" up -d --no-deps --force-recreate web

echo "Despliegue finalizado. PostgreSQL y su volumen no fueron recreados."
"${compose[@]}" ps -a
