"""Single-writer journal, durable sanitized replay keys, and atomic metadata."""
from collections import Counter, deque
from datetime import datetime, timedelta, timezone
import hashlib
import fcntl
import json
import os
from pathlib import Path
import uuid

from .sanitize import DOCKER_TIME, Sanitizer, valid_timestamp
from .schema import SEGMENT_NAME, complete_events, encode, project, validate_directory

WINDOW = 21600
MAX_BYTES = 64 * 1024 * 1024
MAX_EVENTS = 100000
SEGMENT_BYTES = 2 * 1024 * 1024
SEGMENT_SECONDS = 600
REPLAY_KEYS = 4096


def utcnow():
    return datetime.now(timezone.utc)


def stamp(value):
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def atomic_json(path, value, mode=0o640):
    temporary = path.with_name(path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as target:
        os.fchmod(target.fileno(), mode)
        target.write(encode(value))
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Store:
    def __init__(self, directory, clock=utcnow, max_bytes=MAX_BYTES, max_events=MAX_EVENTS,
                 segment_bytes=SEGMENT_BYTES, segment_seconds=SEGMENT_SECONDS):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o750, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o750)
        self.private = self.directory / ".state"
        self.private.mkdir(mode=0o700, exist_ok=True)
        os.chmod(self.private, 0o700)
        self.lock = os.open(self.private / "writer.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.lock)
            self.lock = None
            raise OSError("Store already has a writer") from None
        self.clock = clock
        self.max_bytes, self.max_events = max_bytes, max_events
        self.segment_bytes, self.segment_seconds = segment_bytes, segment_seconds
        self.sanitizer = Sanitizer()
        self.generation = "g" + uuid.uuid4().hex
        self.head = 0
        self.container = None
        self.cursor = None
        self.keys = deque()
        self.key_set = set()
        self.ordinals = Counter()
        self.replay_prune_second = None
        self.omissions = deque()
        self.truncated_at = None
        self.continuous = True
        self.segments = []
        self.active = None
        self.retired_bytes = self.retired_events = 0
        self.status = "starting"
        self.last_contact = None
        self.last_event = None
        self.next_index = 1
        self.last_prune = self.clock()
        self._recover()
        self.prune()
        self.publish()

    def _recover(self):
        state_path = self.private / "checkpoint.json"
        if not (self.directory / "manifest.json").exists():
            return
        try:
            manifest = validate_directory(self.directory)
            state = json.loads(state_path.read_text())
            if state["generation"] != manifest["generation"] or state["head"] != manifest["headSeq"]:
                raise ValueError("Checkpoint disagreement")
            # Complete records ahead of a checkpoint mean uncertain continuity.
            for item in manifest["segments"]:
                path = self.directory / item["file"]
                events = list(complete_events(path))
                if events[-1]["seq"] != item["lastSeq"]:
                    raise ValueError("Uncommitted tail")
                size = sum(len(encode(event)) for event in events)
                # Remove a partial final write before any append or publication.
                with path.open("r+b") as target:
                    target.truncate(size)
                    target.flush()
                    os.fsync(target.fileno())
                self.segments.append(self._metadata(item, events, size))
            self.generation, self.head = state["generation"], state["head"]
            self.next_index = state["nextIndex"]
            self.container, self.cursor = state["container"], state["cursor"]
            self.keys = deque(tuple(key) for key in state["keys"])
            self.key_set = set(self.keys)
            self.omissions = deque(tuple(bucket) for bucket in state["omissions"])
            self.truncated_at = state["truncatedAt"]
            self.continuous = state["continuous"]
            self.last_event, self.last_contact = manifest["lastEventAt"], manifest["lastSourceContactAt"]
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            # Only sanitized files remain; never guess a source cursor after damage.
            self.segments = []
            self.continuous = False

    def _metadata(self, item, events, size):
        return dict(item, closed=True, size=size, count=len(events),
                    oldest=min(instant(e["timestamp"]) for e in events),
                    newest=max(instant(e["timestamp"]) for e in events),
                    opened=self.clock())

    def _close_active(self):
        if self.active:
            self.active.flush()
            os.fsync(self.active.fileno())
            self.active.close()
            self.active = None
            self.segments[-1]["closed"] = True

    def new_generation(self):
        self._close_active()
        self.generation = "g" + uuid.uuid4().hex
        self.head, self.next_index = 0, 1
        self.retired_bytes += sum(item["size"] for item in self.segments)
        self.retired_events += sum(item["count"] for item in self.segments)
        self.segments = []
        self.keys.clear()
        self.key_set.clear()
        self.ordinals.clear()
        self.omissions.clear()
        self.cursor = self.last_event = self.truncated_at = None
        self.continuous = True

    def connect(self, container):
        now = self.clock()
        if (self.container is not None and self.container != container) or not self.continuous:
            self.new_generation()
        if self.cursor and instant(self.cursor) < now - timedelta(seconds=WINDOW):
            self.new_generation()
        self.container = container
        self.ordinals.clear()
        self.status = "healthy"
        self.last_contact = stamp(now)
        since = instant(self.cursor) - timedelta(seconds=2) if self.cursor else now - timedelta(seconds=WINDOW)
        self.publish()
        return stamp(since)

    def omit(self, count=1):
        minute = int(self.clock().timestamp()) // 60
        if self.omissions and self.omissions[-1][0] == minute:
            self.omissions[-1] = (minute, self.omissions[-1][1] + count)
        else:
            self.omissions.append((minute, count))

    def process(self, raw, stream="stdout"):
        self.last_contact = stamp(self.clock())
        try:
            line = raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            self.omit()
            return False
        match = DOCKER_TIME.fullmatch(line.rstrip("\r\n"))
        if not match or not valid_timestamp(match[1]):
            self.omit()
            return False
        source_time = match[1]
        when = instant(source_time)
        now = self.clock()
        if when > now + timedelta(seconds=60) or when < now - timedelta(seconds=WINDOW):
            self.omit()
            return False
        event = self.sanitizer.process_line(line)
        safe = project(event, 1) if event else None
        # Fingerprints contain only allowlisted data, never raw log values.
        fingerprint = hashlib.sha256(encode(safe)).hexdigest()
        ordinal_key = (source_time, stream, fingerprint)
        if ordinal_key not in self.ordinals and len(self.ordinals) >= REPLAY_KEYS:
            self.continuous = False
            self.ordinals.clear()
        self.ordinals[ordinal_key] += 1
        key = (*ordinal_key, self.ordinals[ordinal_key])
        if self.continuous and key in self.key_set:
            return False
        if not self.cursor or when > instant(self.cursor):
            self.cursor = source_time
        cutoff = instant(self.cursor) - timedelta(seconds=3)
        # Streams can interleave: filter the bounded set once per source second.
        second = int(instant(self.cursor).timestamp())
        if second != self.replay_prune_second:
            self.keys = deque(key for key in self.keys if instant(key[0]) >= cutoff)
            self.key_set = set(self.keys)
            self.ordinals = Counter({key: value for key, value in self.ordinals.items() if instant(key[0]) >= cutoff})
            self.replay_prune_second = second
        if len(self.keys) >= REPLAY_KEYS:
            self.continuous = False
            removed = self.keys.popleft()
            self.key_set.discard(removed)
        self.keys.append(key)
        self.key_set.add(key)
        if event is None:
            self.omit()
            return False
        if event["event"] == "LOG_MESSAGE_OMITTED":
            self.omit()
        self.append(project(event, self.head + 1))
        return True

    def append(self, event):
        payload = encode(event)
        now = self.clock()
        when = instant(event["timestamp"])
        if self.active and (max(self.segments[-1]["newest"], when) - min(self.segments[-1]["oldest"], when)).total_seconds() >= self.segment_seconds:
            self._close_active()
        if self.active and (self.segments[-1]["size"] + len(payload) > self.segment_bytes or
                            (now - self.segments[-1]["opened"]).total_seconds() >= self.segment_seconds):
            self._close_active()
        if not self.active:
            name = f"seg-{self.generation}-{self.next_index:06d}.ndjson"
            self.next_index += 1
            fd = os.open(self.directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640)
            os.fchmod(fd, 0o640)
            self.active = os.fdopen(fd, "wb")
            self.segments.append(dict(file=name, firstSeq=event["seq"], lastSeq=event["seq"], closed=False,
                                      size=0, count=0, oldest=instant(event["timestamp"]),
                                      newest=instant(event["timestamp"]), opened=now))
        self.active.write(payload)
        self.active.flush()
        item = self.segments[-1]
        item.update(lastSeq=event["seq"], size=item["size"] + len(payload), count=item["count"] + 1,
                    oldest=min(item["oldest"], instant(event["timestamp"])),
                    newest=max(item["newest"], instant(event["timestamp"])))
        self.head = event["seq"]
        self.last_event = event["timestamp"]
        # Capacity is enforced on every append, not only at the minute timer.
        if self.retired_bytes + sum(item["size"] for item in self.segments) > self.max_bytes or self.retired_events + sum(item["count"] for item in self.segments) > self.max_events:
            self.prune()

    def prune(self):
        now = self.clock()
        cutoff = now - timedelta(seconds=WINDOW)
        remove = []
        for item in list(self.segments):
            if item["oldest"] < cutoff:
                if item is self.segments[-1]:
                    self._close_active()
                self.segments.remove(item)
                remove.append(self.directory / item["file"])
        # Retain previous generations on disk, but never advertise them.
        advertised = {item["file"] for item in self.segments}
        retained = []
        for path in self.directory.glob("seg-*.ndjson"):
            if path.name in advertised or path in remove or not SEGMENT_NAME.fullmatch(path.name):
                continue
            try:
                count, oldest = 0, None
                for event in complete_events(path):
                    count += 1
                    when = instant(event["timestamp"])
                    oldest = when if oldest is None else min(oldest, when)
                if oldest is None or oldest < cutoff:
                    remove.append(path)
                else:
                    retained.append((oldest, path, path.stat().st_size, count))
            except (OSError, ValueError):
                remove.append(path)
        total_bytes = sum(item["size"] for item in self.segments) + sum(item[2] for item in retained)
        total_events = sum(item["count"] for item in self.segments) + sum(item[3] for item in retained)
        candidates = [(item["oldest"], self.directory / item["file"], item["size"], item["count"], item)
                      for item in self.segments] + [(*item, None) for item in retained]
        for _, path, size, count, item in sorted(candidates, key=lambda item: (item[0], item[4] is not None, item[1].name)):
            if total_bytes <= self.max_bytes and total_events <= self.max_events:
                break
            if item is not None:
                if self.segments and item is self.segments[-1]:
                    self._close_active()
                self.segments.remove(item)
            remove.append(path)
            total_bytes -= size
            total_events -= count
            self.truncated_at = stamp(now)
        while self.omissions and self.omissions[0][0] < int(cutoff.timestamp()) // 60:
            self.omissions.popleft()
        if self.truncated_at and instant(self.truncated_at) < cutoff:
            self.truncated_at = None
        self.retired_bytes = sum(item[2] for item in retained if item[1] not in remove)
        self.retired_events = sum(item[3] for item in retained if item[1] not in remove)
        self.last_prune = now
        # Publish removal first: a reader never discovers a deleted segment in a new manifest.
        self.publish()
        for path in remove:
            path.unlink(missing_ok=True)

    def publish(self):
        now = self.clock()
        if self.active:
            self.active.flush()
            os.fsync(self.active.fileno())
        atomic_json(self.private / "checkpoint.json", {
            "generation": self.generation, "head": self.head, "nextIndex": self.next_index,
            "container": self.container, "cursor": self.cursor, "keys": list(self.keys),
            "omissions": list(self.omissions), "truncatedAt": self.truncated_at, "continuous": self.continuous,
        }, 0o600)
        cutoff = now - timedelta(seconds=WINDOW)
        oldest_time = min((item["oldest"] for item in self.segments), default=cutoff)
        manifest = dict(version=1, service="api-gateway", policyVersion="r2-v1", generation=self.generation,
                        sourceStatus=self.status, heartbeatAt=stamp(now), lastSourceContactAt=self.last_contact,
                        lastEventAt=self.last_event, windowStart=stamp(max(cutoff, oldest_time)),
                        oldestSeq=self.segments[0]["firstSeq"] if self.segments else 0, headSeq=self.head,
                        omittedCount=sum(count for _, count in self.omissions), retentionTruncated=self.truncated_at is not None,
                        segments=[{key: item[key] for key in ("file", "firstSeq", "lastSeq", "closed")} for item in self.segments])
        atomic_json(self.directory / "manifest.json", manifest)
        return manifest

    def tick(self):
        if (self.clock() - self.last_prune).total_seconds() >= 60:
            self.prune()
        if self.active and (self.clock() - self.segments[-1]["opened"]).total_seconds() >= self.segment_seconds:
            self._close_active()
        self.publish()

    def disconnect(self):
        self.status = "disconnected"
        self.publish()

    def close(self):
        if self.lock is None:
            return
        try:
            self._close_active()
            self.disconnect()
        finally:
            os.close(self.lock)
            self.lock = None
