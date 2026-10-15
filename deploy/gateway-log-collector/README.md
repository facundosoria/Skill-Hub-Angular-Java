# Host deployment and rollback (operator procedure; not executed)

These files install a host-only, two-process collector. They do not edit compose,
restart the gateway, deploy SkillHub, or configure Docker rotation. Review them on
the target host and schedule installation separately. Requirements: Linux/systemd,
Python 3.10+, local Docker CLI at `/usr/bin/docker`, an existing `docker` group,
a synchronized UTC clock, and at least 80 MiB of free space for the sanitized
journal (plus separate space for Docker's original logs).

## Accounts, permissions, and backend UID 1001

- `tpi-log-source`: dedicated non-login account, primary `tpi-log-pipe`, supplementary
  `docker`. This process and its Docker CLI child are the only collector processes
  with Docker access. Docker group membership is powerful daemon access; the fixed
  command is an application restriction, not a Docker-enforced read-only ACL.
- `tpi-log-writer`: dedicated non-login account, primary `tpi-log-read`, supplementary
  `tpi-log-pipe`, **never docker**. Its unit also hides the Docker socket and data
  directory. Root owns the installed Python code, units, and configuration.
- `/run/gateway-log-collector`: ephemeral private pipe directory, writer-owned,
  group `tpi-log-pipe`, mode 0710. The writer adjusts its group at startup; the
  Unix stream pipe is 0620. The reader cannot write output files or code.
- `/var/lib/tpi-log-view`: root:`tpi-log-read`, 0750.
- `/var/lib/tpi-log-view/sanitized`: writer:`tpi-log-read`, 0750. Published manifest
  and segments are 0640. `.state/` is 0700 and its checkpoint/lock are 0600.

The SkillHub backend runs as UID/GID 1001:1001. File access is determined by group
membership: keep the collector's dedicated `tpi-log-read` host GID and add that
**numeric supplementary GID** to the backend container in a separately authorized
deployment overlay. Do not assume the host GID is 1001 or change ownership to
an arbitrary existing UID. The exact additive compose fragment is:

```yaml
services:
  backend:
    group_add:
      - "${TPI_LOG_READ_GID:?set numeric host tpi-log-read GID}"
    volumes:
      - /var/lib/tpi-log-view/sanitized:/var/lib/tpi-log-view/sanitized:ro
```

Obtain the numeric GID with `getent group tpi-log-read`. Set the existing backend
configuration `app.infra.logs.dir` to the mount path and enable the separately
implemented feature only after integration validation. This worker does not edit
compose or backend configuration. Preserve all existing overlays and aliases.
The backend must never join `docker`/`tpi-log-pipe` or receive the Docker socket.

## Review, install, and start

From a reviewed checkout:

```sh
PYTHONPATH=tools/gateway-log-collector python3 -B -m unittest discover -s tools/gateway-log-collector/tests -v
systemd-analyze verify deploy/gateway-log-collector/gateway-log-writer.service deploy/gateway-log-collector/gateway-log-reader.service
bash -n deploy/gateway-log-collector/install.sh
# Privileged operator step, intentionally not executed by this task:
sudo deploy/gateway-log-collector/install.sh --install-files
```

The installer creates missing dedicated accounts/groups, installs root-owned code
in `/opt/gateway-log-collector`, units, an initial config (without overwriting an
existing config), and output directories. It reloads systemd but **does not start
or enable services**. On an upgrade, stop both units first so files are not copied
under a running Python process. For pre-existing dedicated accounts, review `id`
output and ensure their exact groups match the list above; the installer refuses
a root account or a writer in `docker` and never silently changes reused accounts.
Do not reuse accounts that belong to unrelated groups.

Review `/etc/gateway-log-collector.conf` (the example contains only source name and
output directory), then as a separate operator step:

```sh
sudo systemctl enable --now gateway-log-writer.service gateway-log-reader.service
systemctl status gateway-log-writer.service gateway-log-reader.service
# This validates sanitized data only; do not print source logs:
sudo -u tpi-log-writer sh -c 'cd /opt/gateway-log-collector && python3 -B -m gateway_log_collector validate /var/lib/tpi-log-view/sanitized'
```

`LOG_CONTAINER` is a fixed operator-selected name, default `api-gateway`; no HTTP
caller can choose it. `LOG_OUT_DIR` defaults to `/var/lib/tpi-log-view/sanitized`.
If changing the output path, create the dedicated directory with the same
permissions and update the writer's `ReadWritePaths` and reader's
`InaccessiblePaths` in unit drop-ins before starting. Both units pin Docker to its
local Unix socket and ignore Docker's user config directory.

The writer has `ProtectSystem=strict` with only the output directory writable,
plus its systemd-managed runtime directory and private temporary directory. The
reader has no writable persistent paths. Both use `NoNewPrivileges`, private tmp
and devices, kernel/control-group protections, empty capabilities, AF_UNIX-only
sockets, disabled core dumps, 64 MiB memory limits, bounded file descriptors and
tasks. No raw log payload or Docker error is logged. Test this on the target
systemd/Python/Docker versions before enabling the backend feature; static unit
verification does not execute its namespaces or prove runtime confinement.

Monitor sourceStatus/heartbeatAt/lastSourceContactAt separately in the sanitized
manifest and service state with systemctl. A disconnected source preserves history.
After an operator restart of the writer, restart both services together. Do not
change `.state` permissions to let the backend inspect it. For crash/cursor,
retention, replay limits, and generation semantics see the tool README.

## Rollback

1. Disable the backend log feature through its separate authorized configuration
   procedure; remove its read-only mount/supplementary GID only when no longer used.
2. `sudo systemctl disable --now gateway-log-reader.service gateway-log-writer.service`.
3. Restore the previous reviewed collector package/units/config if rolling back a
   version, then daemon-reload and start **both** units. A changed/corrupt checkpoint
   safely resets the public generation; do not hand-edit sequences or checkpoints.
4. To uninstall instead, remove only these two unit files, `/opt/gateway-log-collector`,
   and `/etc/gateway-log-collector.conf`, then `sudo systemctl daemon-reload`.
5. If collection stays stopped, the minute pruning timer also stops. Explicitly
   remove `/var/lib/tpi-log-view/sanitized` under the operator's data-retention
   procedure within six hours; do not retain it as an indefinite backup. Remove
   dedicated accounts/groups only after checking no other deployment uses them.

No gateway/Docker change is part of installation or rollback.

## Separate recommendation: rotate original gateway stdout

The collector's 64 MiB cap does not limit the gateway's existing `json-file` logs.
Apply this only in a **separate approved gateway maintenance change**. A targeted
addition to the gateway's own compose service is:

```yaml
services:
  api-gateway:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Alternatively, merge these keys into `/etc/docker/daemon.json`, preserving all
existing settings:

```json
{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
```

Daemon defaults affect newly created containers and require a separately planned
Docker restart; existing containers need recreation to adopt new logging options.
See the [Docker JSON file driver documentation](https://docs.docker.com/engine/logging/drivers/json-file/)
and [logging configuration reference](https://docs.docker.com/engine/logging/configure/).
The targeted compose option also requires gateway recreation. Neither action was
executed here. A 30 MiB source cap can contain less than six hours during a storm;
the collector cannot replay source data Docker already deleted. Size this policy
from actual workload and disk budget before applying it.
