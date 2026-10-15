#!/usr/bin/env python3
"""Project fixed gateway log formats into safe JSON events (no raw fallback)."""
from collections import Counter
from datetime import datetime, timezone
import json
import re
import sys
from urllib.parse import urlsplit

POLICY_VERSION = "r2-v1"
MAX_LINE_BYTES = 16384
MAX_EVENT_BYTES = 2048
HEADER = re.compile(
    r"^(?:\d{2}:\d{2}:\d{2}\.\d{3})\s+"
    r"(?P<level>TRACE|DEBUG|INFO|WARN|ERROR)\s+"
    r"\[api-gateway,(?P<trace>[^,\]]*),(?P<span>[^,\]]*),(?P<request>[^,\]]*)\]\s+"
    r"(?P<logger>[^\s]+)\s+-\s+(?P<message>.*)$"
)
DOCKER_TIME = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z) (.*)$")
METHOD = r"GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS"
REQUEST = re.compile(rf"(?P<method>{METHOD}) (?P<path>\S+) -> (?P<status>\d{{3}}|-) \((?P<duration>\d{{1,9}}) ms\)")
ERROR = re.compile(rf"UNEXPECTED_ERROR (?P<method>{METHOD}) (?P<path>\S+)")
REASONS = frozenset({"claim-missing", "claim-invalid", "session-superseded", "session-closed", "account-disabled", "account-deleted", "session-unverifiable"})
LOGGERS = frozenset({
    "a.e.u.f.t.p.a.filters.LoggingFilter", "a.e.u.f.t.p.a.w.GatewayErrorHandler",
    "a.e.u.f.t.p.a.f.AssessmentRevocationGuard", "c.n.d.s.r.aws.ConfigClusterResolver",
    "o.s.c.l.core.RoundRobinLoadBalancer", "r.n.http.client.HttpClientConnect",
    "a.e.u.f.t.p.a.security.SessionValidator", "a.e.u.f.t.p.a.security.IssuerValidator",
    "a.e.u.f.t.p.a.f.AccountStateGuard", "a.e.u.f.t.p.a.f.IdentityPropagationFilter",
})
# Prefixes from the platform's registry/services.yml; never learn paths from input.
SERVICE_SEGMENTS = (
    "users", "notifications", "course", "llm", "theoretical-challenge",
    "accounting", "sandbox", "practical-challenge", "engine-challenge",
    "roadmap", "backoffice", "market",
)
# All returned strings are literals. Unknown tails never survive as text.
ROUTES = (
    (re.compile(r"/api/users/profile/[^/]+"), "/api/users/profile/{userId}"),
    (re.compile(r"/api/invitations/(?:accept|redeem)/[^/]+"), "/api/invitations/accept/{token}"),
    (re.compile(r"/api/invitations(?:/.*)?"), "/api/invitations/{path}"),
    (re.compile(r"/actuator/health(?:/.*)?"), "/actuator/health"),
    (re.compile(r"/\.well-known/jwks\.json"), "/.well-known/jwks.json"),
) + tuple((re.compile(r"/api/" + re.escape(segment) + r"(?:/.*)?"), "/api/" + segment + "/{path}") for segment in SERVICE_SEGMENTS)

def route_template(value):
    """Remove URL authority/query/fragment, then return only an approved literal."""
    try:
        path = urlsplit(value).path
    except ValueError:
        return "/{unrecognized}"
    # Encoded and matrix paths are reduced by the same closed catalog; do not decode.
    for pattern, template in ROUTES:
        if pattern.fullmatch(path):
            return template
    return "/{unrecognized}"

def valid_id(value, length):
    return bool(re.fullmatch(rf"[0-9a-fA-F]{{{length}}}", value)) and set(value) != {"0"}

def valid_timestamp(value):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z", value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True

