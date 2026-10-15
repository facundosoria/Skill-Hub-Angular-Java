#!/usr/bin/env python3
"""Fictional source disconnects with old stderr records still pending."""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os, sys, time
root = Path(os.environ['V1_SOURCE_STATE'])
if sys.argv[1] == 'inspect':
    print('a' * 64)
    raise SystemExit(0)
count_file = root / 'attempt'
count = int(count_file.read_text()) if count_file.exists() else 0
count_file.write_text(str(count + 1))
clock_file = root / 'clock'
if not clock_file.exists():
    clock_file.write_text(datetime.now(timezone.utc).isoformat())
now = datetime.fromisoformat(clock_file.read_text())
since = datetime.fromisoformat(sys.argv[sys.argv.index('--since') + 1].replace('Z', '+00:00'))
(root / 'since').write_text(since.isoformat())
records = [(now, 200, sys.stdout), (now-timedelta(hours=1), 201, sys.stderr), (now-timedelta(minutes=59), 202, sys.stderr)]
for stamp, status, output in records:
    if count == 0 and status == 202:
        continue  # Inject transport EOF before the last historical stderr record.
    if stamp < since:
        continue
    stamp_text = stamp.isoformat().replace('+00:00', 'Z')
    print(f'{stamp_text} 12:00:00.000 INFO [api-gateway,,,] a.e.u.f.t.p.a.filters.LoggingFilter - GET /actuator/health -> {status} (1 ms)', file=output, flush=True)
time.sleep(.1)
