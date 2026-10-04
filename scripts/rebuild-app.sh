#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
compose_file="${project_dir}/docker-compose.yml"
env_file="${project_dir}/.env"

if [[ "$#" -ne 1 ]]; then
  echo "Uso: ./scripts/rebuild-app.sh local|raspi|prod" >&2
  exit 2
fi

target="$1"
case "$target" in
  local)
    public_base_url="http://localhost:8087"
    cookie_secure="false"
    web_port="8087"
    ;;
  raspi)
    public_base_url="https://skillhub.rcoleman.me"
    cookie_secure="true"
    web_port="18080"
    ;;
  prod)
    public_base_url="https://marketplace-utn.tech"
    cookie_secure="true"
    web_port="8087"
    ;;
  *)
    echo "Destino desconocido: $target. Usar local, raspi o prod." >&2
    exit 2
    ;;
esac

host_name="$(hostname -s)"
if [[ "$target" == raspi && "$host_name" != pi-server ]] ||
   [[ "$target" == prod && "$host_name" != servidin ]] ||
   [[ "$target" == local && ( "$host_name" == pi-server || "$host_name" == servidin ) ]]; then
  echo "El destino $target no corresponde al host $host_name. No se modificaron contenedores." >&2
  exit 1
fi

if [[ ! -f "$compose_file" ]]; then
  echo "No se encontro el archivo Docker Compose: $compose_file" >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "No se encontro el archivo de entorno: $env_file" >&2
  exit 1
fi

compose=(env "PUBLIC_BASE_URL=$public_base_url" "COOKIE_SECURE=$cookie_secure" "WEB_PORT=$web_port" "HYDRA_DEV_MODE=auto" \
  docker compose -p skill-hub-angular-java --env-file "$env_file" -f "$compose_file")

"${compose[@]}" config --quiet

# En los hosts remotos, nunca crear silenciosamente un volumen vacío en lugar
# de reutilizar la base existente. El alta inicial requiere revisar el volumen.
if [[ "$target" != local ]] && ! docker volume inspect skill-hub-angular-java_pgdata >/dev/null 2>&1; then
  echo "No existe el volumen skill-hub-angular-java_pgdata en este host. No se modificaron contenedores." >&2
  echo "Identificar y respaldar el volumen PostgreSQL existente antes del primer despliegue." >&2
  exit 1
fi

if [[ "$target" != local ]] && [[ -n "$(git -C "$project_dir" status --porcelain --untracked-files=normal)" ]]; then
  echo "El checkout tiene cambios sin commitear. No se desplegará código distinto al commit de Git." >&2
  exit 1
fi

if [[ "$target" != local ]] && [[ "$(git -C "$project_dir" branch --show-current)" != master ]]; then
  echo "El despliegue remoto requiere la rama master." >&2
  exit 1
fi

echo "Destino: $target ($public_base_url -> 127.0.0.1:$web_port); commit: $(git -C "$project_dir" rev-parse --short HEAD)"

port_owner="$(docker ps --no-trunc --filter "publish=$web_port" --format '{{.ID}}' | head -n 1)"
current_web_id="$("${compose[@]}" ps -q web)"
if [[ -n "$port_owner" ]] && [[ "$port_owner" != "$current_web_id" ]]; then
  echo "El puerto $web_port está ocupado por otro contenedor. No se modificaron contenedores." >&2
  echo "Identificar y detener el stack anterior antes del despliegue de $target." >&2
  exit 1
fi

if [[ "$target" != local ]]; then
  current_web_port=""
  if [[ -n "$current_web_id" ]]; then
    current_web_port="$(docker port "$current_web_id" 8080/tcp 2>/dev/null | awk -F: 'NR == 1 { print $NF }')"
  fi
  if [[ "$current_web_port" == "$web_port" ]]; then
    current_bundle="$("${compose[@]}" exec -T web sh -c "grep -oE 'main-[A-Za-z0-9_-]+[.]js' /srv/index.html | head -n 1" 2>/dev/null || true)"
    public_bundle="$(curl --fail --silent --show-error --max-time 20 "$public_base_url/" | grep -oE 'main-[A-Za-z0-9_-]+[.]js' | head -n 1 || true)"
    if [[ -z "$current_bundle" ]] || [[ "$public_bundle" != "$current_bundle" ]]; then
      echo "El dominio $public_base_url no apunta al servicio web de este proyecto. No se modificaron contenedores." >&2
      echo "Contenedor: ${current_bundle:-sin bundle}; dominio: ${public_bundle:-sin bundle}. Revisar el túnel/proxy." >&2
      exit 1
    fi
  fi
