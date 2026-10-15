#!/usr/bin/env bash
# Install files and accounts only. Never starts services or edits the gateway.
set -euo pipefail

if [[ ${EUID} -ne 0 || $# -ne 1 || $1 != --install-files ]]; then
  echo 'Usage (root, after reviewing README): install.sh --install-files' >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/../.." && pwd)
getent group docker >/dev/null || { echo 'The docker group must already exist' >&2; exit 1; }
for group in tpi-log-read tpi-log-pipe; do
  getent group "$group" >/dev/null || groupadd --system "$group"
done
getent passwd tpi-log-writer >/dev/null || useradd --system --gid tpi-log-read --groups tpi-log-pipe --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin tpi-log-writer
getent passwd tpi-log-source >/dev/null || useradd --system --gid tpi-log-pipe --groups docker --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin tpi-log-source
# Refuse unsafe account reuse rather than silently broadening existing privileges.
writer_groups=" $(id -nG tpi-log-writer) "
if [[ $writer_groups == *' docker '* || $(id -u tpi-log-writer) -eq 0 || $(id -u tpi-log-source) -eq 0 ]]; then
  echo 'Dedicated non-root accounts are required; writer must not belong to docker' >&2
  exit 1
fi
install -d -o root -g root -m 0755 /opt/gateway-log-collector
install -d -o root -g root -m 0755 /opt/gateway-log-collector/gateway_log_collector
install -o root -g root -m 0644 "$repo_root"/tools/gateway-log-collector/gateway_log_collector/*.py /opt/gateway-log-collector/gateway_log_collector/
install -d -o root -g tpi-log-read -m 0750 /var/lib/tpi-log-view
install -d -o tpi-log-writer -g tpi-log-read -m 0750 /var/lib/tpi-log-view/sanitized
install -o root -g root -m 0644 "$script_dir"/gateway-log-{writer,reader}.service /etc/systemd/system/
if [[ ! -e /etc/gateway-log-collector.conf ]]; then
  install -o root -g root -m 0644 "$script_dir/gateway-log-collector.conf.example" /etc/gateway-log-collector.conf
fi
systemctl daemon-reload
printf '%s\n' 'Files installed; services remain stopped. Follow README to review and enable.'
