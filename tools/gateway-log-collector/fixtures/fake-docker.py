#!/usr/bin/env python3
"""Fictional Docker CLI for local live/reconnection tests; never invokes Docker."""
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import time

args = sys.argv[1:]
state = Path(os.environ["FAKE_DOCKER_STATE"])
if args == ["inspect", "--format", "{{.Id}}", "api-gateway"]:
    print("a" * 64)
    raise SystemExit(0)
if len(args) != 6 or args[:4] != ["logs", "--follow", "--timestamps", "--since"] or args[-1] != "api-gateway":
    raise SystemExit(2)
(state / "last-since").write_text(args[4])
counter = state / "attempts"
attempts = int(counter.read_text()) if counter.exists() else 0
counter.write_text(str(attempts + 1))
if attempts < int(os.environ.get("FAKE_DOCKER_FAILURES", "0")):
    print("Fictional daemon disconnected", file=sys.stderr)
    raise SystemExit(1)
clock = state / "timestamp"
if not clock.exists():
    clock.write_text(datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
timestamp = clock.read_text()
if os.environ.get("FAKE_DOCKER_FLOOD") == "1":
    for _ in range(2000):
        for destination in (sys.stdout, sys.stderr):
            print(timestamp + " " + "fictitiousPayload" * 700, file=destination, flush=True)
    raise SystemExit(0)
for raw in Path(__file__).with_name("example.log").read_text().splitlines():
    if raw.startswith("2026-"):
        raw = raw.split(" ", 1)[1]
    print(timestamp + " " + raw, flush=True)
    time.sleep(0.03)
print(timestamp + " 12:34:56.123 ERROR [api-gateway,,,] a.e.u.f.t.p.a.filters.LoggingFilter - GET /actuator/health -> 503 (2 ms)", file=sys.stderr, flush=True)
time.sleep(float(os.environ.get("FAKE_DOCKER_HOLD", "0.1")))