fi

echo "Levantando PostgreSQL si hace falta..."
"${compose[@]}" up -d db

db_id="$("${compose[@]}" ps -q db)"
if [[ -z "$db_id" ]] || [[ "$(docker inspect --format '{{.State.Running}}' "$db_id")" != "true" ]]; then
  echo "La base de datos no quedo en ejecucion." >&2
  exit 1
fi

if [[ "$target" != local ]]; then
  db_healthy=false
  for _ in {1..30}; do
    if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_id")" == healthy ]]; then
      db_healthy=true
      break
    fi
    sleep 2
  done
  if [[ "$db_healthy" != true ]]; then
    echo "PostgreSQL no quedó saludable; no se iniciaron migraciones." >&2
    exit 1
  fi

  db_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db_id")"
  if [[ "$db_volume" != skill-hub-angular-java_pgdata ]]; then
    echo "El contenedor db usa un volumen inesperado: ${db_volume:-ninguno}. No se iniciaron migraciones." >&2
    exit 1
  fi

  if ! "${compose[@]}" exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT 1" >/dev/null'; then
    echo "La credencial de PostgreSQL en .env no coincide con la base existente. No se iniciaron migraciones." >&2
    exit 1
  fi
fi

if [[ "$target" == prod ]]; then
  backup_dir="${HOME}/skill-hub-backups/${target}"
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  backup_file="${backup_dir}/postgres-$(date -u +%Y%m%dT%H%M%SZ).sql"
  backup_tmp="${backup_file}.tmp"
  trap 'if [[ -n "${backup_tmp:-}" ]]; then rm -f -- "$backup_tmp"; fi' EXIT
  umask 077
  if ! "${compose[@]}" exec -T db sh -c 'exec pg_dumpall -U "$POSTGRES_USER"' > "$backup_tmp"; then
    rm -f "$backup_tmp"
    echo "Falló el respaldo de PostgreSQL; no se iniciaron migraciones." >&2
    exit 1
  fi
  if [[ ! -s "$backup_tmp" ]]; then
    rm -f "$backup_tmp"
    echo "El respaldo de PostgreSQL quedó vacío; no se iniciaron migraciones." >&2
    exit 1
  fi
  mv "$backup_tmp" "$backup_file"
  backup_tmp=""
  echo "Respaldo PostgreSQL: $backup_file"
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

if [[ "$target" != local ]]; then
  new_bundle="$("${compose[@]}" exec -T web sh -c "grep -oE 'main-[A-Za-z0-9_-]+[.]js' /srv/index.html | head -n 1" 2>/dev/null || true)"
  public_bundle="$(curl --fail --silent --show-error --max-time 20 "$public_base_url/" | grep -oE 'main-[A-Za-z0-9_-]+[.]js' | head -n 1 || true)"
  if [[ -z "$new_bundle" ]] || [[ "$public_bundle" != "$new_bundle" ]]; then
    echo "El dominio no sirve el frontend nuevo. Contenedor: ${new_bundle:-sin bundle}; dominio: ${public_bundle:-sin bundle}." >&2
    exit 1
  fi
fi

"${compose[@]}" rm -f db-init hydra-migrate hydra-keys

echo "Despliegue $target finalizado. PostgreSQL y su volumen no fueron recreados."
echo "Backend: $(docker inspect --format '{{.Image}}' "$backend_id")"
echo "Frontend: $(docker inspect --format '{{.Image}}' "$web_id")"
"${compose[@]}" ps
