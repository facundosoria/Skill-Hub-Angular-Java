#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/skillhub-e2e.XXXXXX")"
env_file="${tmp_dir}/.env"
output_file="${tmp_dir}/client-output.log"
touch "${tmp_dir}/sensitive-values"
compose_file="${project_dir}/docker-compose.yml"
override_file="${project_dir}/docker-compose.e2e.yml"
cleanup_done=false
compose_initialized=false
started_at="$(date +%s)"
readiness_timeout_seconds="${E2E_READINESS_TIMEOUT_SECONDS:-120}"
readiness_interval_seconds="${E2E_READINESS_INTERVAL_SECONDS:-2}"
readiness_required_successes="${E2E_READINESS_REQUIRED_SUCCESSES:-3}"
readiness_url="http://127.0.0.1:18087/api/health"

[[ "${readiness_timeout_seconds}" =~ ^[0-9]+$ && "${readiness_interval_seconds}" =~ ^[0-9]+$ && "${readiness_required_successes}" =~ ^[1-9][0-9]*$ ]] || {
  echo "FAIL 5.1 configuración de readiness inválida" >&2
  exit 1
}

capture_diagnostics() {
  local diagnostics_file="${tmp_dir}/readiness-failure.log"
  {
    echo "--- docker compose ps ---"
    "${compose[@]}" ps
    echo "--- backend/web/hydra logs ---"
    "${compose[@]}" logs --no-color backend web hydra
  } >"${diagnostics_file}" 2>&1 || true
  echo "Diagnóstico de readiness: ${diagnostics_file}" >&2
}

capture_startup_diagnostics() {
  local diagnostics_file="${tmp_dir}/startup-failure.log"
  {
    echo "--- docker compose ps --all ---"
    "${compose[@]}" ps --all
    echo "--- docker compose logs --all ---"
    "${compose[@]}" logs --no-color --timestamps
  } >"${diagnostics_file}" 2>&1 || true
  echo "Diagnóstico de startup: ${diagnostics_file}" >&2
}

cleanup() {
  local status=$?
  if [[ "${cleanup_done}" != true ]]; then
    cleanup_done=true
    if [[ "${compose_initialized}" == true ]]; then
      # Usar exactamente los mismos argumentos que en up hace que Compose
      # encuentre también los servicios one-shot y sus objetos asociados.
      if ! "${compose[@]}" down -v --remove-orphans; then
        echo "FAIL 5.1 teardown del proyecto skillhub-e2e" >&2
        status=1
      fi
      if ! assert_project_objects_absent; then
        echo "FAIL 5.1 teardown dejó objetos del proyecto skillhub-e2e" >&2
        status=1
      fi
    fi
  fi
  if [[ "${status}" -eq 0 ]]; then
    rm -rf "${tmp_dir}"
  else
    echo "Logs E2E conservados en ${tmp_dir}" >&2
  fi
  exit "${status}"
}
trap cleanup EXIT

assert_project_objects_absent() {
  local containers volumes networks
  containers="$(docker ps -a --filter label=com.docker.compose.project=skillhub-e2e --format '{{.ID}} {{.Names}}' || true)"
  volumes="$(docker volume ls --filter label=com.docker.compose.project=skillhub-e2e --format '{{.Name}}' || true)"
  networks="$(docker network ls --filter label=com.docker.compose.project=skillhub-e2e --format '{{.Name}}' || true)"
  if [[ -n "${containers}" || -n "${volumes}" || -n "${networks}" ]]; then
    echo "FAIL 5.1 ya existen objetos del proyecto skillhub-e2e; no se inicia para evitar un conflicto" >&2
    [[ -n "${containers}" ]] && printf '  contenedores:\n%s\n' "${containers}" >&2
    [[ -n "${volumes}" ]] && printf '  volúmenes:\n%s\n' "${volumes}" >&2
    [[ -n "${networks}" ]] && printf '  redes:\n%s\n' "${networks}" >&2
    return 1
  fi
}

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

assert_project_objects_absent

echo "PASS 5.1 preflight docker ps verificado; proyecto y puertos E2E aislados"
"${compose[@]}" config --quiet
compose_initialized=true
if ! "${compose[@]}" up -d --build; then
  capture_startup_diagnostics
  exit 1
fi

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

# Caddy puede estar en proceso de cargar la configuración, y su upstream DNS
# puede tardar en estabilizarse, después de que los contenedores estén running.
readiness_started_at="$(date +%s)"
readiness_deadline=$(( readiness_started_at + readiness_timeout_seconds ))
readiness_successes=0
readiness_ready=false
while (( $(date +%s) < readiness_deadline )); do
  readiness_remaining=$(( readiness_deadline - $(date +%s) ))
  readiness_curl_timeout=2
  (( readiness_remaining < readiness_curl_timeout )) && readiness_curl_timeout=${readiness_remaining}
  (( readiness_curl_timeout > 0 )) || break
  if curl --silent --show-error --max-time "${readiness_curl_timeout}" --output /dev/null \
      --write-out '%{http_code}' "${readiness_url}" 2>/dev/null | grep -qx '200'; then
    readiness_successes=$((readiness_successes + 1))
    if (( readiness_successes >= readiness_required_successes )); then
      readiness_ready=true
      break
    fi
  else
    readiness_successes=0
  fi
  readiness_remaining=$(( readiness_deadline - $(date +%s) ))
  (( readiness_remaining > 0 )) || break
  readiness_sleep_seconds="${readiness_interval_seconds}"
  (( readiness_sleep_seconds > readiness_remaining )) && readiness_sleep_seconds=${readiness_remaining}
  sleep "${readiness_sleep_seconds}"
done
readiness_seconds=$(( $(date +%s) - readiness_started_at ))
echo "READINESS_SECONDS ${readiness_seconds}"
if [[ "${readiness_ready}" != true ]]; then
  echo "FAIL 5.1 backend no respondió HTTP 200 vía Caddy (${readiness_url}) tras ${readiness_timeout_seconds}s" >&2
  capture_diagnostics
  exit 1
fi
echo "PASS 5.1 readiness vía Caddy estable (${readiness_required_successes} respuestas HTTP 200 consecutivas)"

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
