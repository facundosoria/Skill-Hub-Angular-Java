"""Synthetic fixtures only: production payloads must never be written here."""
from datetime import datetime, timezone
import io
import json
import unittest

from gateway_log_collector.sanitize import MAX_LINE_BYTES, Sanitizer, route_template, run_stream

TRACE = "1234567890abcdef1234567890abcdef"
SPAN = "1234567890abcdef"
REQUEST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaWN0aW9uYWwifQ.c3ludGhldGljU2lnbmF0dXJl"
JWE = "eyJhbGciOiJkaXIifQ.c3ludGhldGlj.aXZmaWN0aW9u.Y2lwaGVydGV4dA.dGFnZmljdGlvbg"
NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)

def line(message, logger="a.e.u.f.t.p.a.filters.LoggingFilter", level="INFO", trace=TRACE, span=SPAN, request=REQUEST_ID):
    return f"2026-01-01T12:34:56.123456789Z 12:34:56.123 {level:>5} [api-gateway,{trace},{span},{request}] {logger} - {message}\n"

class SanitizerTests(unittest.TestCase):
    def event(self, message, **kwargs):
        event = Sanitizer().process_line(line(message, **kwargs), now=NOW)
        self.assertIsNotNone(event)
        return event

    def assert_hidden(self, event, *secrets):
        serialized = json.dumps(event)
        for secret in secrets:
            self.assertNotIn(secret, serialized)
        self.assertNotIn("message", event)
        self.assertNotIn("requestId", event)

    def test_safe_request_fields_and_correlation(self):
        event = self.event("GET /api/users/profile/sample-person -> 200 (17 ms)")
        self.assertEqual("REQUEST_COMPLETED", event["event"])
        self.assertEqual("/api/users/profile/{userId}", event["route"])
        self.assertEqual(("GET", 200, 17), (event["method"], event["status"], event["durationMs"]))
        self.assertEqual((TRACE, SPAN), (event["traceId"], event["spanId"]))
        self.assertEqual("2026-01-01T12:34:56.123456789Z", event["timestamp"])
        self.assert_hidden(event, "sample-person", REQUEST_ID)

    def test_fu_at_cookie(self):
        self.assert_hidden(self.event("Cookie: fu_at=fictitiousCookie; theme=dark"), "fictitiousCookie")

    def test_multiple_and_set_cookies(self):
        self.assert_hidden(self.event("Set-Cookie: skillhub_session=fictitiousSession; fu_rt=fictitiousRefresh"), "fictitiousSession", "fictitiousRefresh")

    def test_authorization_bearer(self):
        self.assert_hidden(self.event("Authorization: Bearer " + JWT), JWT)

    def test_basic_and_proxy_authorization(self):
        self.assert_hidden(self.event("Proxy-Authorization: Basic ZmljdGl0aW91czpmb28="), "ZmljdGl0aW91czpmb28=")

    def test_standalone_jwt(self):
        self.assert_hidden(self.event("Failed to parse token " + JWT), JWT)

    def test_jwe(self):
        self.assert_hidden(self.event("Token " + JWE), JWE)

    def test_email_and_encoded_email_in_path(self):
        for address in ("fictional@example.invalid", "fictional%40example.invalid", "fictional%2540example.invalid"):
            with self.subTest(address=address):
                self.assert_hidden(self.event(f"GET /api/users/profile/{address} -> 200 (1 ms)"), address)

    def test_uuid_user_in_path(self):
        person = "11111111-2222-4333-8444-555555555555"
        self.assert_hidden(self.event(f"GET /api/users/profile/{person} -> 200 (2 ms)"), person)

    def test_subject_actor_session_attempt_identifiers(self):
        event = self.event("JWT_REJECTED reason=session-closed sub=fictitiousUser actor=fictitiousActor sid=fictitiousSession aid=fictitiousAttempt", logger="a.e.u.f.t.p.a.security.SessionValidator", level="WARN")
        self.assertEqual("session-closed", event["reason"])
        self.assert_hidden(event, "fictitiousUser", "fictitiousActor", "fictitiousSession", "fictitiousAttempt")

    def test_ipv4_and_ipv6(self):
        for ip in ("192.0.2.12", "2001:db8::123", "[2001:db8::124]"):
            with self.subTest(ip=ip):
                self.assert_hidden(self.event(f"GET /api/users/profile/{ip} -> 200 (3 ms)"), ip)

    def test_invitation_token_in_path(self):
        event = self.event("POST /api/invitations/accept/fictitiousInvitationSecret -> 201 (4 ms)")
        self.assertEqual("/api/invitations/accept/{token}", event["route"])
        self.assert_hidden(event, "fictitiousInvitationSecret")

    def test_opaque_and_numeric_path_identifiers(self):
        for path in ("/api/users/983712", "/api/users/unlabeledOpaqueSecret", "/api/users/profile/983713;token=fictitiousMatrixToken"):
            with self.subTest(path=path):
                event = self.event(f"GET {path} -> 200 (1 ms)")
                self.assert_hidden(event, "983712", "unlabeledOpaqueSecret", "983713", "fictitiousMatrixToken")

    def test_query_and_fragment(self):
        event = self.event("GET /api/users/profile/sample?token=fictitiousQuery&email=fictional%40example.invalid#fictitiousFragment -> 200 (5 ms)")
        self.assertEqual("/api/users/profile/{userId}", event["route"])
        self.assert_hidden(event, "fictitiousQuery", "fictional", "fictitiousFragment")

    def test_url_authority(self):
        event = self.event("GET https://sample:fictitiousPassword@192.0.2.17/api/users/profile/sample?token=fictitiousQuery -> 200 (6 ms)")
        self.assert_hidden(event, "fictitiousPassword", "192.0.2.17", "fictitiousQuery")

    def test_json_body_and_password(self):
        self.assert_hidden(self.event('body={"password":"fictitiousPassword","email":"fictional@example.invalid","token":"' + JWT + '"}'), "fictitiousPassword", "fictional@example.invalid", JWT)

    def test_client_secret_key_and_reset_tokens(self):
        self.assert_hidden(self.event("client_secret=fictitiousClientSecret api_key=fictitiousApiKey reset_token=fictitiousReset"), "fictitiousClientSecret", "fictitiousApiKey", "fictitiousReset")

    def test_request_id_can_contain_secret_and_is_dropped(self):
        event = self.event("GET /actuator/health -> 200 (7 ms)", request="fictitiousRequestSecret")
        self.assert_hidden(event, "fictitiousRequestSecret")

    def test_invalid_correlation_ids_are_not_passed(self):
        event = self.event("GET /actuator/health -> 200 (7 ms)", trace="fictitiousTraceSecret", span="fictitiousSpanSecret")
        self.assertNotIn("traceId", event)
        self.assertNotIn("spanId", event)
        self.assert_hidden(event, "fictitiousTraceSecret", "fictitiousSpanSecret")

    def test_zero_correlation_ids_are_rejected(self):
        event = self.event("GET /actuator/health -> 200 (7 ms)", trace="0"*32, span="0"*16)
        self.assertNotIn("traceId", event)
        self.assertNotIn("spanId", event)

    def test_error_multiline_is_summary_only(self):
        sanitizer = Sanitizer()
        event = sanitizer.process_line(line("UNEXPECTED_ERROR GET /api/users/profile/fictitiousPerson", logger="a.e.u.f.t.p.a.w.GatewayErrorHandler", level="ERROR"))
        self.assertEqual("UNEXPECTED_ERROR", event["event"])
        self.assert_hidden(event, "fictitiousPerson")
        for continuation in ("java.lang.Exception: Cookie: fu_at=fictitiousStackSecret", "\tat java.lang.Thread.run(Thread.java:1)", "Caused by: java.lang.Exception: " + JWT, "Suppressed: Authorization: Bearer fictitiousSuppressed"):
            self.assertIsNone(sanitizer.process_line(continuation))

    def test_unknown_route_logger_reason_do_not_leak(self):
        self.assertEqual("/{unrecognized}", route_template("/fictitiousSecretPath"))
        event = self.event("unclassified fictitiousBody", logger="fictitiousLoggerSecret")
        self.assertEqual("unknown", event["logger"])
        self.assert_hidden(event, "fictitiousLoggerSecret", "fictitiousBody")
        event = self.event("JWT_REJECTED reason=fictitiousReasonSecret", logger="a.e.u.f.t.p.a.security.SessionValidator")
        self.assertEqual("unclassified", event["reason"])
        self.assert_hidden(event, "fictitiousReasonSecret")

    def test_controls_debug_trace_and_invalid_timestamp(self):
        sanitizer = Sanitizer()
        self.assertIsNone(sanitizer.process_line(line("Cookie: fu_at=secret\x1b[31m")))
        self.assertIsNone(sanitizer.process_line(line("safe", level="DEBUG")))
        self.assertIsNone(sanitizer.process_line(line("safe", level="TRACE")))
        self.assertIsNone(sanitizer.process_line(line("safe").replace("2026-01-01", "2026-99-99")))

    def test_oversize_line_drains_suffix_and_invalid_utf8(self):
        dangerous = b"x" * (MAX_LINE_BYTES + 3) + line("GET /actuator/health -> 200 (8 ms)").encode()
        source = io.BytesIO(dangerous + b"\xff\n" + line("GET /actuator/health -> 200 (9 ms)").encode())
        out, stats = io.StringIO(), io.StringIO()
        run_stream(source, out, stats)
        events = [json.loads(s) for s in out.getvalue().splitlines()]
        self.assertEqual(1, len(events))
        self.assertEqual(9, events[0]["durationMs"])
        self.assertEqual(1, json.loads(stats.getvalue())["oversize_lines"])
        self.assertEqual(1, json.loads(stats.getvalue())["invalid_encoding"])

    def test_whole_match_prevents_appended_payload(self):
        event = self.event("GET /actuator/health -> 200 (8 ms) Cookie: fu_at=fictitiousAppend")
        self.assertEqual("LOG_MESSAGE_OMITTED", event["event"])
        self.assert_hidden(event, "fictitiousAppend")

    def test_missing_status_and_invalid_status(self):
        self.assertIsNone(self.event("GET /actuator/health -> - (8 ms)")["status"])
        self.assertIsNone(Sanitizer().process_line(line("GET /actuator/health -> 999 (8 ms)")))

if __name__ == "__main__":
    unittest.main(verbosity=2)
