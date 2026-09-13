#!/usr/bin/env bash
set -Eeuo pipefail

for command_name in docker python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Falta el comando requerido: $command_name" >&2
    exit 1
  fi
done

if ! docker compose config --services | grep -qx 'db'; then
  echo "Ejecuta este script desde el directorio que contiene docker-compose.yml." >&2
  exit 1
fi

umask 077
credentials_dir="${XDG_STATE_HOME:-${HOME}/.local/state}/skillhub"
mkdir -p "$credentials_dir"
credentials_file="${credentials_dir}/admin-accounts-$(date -u +%Y%m%dT%H%M%SZ).md"

task_tmp="$(mktemp -d "${TMPDIR:-/tmp}/skillhub-admins.XXXXXX")"
trap 'rm -rf "$task_tmp"' EXIT
records_file="${task_tmp}/accounts.tsv"
sql_file="${task_tmp}/accounts.sql"

python3 - "$records_file" "$sql_file" <<'PY'
import base64
import hashlib
import secrets
import string
import sys

records_path, sql_path = sys.argv[1:]
alphabet = string.ascii_letters + string.digits + "!@#%^*-_=+"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


records: list[tuple[str, str, str, str]] = []
for number in range(1, 11):
    username = f"admin{number}"
    name = f"Admin {number}"
    password = "".join(secrets.choice(alphabet) for _ in range(20))
    salt = secrets.token_bytes(16)
    derived_key = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=16384,
        r=8,
        p=1,
        dklen=64,
        maxmem=64 * 1024 * 1024,
    )
    password_hash = "scrypt$16384$8$1${}${}".format(
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(derived_key).decode("ascii"),
    )
    records.append((username, name, password, password_hash))

with open(records_path, "x", encoding="utf-8") as records_file:
    for username, name, password, password_hash in records:
        records_file.write(f"{username}\t{name}\t{password}\t{password_hash}\n")

usernames = ", ".join(sql_literal(row[0]) for row in records)
with open(sql_path, "x", encoding="utf-8") as sql_file:
    sql_file.write("BEGIN;\n")
    sql_file.write("DO $$\nBEGIN\n")
    sql_file.write(f"  IF EXISTS (SELECT 1 FROM users WHERE username IN ({usernames})) THEN\n")
    sql_file.write("    RAISE EXCEPTION 'Ya existe una o mas cuentas admin1..admin10; no se inserto ninguna cuenta';\n")
    sql_file.write("  END IF;\nEND $$;\n")
    for username, name, _password, password_hash in records:
        sql_file.write(
            "INSERT INTO users (username, name, team, role, status, password_hash) VALUES ("
            f"{sql_literal(username)}, {sql_literal(name)}, 'Backoffice', "
            f"'admin'::role, 'active'::account_status, {sql_literal(password_hash)});\n"
        )
    sql_file.write("COMMIT;\n")
    sql_file.write(
        f"SELECT username, role, status FROM users WHERE username IN ({usernames}) ORDER BY username;\n"
    )
PY

docker compose exec -T db sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$sql_file"

python3 - "$records_file" "$credentials_file" <<'PY'
from datetime import datetime, timezone
import os
import sys

records_path, output_path = sys.argv[1:]
with open(records_path, encoding="utf-8") as source:
    rows = [line.rstrip("\n").split("\t") for line in source]

with open(output_path, "x", encoding="utf-8") as output:
    output.write("# Cuentas administradoras de Skill Hub\n\n")
    output.write(f"Generadas: {datetime.now(timezone.utc).isoformat()}\n\n")
    output.write("> Archivo confidencial. No subir a Git ni compartir por canales inseguros.\n\n")
    output.write("| Usuario | Contraseña |\n")
    output.write("|---|---|\n")
    for username, _name, password, _password_hash in rows:
        output.write(f"| `{username}` | `{password}` |\n")

os.chmod(output_path, 0o600)
PY

echo "Se crearon 10 cuentas administradoras activas: admin1 a admin10."
echo "Credenciales guardadas con permisos 600 en: $credentials_file"
