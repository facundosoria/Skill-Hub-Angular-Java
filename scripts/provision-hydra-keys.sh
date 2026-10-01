#!/bin/sh
set -eu

# Hydra genera algunos key sets de forma perezosa. Materializarlos antes de
# arrancar los consumidores evita que la primera autorización pague ese coste.
# La consulta usa sólo la representación pública y descarta toda salida; nunca
# se imprimen claves privadas ni el resultado completo del API.
endpoint="${HYDRA_ADMIN_URL:?HYDRA_ADMIN_URL es obligatorio}"
public_endpoint="${HYDRA_PUBLIC_URL:?HYDRA_PUBLIC_URL es obligatorio}"
http_timeout="${HYDRA_KEYS_HTTP_TIMEOUT_SECONDS:-120}"
access_token_strategy="${STRATEGIES_ACCESS_TOKEN:-jwt}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

ensure_key_set() {
  key_set="$1"
  response="$work_dir/$key_set.json"
  headers="$work_dir/$key_set.headers"

  # A GET is read-only and lets Hydra materialize a missing set in v2.2.0.
  # Keep the HTTP status separate: only an explicit 404 authorizes the
  # fallback POST. Network errors, timeouts and 5xx responses must fail fast.
  if wget --quiet --server-response --timeout="$http_timeout" \
      --output-document="$response" "$endpoint/admin/keys/$key_set" \
      2>"$headers"; then
    status="$(sed -n 's/^  HTTP\/[0-9.][0-9.]* \([0-9][0-9][0-9]\).*/\1/p' "$headers" | tail -n 1)"
  else
    status="$(sed -n 's/^  HTTP\/[0-9.][0-9.]* \([0-9][0-9][0-9]\).*/\1/p' "$headers" | tail -n 1)"
    case "$status" in
      404) ;;
      *) echo "hydra-keys: GET $key_set failed (HTTP ${status:-network error})" >&2; exit 1 ;;
    esac
  fi

  case "$status" in
    200)
      echo "hydra-keys: $key_set ready (GET 200)" >&2
      ;;
    404)
      echo "hydra-keys: $key_set absent (GET 404), creating once" >&2
      wget --quiet --server-response --timeout="$http_timeout" \
        --output-document=/dev/null --header='Content-Type: application/json' \
        --post-data='{"alg":"RS256","use":"sig"}' \
        "$endpoint/admin/keys/$key_set" 2>"$headers" || {
          echo "hydra-keys: POST $key_set failed" >&2
          exit 1
        }
      ;;
    *)
      echo "hydra-keys: GET $key_set returned unexpected HTTP ${status:-unknown}" >&2
      exit 1
      ;;
  esac
}

# Hydra v2.2.0 materializes the OIDC signing set through the public JWKS GET.
# The Admin API GET intentionally remains 404 until a set is created, so do
# not turn that 404 into a rotation-prone POST for this set.
public_jwks="$work_dir/public-jwks.json"
public_headers="$work_dir/public-jwks.headers"
if ! wget --quiet --server-response --timeout="$http_timeout" \
    --output-document="$public_jwks" "$public_endpoint/.well-known/jwks.json" \
    2>"$public_headers"; then
  status="$(sed -n 's/^  HTTP\/[0-9.][0-9.]* \([0-9][0-9][0-9]\).*/\1/p' "$public_headers" | tail -n 1)"
  echo "hydra-keys: GET public JWKS failed (HTTP ${status:-network error})" >&2
  exit 1
fi
status="$(sed -n 's/^  HTTP\/[0-9.][0-9.]* \([0-9][0-9][0-9]\).*/\1/p' "$public_headers" | tail -n 1)"
case "$status" in
  200) echo "hydra-keys: hydra.openid.id-token ready (public JWKS GET 200)" >&2 ;;
  *) echo "hydra-keys: public JWKS returned unexpected HTTP ${status:-unknown}" >&2; exit 1 ;;
esac

case "$access_token_strategy" in
  jwt) ensure_key_set hydra.jwt.access-token ;;
  opaque) echo "hydra-keys: skipping hydra.jwt.access-token (STRATEGIES_ACCESS_TOKEN=opaque)" >&2 ;;
  *) echo "hydra-keys: unsupported STRATEGIES_ACCESS_TOKEN=$access_token_strategy" >&2; exit 1 ;;
esac
