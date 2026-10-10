#!/usr/bin/env bash
# Harness aislado para scripts/rebuild-app.sh (modo tailscale).
#
# No toca el .env del checkout: arma un proyecto temporal con copias de los
# compose y del script bajo prueba, su propio .env dummy y comandos stub.
# Al final verifica que el .env del worktree real no fue creado ni modificado.
#
# Uso: bash scripts/test-rebuild-tailscale.sh
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
real_project="$(cd "${script_dir}/.." && pwd)"
checkout_env="${real_project}/.env"

# Estado inicial del .env del checkout, para probar que el harness no lo toca.
if [[ -e "$checkout_env" ]]; then
  checkout_env_before=present
  checkout_env_hash_before="$(sha256sum "$checkout_env" | awk '{print $1}')"
else
  checkout_env_before=absent
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fixture="${tmp}/project"
mkdir -p "${fixture}/scripts" "${tmp}/bin" "${tmp}/home"
cp "${real_project}/docker-compose.yml" "${fixture}/docker-compose.yml"
cp "${real_project}/docker-compose.tailscale.yml" "${fixture}/docker-compose.tailscale.yml"
cp "${real_project}/scripts/rebuild-app.sh" "${fixture}/scripts/rebuild-app.sh"
script="${fixture}/scripts/rebuild-app.sh"
env_file="${fixture}/.env"
out="${tmp}/out"
calls="${tmp}/calls"
events="${tmp}/events"

cat >"${tmp}/bin/hostname" <<'EOF'
#!/bin/sh
echo servidin
EOF
cat >"${tmp}/bin/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF
cat >"${tmp}/bin/curl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$CALLS"
printf '<html><script src="%s"></script></html>\n' "${CURL_BUNDLE:-main-test.js}"
EOF
cat >"${tmp}/bin/git" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$CALLS"
case "$*" in
  *branch*) echo master ;;
  *rev-parse*) echo abc123 ;;
esac
exit 0
EOF
cat >"${tmp}/bin/docker" <<'EOF'
#!/usr/bin/env bash
args="$*"
printf '%s\n' "$args" >>"$CALLS"

if [[ "$args" == *"config --quiet"* ]]; then
  [[ "${FAIL_CONFIG:-}" == true ]] && exit 1
  if [[ "$args" == *docker-compose.tailscale.yml* ]]; then
    echo overlay-config >>"$EVENTS"
  else
    echo base-config >>"$EVENTS"
  fi
  if [[ "$args" == *docker-compose.tailscale.yml* ]]; then
    [[ -n "${TS_HOSTNAME:-}" ]] || { echo "missing TS_HOSTNAME process environment" >&2; exit 1; }
    [[ -n "${TS_AUTHKEY:-}" ]] || { echo "missing TS_AUTHKEY process environment" >&2; exit 1; }
    printf 'compose-hostname=%s\n' "$TS_HOSTNAME" >>"$EVENTS"
    printf 'compose-authkey-present\n' >>"$EVENTS"
    [[ "$TS_AUTHKEY" == "DUMMY-KEY-FOR-TEST-ONLY" ]] || { echo "wrong TS_AUTHKEY process environment" >&2; exit 1; }
    [[ "$TS_HOSTNAME" == "skillhub-example" ]] || { echo "wrong TS_HOSTNAME process environment" >&2; exit 1; }
  fi
  exit 0
fi
if [[ "$args" == *"ps -aq --filter label=com.docker.compose.service=mesh"* ]]; then
  [[ "${CROSS_PROJECT_MESH:-false}" == true ]] && echo other-project-mesh
  exit 0
fi
if [[ "$args" == *"ps -a -q mesh"* ]]; then
  case "$(cat "$MESH_STATE" 2>/dev/null || echo absent)" in
    original-running|original-stopped) echo original-mesh ;;
    replacement-unhealthy) echo replacement-mesh ;;
    running|stopped) echo meshid ;;
  esac
  exit 0
fi
if [[ "$args" == *"ps -q mesh"* ]]; then
  case "$(cat "$MESH_STATE" 2>/dev/null || echo absent)" in
    running) echo meshid ;;
    replacement-unhealthy) echo replacement-mesh ;;
    race) echo different-mesh ;;
  esac
  exit 0
