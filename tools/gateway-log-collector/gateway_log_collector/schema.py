"""Closed Layer 1 schema and safe message rendering; standard library only."""
import json
import re
from pathlib import Path

from .sanitize import LOGGERS, POLICY_VERSION, REASONS, ROUTES, valid_id, valid_timestamp

EVENT_KEYS = frozenset(("seq", "timestamp", "level", "logger", "event", "traceId",
                        "spanId", "method", "route", "status", "durationMs", "reason",
                        "message", "policyVersion"))
MANIFEST_KEYS = frozenset(("version", "service", "policyVersion", "generation",
                           "sourceStatus", "heartbeatAt", "lastSourceContactAt",
                           "lastEventAt", "windowStart", "oldestSeq", "headSeq",
                           "omittedCount", "retentionTruncated", "segments"))
SEGMENT_NAME = re.compile(r"seg-(g[0-9a-f]+)-([0-9]{6})\.ndjson")
MAX_SEGMENTS = 512
MAX_MANIFEST_BYTES = 256 * 1024
EVENTS = {"REQUEST_COMPLETED", "UNEXPECTED_ERROR", "JWT_REJECTED",
          "SESSION_UNVERIFIABLE", "LOG_MESSAGE_OMITTED"}


def render(event):
    kind = event["event"]
    if kind == "REQUEST_COMPLETED":
        status = event["status"] if event["status"] is not None else "-"
        return f'{event["method"]} {event["route"]} -> {status} ({event["durationMs"]} ms)'
    if kind == "UNEXPECTED_ERROR":
        return f'UNEXPECTED_ERROR {event["method"]} {event["route"]}'
    if kind == "JWT_REJECTED":
        return f'JWT_REJECTED reason={event["reason"]}'
    return kind


def project(event, seq):
    """Never copy free text or prototype-only fields into the exchange directory."""
    result = {key: event.get(key) for key in EVENT_KEYS}
    result.update(seq=seq, logger=event["logger"].rsplit(".", 1)[-1])
    result["message"] = render(result)
    validate_event(result)
    return result


def integer(value, minimum=0, maximum=None):
    return type(value) is int and value >= minimum and (maximum is None or value <= maximum)


def validate_event(event):
    if set(event) != EVENT_KEYS:
        raise ValueError("Invalid event fields")
    if not integer(event["seq"], 1) or not valid_timestamp(event["timestamp"]):
        raise ValueError("Invalid event position")
    if event["policyVersion"] != POLICY_VERSION or event["level"] not in {"INFO", "WARN", "ERROR"}:
        raise ValueError("Invalid event policy")
    if event["logger"] not in {name.rsplit(".", 1)[-1] for name in LOGGERS} | {"unknown"}:
        raise ValueError("Invalid event logger")
    if event["event"] not in EVENTS:
        raise ValueError("Invalid event kind")
    for key, size in (("traceId", 32), ("spanId", 16)):
        if event[key] is not None and not valid_id(event[key], size):
            raise ValueError("Invalid correlation identifier")
    if event["method"] is not None and event["method"] not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
        raise ValueError("Invalid request method")
    if event["route"] is not None and event["route"] not in {template for _, template in ROUTES} | {"/{unrecognized}"}:
        raise ValueError("Invalid route template")
    if event["status"] is not None and not integer(event["status"], 100, 599):
        raise ValueError("Invalid status")
    if event["durationMs"] is not None and not integer(event["durationMs"], 0, 999999999):
        raise ValueError("Invalid duration")
    if event["reason"] is not None and event["reason"] not in REASONS | {"unclassified"}:
        raise ValueError("Invalid reason")
    required = {"REQUEST_COMPLETED": ("method", "route", "durationMs"),
                "UNEXPECTED_ERROR": ("method", "route"), "JWT_REJECTED": ("reason",)}
    if any(event[key] is None for key in required.get(event["event"], ())):
        raise ValueError("Missing event data")
    if event["message"] != render(event) or len(encode(event)) > 2048:
        raise ValueError("Invalid rendered message")


def encode(value):
    return (json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n").encode()


def complete_events(path):
    """A final partial record is deliberately invisible until completed."""
    with Path(path).open("rb") as source:
        while line := source.readline(2049):
            if not line.endswith(b"\n"):
                if len(line) > 2048:
                    raise ValueError("Oversize stored event")
                return
            event = json.loads(line)
            validate_event(event)
            yield event


def validate_directory(directory):
    directory = Path(directory)
    with (directory / "manifest.json").open("rb") as source:
        payload = source.read(MAX_MANIFEST_BYTES + 1)
    if len(payload) > MAX_MANIFEST_BYTES:
        raise ValueError("Oversize manifest")
    manifest = json.loads(payload)
    if set(manifest) != MANIFEST_KEYS:
        raise ValueError("Invalid manifest fields")
    if len(manifest["segments"]) > MAX_SEGMENTS:
        raise ValueError("Too many manifest segments")
    if manifest["version"] != 1 or manifest["service"] != "api-gateway" or manifest["policyVersion"] != POLICY_VERSION:
        raise ValueError("Invalid manifest policy")
    if not re.fullmatch(r"g[0-9a-f]+", manifest["generation"]):
        raise ValueError("Invalid generation")
    if manifest["sourceStatus"] not in {"starting", "healthy", "disconnected"}:
        raise ValueError("Invalid source status")
    for key in ("heartbeatAt", "windowStart", "lastSourceContactAt", "lastEventAt"):
        if manifest[key] is None and key in {"lastSourceContactAt", "lastEventAt"}:
            continue
        if not valid_timestamp(manifest[key]):
            raise ValueError("Invalid manifest timestamp")
    for key in ("oldestSeq", "headSeq", "omittedCount"):
        if not integer(manifest[key]):
            raise ValueError("Invalid manifest counter")
    if type(manifest["retentionTruncated"]) is not bool:
        raise ValueError("Invalid retention flag")
    first, last, seen = None, 0, set()
    for index, segment in enumerate(manifest["segments"]):
        if set(segment) != {"file", "firstSeq", "lastSeq", "closed"} or type(segment["closed"]) is not bool:
            raise ValueError("Invalid segment fields")
        match = SEGMENT_NAME.fullmatch(segment["file"])
        if not match or match[1] != manifest["generation"] or segment["file"] in seen:
            raise ValueError("Invalid segment name")
        seen.add(segment["file"])
        if not segment["closed"] and index != len(manifest["segments"]) - 1:
            raise ValueError("Open nonfinal segment")
        events = list(complete_events(directory / segment["file"]))
        # A concurrently appended complete line can be ahead of this manifest.
        events = [event for event in events if event["seq"] <= segment["lastSeq"]]
        if not events or events[0]["seq"] != segment["firstSeq"] or events[-1]["seq"] != segment["lastSeq"]:
            raise ValueError("Invalid segment bounds")
        for event in events:
            if event["seq"] <= last:
                raise ValueError("Invalid event sequence")
            first = first or event["seq"]
            last = event["seq"]
    if first is not None and (first != manifest["oldestSeq"] or last != manifest["headSeq"]):
        raise ValueError("Invalid manifest bounds")
    if first is None and manifest["oldestSeq"] != 0:
        raise ValueError("Invalid empty manifest")
    return manifest
