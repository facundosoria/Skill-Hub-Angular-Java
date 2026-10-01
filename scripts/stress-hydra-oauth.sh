#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
e2e_script="${script_dir}/test-hydra-oauth.sh"
runs=10
with_load=false
load_level=1
output_dir=""
load_project="skillhub-oauth-load-${$}"
load_started=false
load_pids=()

usage() {
  cat <<'EOF'
Uso: scripts/stress-hydra-oauth.sh [opciones]

  -n, --runs N          cantidad de corridas (por defecto: 10)
      --with-load       agrega un stack Compose aislado y carga CPU
      --load-level N    procesos yes por núcleo (por defecto: 1)
      --output-dir DIR  conserva resultados en DIR (por defecto: temporal)
  -h, --help            muestra esta ayuda
EOF
}

die() { echo "FAIL: $*" >&2; exit 2; }

while (($#)); do
  case "$1" in
    -n|--runs) (($# >= 2)) || die "falta valor para $1"; runs="$2"; shift 2 ;;
    --with-load) with_load=true; shift ;;
    --load-level) (($# >= 2)) || die "falta valor para $1"; load_level="$2"; shift 2 ;;
    --output-dir) (($# >= 2)) || die "falta valor para $1"; output_dir="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "opción desconocida: $1" ;;
  esac
done

[[ "$runs" =~ ^[1-9][0-9]*$ ]] || die "--runs debe ser un entero positivo"
[[ "$load_level" =~ ^[1-9][0-9]*$ ]] || die "--load-level debe ser un entero positivo"
command -v docker >/dev/null 2>&1 || die "falta docker"
command -v openssl >/dev/null 2>&1 || die "falta openssl"
command -v awk >/dev/null 2>&1 || die "falta awk"
[[ -x "$e2e_script" ]] || die "no es ejecutable $e2e_script"

if [[ -z "$output_dir" ]]; then
  output_dir="$(mktemp -d "${TMPDIR:-/tmp}/oauth-stress.XXXXXX")"
else
  mkdir -p "$output_dir"
fi
records_file="${output_dir}/records.tsv"
printf 'run\tresult\tduration_s\tload\n' > "$records_file"

load_compose="${output_dir}/load-compose.yml"
load_env="${output_dir}/load.env"
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for pid in "${load_pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  if [[ "$load_started" == true ]]; then
    docker compose -p "$load_project" --env-file "$load_env" \
      -f "${project_dir}/docker-compose.yml" \
      -f "${project_dir}/docker-compose.e2e.yml" \
      -f "$load_compose" down -v --remove-orphans >/dev/null 2>&1 || status=1
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "Resultados conservados en $output_dir" >&2
  else
    echo "Resultados conservados en $output_dir" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

start_load() {
  local cpu_count total i
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]] || cpu_count=1
  total=$((cpu_count * load_level))
  umask 077
  cat > "$load_env" <<EOF
POSTGRES_USER=skillhub
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=skillhub
SESSION_SECRET=$(openssl rand -hex 32)
HYDRA_DB_PASSWORD=$(openssl rand -hex 24)
HYDRA_SYSTEM_SECRET=$(openssl rand -hex 32)
PUBLIC_BASE_URL=http://127.0.0.1:18088
HYDRA_DEV_MODE=true
COOKIE_SECURE=false
EOF
  cat > "$load_compose" <<'EOF'
services:
  db:
    ports: !override
      - "127.0.0.1:15433:5432"
  hydra:
    ports: !override
      - "127.0.0.1:18445:4444"
  web:
    ports: !override
      - "127.0.0.1:18088:8080"
EOF
  docker compose -p "$load_project" --env-file "$load_env" \
    -f "${project_dir}/docker-compose.yml" \
    -f "${project_dir}/docker-compose.e2e.yml" \
    -f "$load_compose" up -d --build
  load_started=true
  for ((i=0; i<total; i++)); do
    yes >/dev/null &
    load_pids+=("$!")
  done
  echo "Carga activa: ${total} procesos yes; proyecto Compose $load_project"
}

load_average() {
  if [[ -r /proc/loadavg ]]; then
    awk '{print $1 ", " $2 ", " $3}' /proc/loadavg
  else
    uptime | awk -F'load averages?: ' '{print $2}' | sed 's/^[[:space:]]*//'
  fi
}

if [[ "$with_load" == true ]]; then
  start_load
fi

for ((run=1; run<=runs; run++)); do
  log_file="${output_dir}/e2e-${run}.log"
  started_at="$(date +%s)"
  set +e
  "$e2e_script" >"$log_file" 2>&1
  status=$?
  set -e
  duration=$(( $(date +%s) - started_at ))
  load="$(load_average)"
  if grep -q 'RESULT PASS checks=15 failures=0' "$log_file" && [[ "$status" -eq 0 ]]; then
    result=PASS
  else
    result=FAIL
  fi
  printf '%s\t%s\t%s\t%s\n' "$run" "$result" "$duration" "$load" >> "$records_file"
  echo "run=${run} result=${result} duration_s=${duration} load=${load}"
done

if awk -F '\t' 'NR > 1 && $2 != "PASS" {bad=1} END {exit bad}' "$records_file"; then
  exit 0
fi
exit 1
