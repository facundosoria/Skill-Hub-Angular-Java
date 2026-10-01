#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
compose=(docker compose -p skillhub-e2e --env-file "")
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/skillhub-e2e.XXXXXX")"
env_file="${tmp_dir}/.env"
output_file="${tmp_dir}/client-output.log"
touch "${tmp_dir}/sensitive-values"
compose_file="${project_dir}/docker-compose.yml"
override_file="${project_dir}/docker-compose.e2e.yml"
cleanup_done=false
started_at="$(date +%s)"

cleanup() {
  local status=$?
  if [[ "${cleanup_done}" != true ]]; then
    cleanup_done=true
    # El nombre explícito protege los contenedores/volúmenes de cualquier otro
    # compose del host. No se imprime la salida porque puede incluir variables.
    docker compose -p skillhub-e2e --env-file "${env_file}" \
      -f "${compose_file}" -f "${override_file}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "${tmp_dir}"
  exit "${status}"
}
trap cleanup EXIT

for command_name in docker node openssl curl; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "FAIL 5.1 comando requerido ausente: ${command_name}" >&2
    exit 1
  }
done

umask 077
postgress_password="$(openssl rand -hex 24)"
session_secret="$(openssl rand -hex 32)"
hydra_db_password="$(openssl rand -hex 24)"
hydra_system_secret="$(openssl rand -hex 32)"
cat >"${env_file}" <<EOF
POSTGRES_USER=skillhub
POSTGRES_PASSWORD=${postgress_password}
POSTGRES_DB=skillhub
SESSION_SECRET=${session_secret}
HYDRA_DB_PASSWORD=${hydra_db_password}
HYDRA_SYSTEM_SECRET=${hydra_system_secret}
PUBLIC_BASE_URL=http://127.0.0.1:18087
HYDRA_DEV_MODE=true
COOKIE_SECURE=false
EOF

compose=(docker compose -p skillhub-e2e --env-file "${env_file}" \
  -f "${compose_file}" -f "${override_file}")

if [[ -n "$("${compose[@]}" ps -q 2>/dev/null || true)" ]]; then
  echo "FAIL 5.1 ya existe el proyecto skillhub-e2e; no se detuvo para preservar su estado" >&2
  exit 1
fi

echo "PASS 5.1 preflight docker ps verificado; proyecto y puertos E2E aislados"
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build

for _ in {1..90}; do
  backend_status="$("${compose[@]}" ps -q backend | xargs -r docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  web_status="$("${compose[@]}" ps -q web | xargs -r docker inspect --format '{{.State.Status}}' 2>/dev/null || true)"
  if [[ "${backend_status}" == healthy && "${web_status}" == running ]]; then
    break
  fi
  sleep 2
done

backend_status="$("${compose[@]}" ps -q backend | xargs -r docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
web_status="$("${compose[@]}" ps -q web | xargs -r docker inspect --format '{{.State.Status}}' 2>/dev/null || true)"
if [[ "${backend_status}" != healthy || "${web_status}" != running ]]; then
  echo "FAIL 5.1 stack E2E no quedó saludable" >&2
  exit 1
fi

# Caddy puede estar en proceso de cargar la configuración unos segundos
# después de que el contenedor figure como running.
for _ in {1..30}; do
  if curl --silent --show-error --fail --max-time 2 \
      http://127.0.0.1:18087/.well-known/oauth-protected-resource >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

set +e
node "${project_dir}/e2e/oauth/client.js" \
  --base-url http://127.0.0.1:18087 \
  --compose-project skillhub-e2e \
  --sensitive-file "${tmp_dir}/sensitive-values" \
  --output "${output_file}" \
  | tee "${tmp_dir}/visible-output.log"
client_status=${PIPESTATUS[0]}
set -e
client_failed=0
[[ "${client_status}" -eq 0 ]] || client_failed=1

"${compose[@]}" logs --no-color >"${tmp_dir}/container.log" 2>/dev/null || true
logs_failed=0
while IFS= read -r secret; do
  [[ -z "${secret}" ]] && continue
  if grep -F --quiet -- "${secret}" "${tmp_dir}/container.log"; then
    logs_failed=1
    break
  fi
done < "${tmp_dir}/sensitive-values"
if [[ "${logs_failed}" -ne 0 ]]; then
  echo "FAIL 5.16 un secreto generado apareció en logs" >&2
else
  echo "PASS 5.16 logs sin passwords/tokens/client secrets/valores .env"
fi
total_seconds=$(( $(date +%s) - started_at ))
echo "TOTAL_SECONDS ${total_seconds}"
if [[ "${client_failed}" -ne 0 || "${logs_failed}" -ne 0 ]]; then
  exit 1
fi
