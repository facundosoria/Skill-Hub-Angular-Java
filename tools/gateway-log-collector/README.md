# Gateway log collector

Python 3.10+ and the standard library only. Run on the Docker host; the backend
receives a read-only directory containing **only sanitized** log data. This tool
never changes the gateway, Docker daemon configuration, SkillHub, or its database.

## Run and verify locally

From the repository root:

```sh
PYTHONPATH=tools/gateway-log-collector python3 -B -m unittest discover -s tools/gateway-log-collector/tests -v
PYTHONPATH=tools/gateway-log-collector python3 -B -m gateway_log_collector validate tools/gateway-log-collector/fixtures/example
```

The runtime tests start the real reader and writer processes with the executable
`fixtures/fake-docker.py`, which streams `fixtures/example.log` with fictional data
and current timestamps. They exercise stdout and stderr, daemon failures, EOF,
backoff, a full six-hour cold-start cursor, two-second reconnect overlap, replay,
restart, final schema validation, and graceful SIGTERM. No Docker daemon or network
is used. Temporary directories are removed after the tests. The two-segment
`fixtures/example/` directory is a stable interchange fixture for backend tests;
its timestamps are fixed, so use a matching test clock when enforcing freshness.

To keep a simulated live directory for manual inspection, use three terminals:

```sh
# Prepare private test directories; choose an unused directory.
mkdir -m 700 /tmp/gateway-log-demo
mkdir -m 700 /tmp/gateway-log-demo/source
# Terminal 1, from tools/gateway-log-collector:
python3 -B -m gateway_log_collector writer --out-dir /tmp/gateway-log-demo/sanitized --socket /tmp/gateway-log-demo/source.sock
# Terminal 2, from tools/gateway-log-collector:
FAKE_DOCKER_STATE=/tmp/gateway-log-demo/source FAKE_DOCKER_HOLD=30 python3 -B -m gateway_log_collector reader --socket /tmp/gateway-log-demo/source.sock --docker "$PWD/fixtures/fake-docker.py"
# Terminal 3, from tools/gateway-log-collector:
python3 -B -m gateway_log_collector validate /tmp/gateway-log-demo/sanitized
```

Stop reader and writer with Ctrl-C or SIGTERM. The example is a simulation only;
production uses the dedicated accounts and units in `deploy/gateway-log-collector`.

## Boundary and format

The reader alone belongs to `docker`. It inspects only the configured container ID
and invokes `docker logs --follow --timestamps --since <cursor> api-gateway`.
It drains both child pipes with selectors. Neither raw lines nor Docker errors
are printed or saved. The writer has neither Docker group membership nor socket
visibility. A private AF_UNIX stream socket acts as a bidirectional process pipe:
reader sends bounded frames, writer replies once with the committed replay cursor.
No TCP listener or HTTP API exists. In production its directory is 0710, socket
0620, and only the two dedicated accounts can access its group.

The application queue holds at most 1 MiB of serialized frames. Socket send buffer
is 64 KiB (Linux can account twice this value); physical line buffers are 16 KiB
per stream and incoming frames are at most 32 KiB. On oversize lines the entire
physical line is drained, without interpreting its suffix. Backpressure above
1 MiB or a stalled pipe ends the Docker subscription and replays from durable
state. Writer silence detection is ten seconds. Systemd caps each service at
64 MiB; the reader's cap also covers its Docker CLI child. These are bounds, not
a claim that all overhead equals the serialized queue size.

The `r2-v1` allowlist is ported from the validated R2 prototype. No raw message is
copied. URL authority, path values, query, fragment, request identifiers, headers,
credentials, bodies, unknown logger names, and exception continuations never enter
an event. Approved short loggers, literal route templates, bounded numbers,
reason codes, and valid nonzero 32/16 hexadecimal correlation identifiers survive.
Correlation IDs retain their original case and are intentionally public technical
identifiers. Messages are rendered from approved fields. All 14 event fields are
present, with `null` for absent data. No `traceparent` is written.