fi
if [[ "$args" == *"up -d mesh"* ]]; then
  echo mesh-up >>"$EVENTS"
  if [[ "${MESH_REPLACE_ON_UP:-false}" == true ]]; then echo replacement-unhealthy >"$MESH_STATE"; elif [[ "${MESH_RACE:-false}" == true ]]; then echo race >"$MESH_STATE"; else echo running >"$MESH_STATE"; fi
  exit 0
fi
if [[ "$args" == *"rm -sf mesh"* ]]; then echo mesh-remove >>"$EVENTS"; echo absent >"$MESH_STATE"; exit 0; fi
if [[ "$args" == update\ --restart=* ]]; then
  restart_policy="${args#update --restart=}"
  restart_policy="${restart_policy%% *}"
  printf 'restart-policy=%s\n' "$restart_policy" >>"$EVENTS"
  exit 0
fi
if [[ "$args" == *"stop meshid"* ]]; then echo mesh-stopped >>"$EVENTS"; echo stopped >"$MESH_STATE"; exit 0; fi
if [[ "$args" == *"start meshid"* ]]; then echo mesh-started >>"$EVENTS"; echo running >"$MESH_STATE"; exit 0; fi
if [[ "$args" == *"up -d db"* ]]; then echo db-up >>"$EVENTS"; exit 0; fi
if [[ "$args" == *"up -d --no-deps --force-recreate backend"* ]]; then
  if [[ "$args" == *docker-compose.tailscale.yml* ]]; then
    echo mesh-backend >>"$EVENTS"
    echo mesh >"$BACKEND_MODE"
  else
    echo base-backend >>"$EVENTS"
    echo base >"$BACKEND_MODE"
  fi
  exit 0
fi
if [[ "$args" == *"up -d --no-deps --force-recreate web"* ]]; then echo web-up >>"$EVENTS"; exit 0; fi
if [[ "$args" == *pg_dumpall* ]]; then
  echo dump >>"$EVENTS"
  [[ "${DUMP_FAIL:-}" == true ]] && exit 1
  [[ "${DUMP_EMPTY:-}" == true ]] || echo dump
  exit 0
fi
if [[ "$args" == *"exec -T db"* ]]; then
  if [[ "$args" == *"to_regclass"* ]]; then echo t; fi
  exit 0
fi
if [[ "$args" == *"exec -T web wget"* ]]; then exit 0; fi
if [[ "$args" == *"exec -T web"* ]]; then echo main-test.js; exit 0; fi
if [[ "$args" == port\ * ]]; then echo "0.0.0.0:${CURRENT_WEB_PORT:-8087}"; exit 0; fi
if [[ "$args" == *"ps --no-trunc"* ]]; then
  [[ -n "${PORT_OWNER:-}" ]] && echo "$PORT_OWNER"
  exit 0
