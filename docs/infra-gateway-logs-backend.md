# Gateway log API

The backend reads only the collector's sanitized, version 1 `manifest.json` and
`seg-<generation>-<six digits>.ndjson` files. It never invokes Docker or reads raw
logs. `app.infra.logs.enabled` defaults to `false` (`APP_INFRA_LOGS_ENABLED`);
`app.infra.logs.dir` defaults to `/var/lib/tpi-log-view/sanitized`
(`APP_INFRA_LOGS_DIR`). Disabled routes return 404 before authentication and do
not open source files. This feature is independent of `app.infra.enabled`.

Mount the entire dedicated collector directory read-only. The overlay requires
`INFRA_LOGS_GID`, the numeric host GID of `tpi-log-read`, and adds it as a
supplementary group to backend UID/GID 1001. The directory and files keep their
0750/0640 permissions; the backend does not need root or the Docker group.
Resolve and validate the GID before composing:

```sh
export INFRA_LOGS_GID="$(getent group tpi-log-read | cut -d: -f3)"
case "$INFRA_LOGS_GID" in ''|*[!0-9]*) echo 'Set the numeric gid of tpi-log-read' >&2; exit 1 ;; esac
```

Recommended before activation, after the collector publishes its first
manifest: verify actual file opens as UID 1001 with that supplementary GID on
the host (adjust the directory if using `INFRA_LOGS_DIR`). This prints no log
contents and changes no ownership or permissions:

```sh
sudo setpriv --reuid=1001 --regid=1001 --groups="$INFRA_LOGS_GID" --no-new-privs \
  python3 - /var/lib/tpi-log-view/sanitized <<'PY'
import json
from pathlib import Path
import sys
root = Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_bytes())
for segment in manifest['segments']:
    with (root / segment['file']).open('rb') as source:
        source.read(1)
print('Sanitized log files are readable as UID 1001')
PY
```

The container still needs the correct read-only bind mount and host directory
traversal permissions. Compose validation alone cannot prove those permissions.
Symlinks are rejected. Only filenames listed
in the current manifest are opened; no client input selects a path. Unknown
event fields never enter the API DTO. Incomplete final lines wait for the next
poll. Generation changes discard the index; removed segments shorten coverage.

Append `-f docker-compose.gateway-logs.yml` **after every existing overlay** in
the deployment command. For example, an operator's already reviewed Compose
invocation with base, tailnet, and a production network overlay becomes:

```sh
docker compose -p skullhub-v2 --env-file .env \
  -f docker-compose.yml -f docker-compose.tailscale.yml \
  -f /home/sorias/skillhub-infra-prod-networks.yml \
  -f docker-compose.gateway-logs.yml config --quiet
```

This is a validation example, not a replacement for deployment guards. The
current `scripts/rebuild-app.sh` explicitly assembles its own file list and
accepts only the `tailscale` modifier; `COMPOSE_FILE` does not append an overlay
to that list. Incorporating this overlay in that guarded deployment path needs
separate operator approval and script work. Do not drop existing network
overlays or use a direct `up` to bypass backups, health checks or mesh guards.
No deployment is performed as part of this backend change.

Authenticated GET routes under `/api/infra/logs/api-gateway`:

- Base: `limit=1..150` (150 default), `levels=INFO,WARN,ERROR`, literal
  case-insensitive `q` (120 characters), hexadecimal `traceId`, exclusive
  `before` or `after`, and optional inclusive `through`.
- `/status`: source status and cursors, retention and admission state; no query
  parameters and no entries. With no readable manifest, status and snapshot
  return 200 with `sourceStatus=starting`, null generation/coverage/cursors,
  and an empty snapshot (`policyVersion`, last-contact and last-event times
  are null too). A stream still requires a valid cursor and available source.
  A lost/stale
  source with retained history returns data with `sourceStatus=disconnected`.
- `/stream`: required `after` and the same filters. `Last-Event-ID` overrides
  `after`. SSE sends `retry: 3000`, logs/checkpoints, status and 15-second
  keepalives. Replay overflow emits `gap`, an expired/new-generation cursor
  emits `reset`, and session revocation emits `access-revoked`, then closes.

Normal and equivalent matrix/percent-encoded routes honor the feature flag and
hide query diagnostics; encoded slashes are rejected by the default connector.
Responses use `Cache-Control: private, no-store, no-transform`; SSE also uses
`X-Accel-Buffering: no`. Errors contain `code` and a Spanish `message`; 429
includes `Retry-After`. JSON errors explicitly use `application/json;charset=UTF-8`.
Unknown/duplicate parameters and queries over 2 KiB are
rejected. Literal search queries are hidden from servlet/MVC query diagnostics;
the ingress must also omit query strings for these routes from access logs.

The shared reader polls every 250 ms. Its ring is bounded by 32 MiB serialized
entry payload, 100,000 events and six hours; Java object overhead is additional.
Pages scan at most 5,000 events/two seconds and return actual scan cursors.
Opening quotas are 12/minute (burst 3), history/status 30/minute (burst 5), two
streams/account and 100 total. Queues are bounded by 500 events/256 KiB, batches
by 50 events/32 KiB, and replay by 1,000 events/1 MiB. Sender workers are capped
at 16 with 200 pending jobs. Stalled writes and rejected sender jobs release
admission and complete the async request with an error, without flushing from
the publisher. Session JWT expiry, active account and password
nonce are rechecked every 15 seconds using the existing session service. A
stream has a 15-minute servlet timeout.

Before production activation, verify SSE flush, proxy timeouts and query-log
policy through the actual ingress, and load-test slow readers with the deployed
Tomcat connector. Blocking servlet writes use a bounded pool; its memory bounds
are not a throughput guarantee for 100 clients. No load/ingress claim is made
by the unit/controller tests.

Rollback: set `APP_INFRA_LOGS_ENABLED=false` or remove only the gateway log
overlay from the existing chain and recreate the backend through the approved
deployment process. Collector files are never modified by the backend.