A line without a valid Docker UTC timestamp, invalid UTF-8, control characters,
DEBUG/TRACE, unknown continuation, or oversize content is omitted. Recognized
headers with unapproved messages produce `LOG_MESSAGE_OMITTED`. `omittedCount`
counts these omissions (including physical continuation lines and oversize input)
in minute buckets within the retained six-hour window; it does not count replay
duplicates or UI filters. There is no raw diagnostic fallback.

## Journal and retention

`manifest.json` is replaced atomically within its directory, after segment fsync
and private checkpoint fsync. A normal checkpoint/heartbeat occurs each second,
even without requests. Complete UTF-8 NDJSON records end in LF; the schema reader
ignores an incomplete final record. Segment names are generated internally, files
are 0640, and the output directory is 0750. An advisory exclusive lock prevents
two writers. The owner-only `.state/` directory contains cursor/container metadata,
minute omission buckets, and fingerprints of **sanitized** records only; no raw
logs or input fingerprints are persisted. Do not mount `.state/` separately or
make it group-readable.

Segments close at ten minutes of source-time span, ten minutes of writer uptime,
or before exceeding 2 MiB. Catch-up and live therefore both use bounded segments.
Capacity is enforced on every append: all retained generations together fit
64 MiB/100,000 events after pruning. The oldest whole segments are removed first,
with `retentionTruncated=true` for six hours after a capacity cut. During an append
or atomic replacement, allow temporary headroom of one event plus checkpoint and
manifest files; reserve at least 80 MiB on disk. The 64 MiB cap refers to NDJSON
segments, not filesystem overhead or the Docker source logs.

Age pruning runs every minute even while idle. A segment is removed when its
oldest event is older than six hours, so coverage can be shortened by up to ten
minutes instead of retaining expired events until the newest one expires. The
minute timer permits up to one minute of pruning lag. `windowStart` reports the
actual current coverage; consumers still enforce their exact six-hour cutoff.
Future timestamps more than 60 seconds ahead are omitted; parsed timestamps,
rather than mtime, control expiry. System clock corrections still require a
synchronized host clock.

## Recovery and source status

Cold start asks Docker for `now - 6 hours`, without a tail-count limit. The private
checkpoint stores the last processed source timestamp and bounded replay keys
(container identity, stream, timestamp, occurrence of the sanitized fingerprint).
Each reconnect asks for at least two seconds of overlap. Same-time identical
requests retain multiplicity; stdout and stderr are distinct. Ordering is arrival
order from the CLI pipes, not a claimed global Docker ordering.
An arrival more than two seconds behind the source cursor invalidates continuity.
The next connection starts a new generation and rereads the full six-hour window,
so a delayed stream is not skipped by the newer stream's reconnect cursor.

The published cursor is `<generation>:<seq>`. A valid restart retains generation
and increments sequence; a partial tail is removed before appending. Source
container identity is checked at each connection and every 15 seconds while
following. Recreated containers, stale cursors beyond six hours, corrupt or
inconsistent checkpoints, and exhausted replay continuity cause a new generation
with sequence starting at 1. Manifest segments advertise **only the current
generation**. Prior-generation files stay unadvertised until age/capacity pruning;
backend clients reset on a generation change.

Replay keys and ordinal maps each cap at 4,096 entries and normally retain three
seconds. Overflow disables deduplication for the remainder of that subscription
and forces a new generation on reconnect, preserving live events instead of
silently removing uncertain matches. Exact delivery cannot be proven if Docker
rotates away history, changes ordering of indistinguishable same-time records, or
fails between inspect and follow. No exactly-once guarantee is made. A missing
previous container's last logs cannot be recovered from its replacement.

`starting` is the initial writer state. A source handshake marks `healthy`;
EOF, reader exit, inspection failure, or stale pipe marks `disconnected` while
retained history remains available. Heartbeat reflects the writer; source contact
reflects source/reader activity, and `lastEventAt` reflects the most recently
stored event's source timestamp. A silent gateway does not look like a dead writer.
Reconnect delays are 1/2/4/8/16/30 seconds, reset after a 30-second subscription.
SIGTERM closes the Docker CLI, flushes/closes segments, and publishes disconnected.
Disk/permission errors stop the writer for systemd to restart; they are never
reported as successful capture and exception text is never logged.

Deployment and rollback: see `../../deploy/gateway-log-collector/README.md`.