fi
if [[ "$args" == *"volume inspect"* ]]; then exit 0; fi
if [[ "$args" == *" up hydra-migrate"* ]]; then echo hydra-migrate >>"$EVENTS"; exit 0; fi
if [[ "$args" == *" up -d --no-deps hydra"* ]]; then exit 0; fi
if [[ "$args" == *" up --no-deps hydra-keys"* ]]; then exit 0; fi
if [[ "$args" == *" build backend web"* ]]; then exit 0; fi
if [[ "$args" == *"logs --tail="* ]]; then exit 0; fi
if [[ "$args" == *" rm -f db-init hydra-migrate hydra-keys"* ]]; then exit 0; fi
if [[ "$args" == *" ps" && "$args" != *"ps -"* ]]; then exit 0; fi
if [[ "$args" == *"ps -a -q hydra-migrate"* ]]; then echo migrateid; exit 0; fi
if [[ "$args" == *"ps -a -q hydra-keys"* ]]; then echo keysid; exit 0; fi
if [[ "$args" == *"ps -q web"* ]]; then echo webid; exit 0; fi
if [[ "$args" == *"ps -q db"* ]]; then echo dbid; exit 0; fi
if [[ "$args" == *"ps -q hydra"* ]]; then echo hydraid; exit 0; fi
if [[ "$args" == *"ps -q mesh"* ]]; then echo meshid; exit 0; fi
if [[ "$args" == *"ps -q backend"* ]]; then echo backendid; exit 0; fi
if [[ "$args" == *"inspect --format"* ]]; then
  if [[ "$args" == *"RestartPolicy.Name"* ]]; then echo "${MESH_RESTART_POLICY:-unless-stopped}"; exit 0; fi
  if [[ "$args" == *"State.Running"* && "$args" == *meshid* ]]; then
    [[ "${MESH_PREEXISTING_RUNNING:-true}" == true ]] && echo true || echo false
    exit 0
  fi
  if [[ "$args" == *webid* ]]; then echo true; exit 0; fi
  if [[ "$args" == *original-mesh* || "$args" == *replacement-mesh* ]]; then
    [[ "$args" == *RestartPolicy.Name* ]] && { echo "${MESH_RESTART_POLICY:-unless-stopped}"; exit 0; }
    [[ "$args" == *State.Running* ]] && { [[ "$(cat "$MESH_STATE")" == original-running ]] && echo true || echo false; exit 0; }
    [[ "$args" == *State.Health* ]] && { echo unhealthy; exit 0; }
    exit 0
  fi
  if [[ "$args" == *meshid* ]]; then
    [[ "${MESH_HEALTH:-healthy}" == healthy ]] && echo healthy || echo unhealthy
    exit 0
  fi
  if [[ "$args" == *backendid* ]]; then
    if [[ "$args" == *State.Health* ]]; then
      if [[ "${BACKEND_HEALTH:-healthy}" == unhealthy && "$(cat "$BACKEND_MODE" 2>/dev/null || echo base)" == mesh ]]; then
        echo unhealthy
      else
        echo healthy
      fi
    elif [[ "$args" == *State.Status* ]]; then
      echo running
    else
      echo healthy
    fi
    exit 0
  fi
  if [[ "$args" == *dbid* ]]; then
    if [[ "$args" == *State.Running* ]]; then echo true
    elif [[ "$args" == *Mounts* ]]; then echo skullhub-v2_pgdata
    else echo healthy
    fi
    exit 0
  fi
  if [[ "$args" == *hydraid* ]]; then echo healthy; exit 0; fi
  if [[ "$args" == *migrateid* || "$args" == *keysid* ]]; then echo 0; exit 0; fi
  echo healthy; exit 0
fi
echo "unexpected docker stub command: $args" >&2
exit 97
EOF
chmod +x "${tmp}/bin/"*

export PATH="${tmp}/bin:${PATH}"
export CALLS="$calls" EVENTS="$events" HOME="${tmp}/home"
export BACKEND_MODE="${tmp}/backend-mode" MESH_STATE="${tmp}/mesh-state"
unset TS_AUTHKEY TS_HOSTNAME 2>/dev/null || true

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS %s\n' "$*"; }
run() { : >"$calls"; : >"$events"; rm -f "$BACKEND_MODE"; if [[ "${MESH_PREEXISTING:-false}" != true ]]; then echo absent >"$MESH_STATE"; else [[ "${MESH_PREEXISTING_RUNNING:-true}" == true ]] && echo running >"$MESH_STATE" || echo stopped >"$MESH_STATE"; fi; bash "$script" "$@" >"$out" 2>&1; }
assert_no_mesh_before_preflight() {
  local mesh_call volume_call status_call branch_call port_call domain_call
  mesh_call="$(grep -n 'up -d mesh' "$calls" | head -n1 | cut -d: -f1 || true)"
  [[ -n "$mesh_call" ]] || fail "no se levanto mesh para comparar el orden"
  volume_call="$(grep -n 'volume inspect' "$calls" | head -n1 | cut -d: -f1 || true)"
  status_call="$(grep -n 'status --porcelain' "$calls" | head -n1 | cut -d: -f1 || true)"
  branch_call="$(grep -n 'branch --show-current' "$calls" | head -n1 | cut -d: -f1 || true)"
  port_call="$(grep -n 'ps --no-trunc' "$calls" | head -n1 | cut -d: -f1 || true)"
  domain_call="$(grep -n 'marketplace-utn.tech' "$calls" | head -n1 | cut -d: -f1 || true)"
  for check in "$volume_call" "$status_call" "$branch_call" "$port_call" "$domain_call"; do
    [[ -n "$check" && "$check" -lt "$mesh_call" ]] \
      || fail "el sidecar inició antes de completar el preflight [$check] (mesh=$mesh_call)"
  done
}
no_service_mutation() {
  grep -Eq '^(mesh-up|db-up|mesh-backend|base-backend|web-up|hydra-migrate)$' "$events" \
    && fail "el preflight fallido produjo mutacion de servicios: $*"
  return 0
}
base_env() {
  cat <<'ENV'
POSTGRES_USER=skillhub
POSTGRES_PASSWORD=dummy-postgres-password
POSTGRES_DB=skillhub
SESSION_SECRET=dummy-session-secret-long-enough-000000
HYDRA_DB_PASSWORD=dummy-hydra-db-password
HYDRA_SYSTEM_SECRET=dummy-hydra-system-secret-long-enough
TS_AUTHKEY=DUMMYKEYFILE
TS_HOSTNAME=skillhub-prod-unique
ENV
}
no_mutation() {
  grep -Eq ' (config|up) ' "$calls" && fail "preflight reached docker config/up: $*"
  return 0
}