class Sanitizer:
    def __init__(self):
        self.counts = Counter()

    def process_line(self, line, now=None):
        self.counts["input_lines"] += 1
        if len(line.encode("utf-8")) > MAX_LINE_BYTES:
            self.counts["oversize_lines"] += 1
            return None
        line = line.rstrip("\r\n")
        if any(ord(c) < 32 or ord(c) == 127 for c in line):
            self.counts["control_lines"] += 1
            return None
        stamp = None
        t = DOCKER_TIME.fullmatch(line)
        if t:
            if not valid_timestamp(t[1]):
                self.counts["invalid_time"] += 1
                return None
            stamp, line = t[1], t[2]
        m = HEADER.fullmatch(line)
        if not m:
            # Never aggregate or forward stack payloads, including causes and suppressed frames.
            self.counts["continuations_or_unknown"] += 1
            return None
        if m["level"] in {"TRACE", "DEBUG"}:
            self.counts["hidden_level"] += 1
            return None
        event = {"policyVersion": POLICY_VERSION, "service": "api-gateway",
                 "level": m["level"], "logger": m["logger"] if m["logger"] in LOGGERS else "unknown",
                 "event": "LOG_MESSAGE_OMITTED"}
        if stamp:
            event["timestamp"] = stamp
        else:
            event["timestamp"] = (now or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")
            event["timestampSource"] = "collector"
        # These are technical correlation fields. No arbitrary request ID is published.
        if valid_id(m["trace"], 32):
            event["traceId"] = m["trace"]
        if valid_id(m["span"], 16):
            event["spanId"] = m["span"]
        message = m["message"]
        request = REQUEST.fullmatch(message)
        error = ERROR.fullmatch(message)
        if request and m["logger"] == "a.e.u.f.t.p.a.filters.LoggingFilter":
            status = None if request["status"] == "-" else int(request["status"])
            if status is not None and not 100 <= status <= 599:
                self.counts["invalid_status"] += 1
                return None
            event.update(event="REQUEST_COMPLETED", method=request["method"],
                         route=route_template(request["path"]), status=status,
                         durationMs=int(request["duration"]))
        elif error and m["logger"] == "a.e.u.f.t.p.a.w.GatewayErrorHandler":
            event.update(event="UNEXPECTED_ERROR", method=error["method"], route=route_template(error["path"]))
        elif message.startswith("JWT_REJECTED reason=") and event["logger"] != "unknown":
            reason = message.split("reason=", 1)[1].split(" ", 1)[0]
            event["event"] = "JWT_REJECTED"
            event["reason"] = reason if reason in REASONS else "unclassified"
        elif message.startswith("SESSION_UNVERIFIABLE ") and event["logger"] != "unknown":
            event["event"] = "SESSION_UNVERIFIABLE"
        self.counts[event["event"]] += 1
        # Only the schema above can be serialized. No raw value can enter a fallback.
        if len(json.dumps(event, ensure_ascii=True).encode()) > MAX_EVENT_BYTES:
            self.counts["oversize_events"] += 1
            return None
        self.counts["output_events"] += 1
        return event

def run_stream(source, destination, stats=None):
    sanitizer = Sanitizer()
    while True:
        raw = source.readline(MAX_LINE_BYTES + 1)
        if not raw:
            break
        if len(raw) > MAX_LINE_BYTES:
            sanitizer.counts["oversize_lines"] += 1
            # Drain the entire physical line; a suffix must never become a fresh event.
            while raw and not raw.endswith(b"\n"):
                raw = source.readline(MAX_LINE_BYTES + 1)
            continue
        try:
            line = raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            sanitizer.counts["invalid_encoding"] += 1
            continue
        event = sanitizer.process_line(line)
        if event is not None:
            destination.write(json.dumps(event, ensure_ascii=True, separators=(",", ":")) + "\n")
            destination.flush()
    if stats:
        stats.write(json.dumps(dict(sanitizer.counts), sort_keys=True) + "\n")
    return sanitizer

if __name__ == "__main__":
    run_stream(sys.stdin.buffer, sys.stdout, sys.stderr)
