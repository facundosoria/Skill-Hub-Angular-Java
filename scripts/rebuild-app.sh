#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
compose_file="${project_dir}/docker-compose.yml"
env_file="${project_dir}/.env"

if [[ ! -f "$compose_file" ]]; then
  echo "No se encontro el archivo Docker Compose: $compose_file" >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "No se encontro el archivo de entorno: $env_file" >&2
  exit 1
fi

compose=(docker compose -p skill-hub-angular-java --env-file "$env_file" -f "$compose_file")

"${compose[@]}" config --quiet

echo "Levantando PostgreSQL si hace falta..."
"${compose[@]}" up -d db

db_id="$("${compose[@]}" ps -q db)"
if [[ -z "$db_id" ]] || [[ "$(docker inspect --format '{{.State.Running}}' "$db_id")" != "true" ]]; then
  echo "La base de datos no quedo en ejecucion." >&2
  exit 1
fi

echo "Verificando el esquema de Hydra..."
"${compose[@]}" up hydra-migrate
migrate_id="$("${compose[@]}" ps -a -q hydra-migrate)"
if [[ -z "$migrate_id" ]] || [[ "$(docker inspect --format '{{.State.ExitCode}}' "$migrate_id")" != "0" ]]; then
  echo "La migracion de Hydra fallo." >&2
  exit 1
fi

echo "Levantando/actualizando Hydra..."
"${compose[@]}" up -d --no-deps hydra

hydra_healthy=false
for _ in {1..30}; do
  hydra_id="$("${compose[@]}" ps -q hydra)"
  if [[ -z "$hydra_id" ]]; then
    break
  fi

  hydra_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$hydra_id")"
  if [[ "$hydra_health" == "healthy" ]]; then
    hydra_healthy=true
    break
  fi

  hydra_state="$(docker inspect --format '{{.State.Status}}' "$hydra_id")"
  if [[ "$hydra_state" == "exited" ]] || [[ "$hydra_state" == "dead" ]]; then
    break
  fi

  sleep 2
done

if [[ "$hydra_healthy" != "true" ]]; then
  echo "Hydra no quedo saludable. El backend no sera recreado (depende de Hydra)." >&2
  "${compose[@]}" logs --tail=200 hydra >&2
  exit 1
fi

echo "Verificando las claves de Hydra..."
"${compose[@]}" up --no-deps hydra-keys
keys_id="$("${compose[@]}" ps -a -q hydra-keys)"
if [[ -z "$keys_id" ]] || [[ "$(docker inspect --format '{{.State.ExitCode}}' "$keys_id")" != "0" ]]; then
  echo "La provision de claves de Hydra fallo." >&2
  exit 1
fi

echo "Construyendo las imagenes de backend y frontend..."
"${compose[@]}" build backend web

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

web_id="$("${compose[@]}" ps -q web)"
if [[ -z "$web_id" ]] || [[ "$(docker inspect --format '{{.State.Running}}' "$web_id")" != "true" ]]; then
  echo "El frontend no quedo en ejecucion." >&2
  "${compose[@]}" logs --tail=200 web >&2
  exit 1
fi

echo "Verificando el HTML servido por el nuevo contenedor web..."
if ! "${compose[@]}" exec -T web wget -q -O /dev/null http://127.0.0.1:8080/; then
  echo "El frontend no responde HTTP dentro del contenedor." >&2
  "${compose[@]}" logs --tail=200 web >&2
  exit 1
fi

"${compose[@]}" rm -f db-init hydra-migrate hydra-keys

echo "Despliegue finalizado. PostgreSQL y su volumen no fueron recreados."
echo "Backend: $(docker inspect --format '{{.Image}}' "$backend_id")"
echo "Frontend: $(docker inspect --format '{{.Image}}' "$web_id")"
"${compose[@]}" ps