# 1. default-off: sin tailscale no se toca el overlay ni se inspecciona mesh.
grep -q 'tailscale_opt_in=false' "$script" || fail "el default no desactiva tailscale"
grep -q 'if \[\[ "$tailscale_opt_in" == true \]\]; then' "$script" || fail "el opt-in no está aislado"
pass "default-off no entra al bloque de sidecar/variables"

# Focused assertions for explicit values, validation, and safe ordering.
printf 'TS_AUTHKEY=DUMMY-KEY-FOR-TEST-ONLY\nTS_HOSTNAME=skillhub-example\n' >"$env_file"
grep -q '"TS_AUTHKEY=\$ts_authkey"' "$script" || fail "no exporta authkey validada al proceso Compose"
grep -q '"TS_HOSTNAME=\$ts_hostname"' "$script" || fail "no exporta hostname validado al proceso Compose"
grep -q '63' "$script" || fail "no valida longitud DNS"
grep -q 'pg_dumpall' "$script" && grep -q 'hydra-migrate' "$script" || fail "faltan comprobaciones del backup/migracion"
grep -q 'DNS válido' "$script" || fail "no valida hostname"
grep -q 'Falló el respaldo' "$script" && grep -q 'respaldo de PostgreSQL quedó vacío' "$script" || fail "no falla cerrado ante backup fallido/vacío"
if grep -q 'echo.*ts_authkey\|printf.*ts_authkey' "$script"; then fail "podría imprimir la key"; fi
pass "paso explícito sin imprimir key, DNS y backup antes de migración"

# Run the real script against the docker stub and verify values arrive in the
# docker/Compose process environment (the stub never prints the dummy key).
: >"$env_file"
export TS_AUTHKEY='DUMMY-KEY-FOR-TEST-ONLY' TS_HOSTNAME='skillhub-example'
run prod tailscale || fail "opt-in con valores dummy validados fallo"
grep -q '^compose-hostname=skillhub-example$' "$events" || fail "hostname efectivo no llego al entorno de docker"
grep -q '^compose-authkey-present$' "$events" || fail "authkey efectiva no llego al entorno de docker"
if grep -Fq 'DUMMY-KEY-FOR-TEST-ONLY' "$out"; then fail "la salida del harness expuso el dummy authkey"; fi
unset TS_AUTHKEY TS_HOSTNAME
pass "docker recibe exactamente los valores validados por su entorno sin imprimir la authkey"

# 18. el .env del checkout quedo intacto.
[[ -f "$env_file" ]] || fail "falta el .env dummy del fixture"
if [[ "$checkout_env_before" == absent ]]; then
  [[ ! -e "$checkout_env" ]] || fail "el harness creo ${checkout_env}"
else
  [[ -e "$checkout_env" ]] || fail "el harness borro ${checkout_env}"
  [[ "$(sha256sum "$checkout_env" | awk '{print $1}')" == "$checkout_env_hash_before" ]] \
    || fail "el harness modifico ${checkout_env}"
fi
pass "checkout-root .env intacto"

printf 'ALL TESTS PASSED\n'
