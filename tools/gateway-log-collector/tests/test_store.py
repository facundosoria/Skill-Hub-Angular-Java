"""Contract, privacy, retention, and crash/replay behavior using fictional data."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from gateway_log_collector.runtime import Framer
from gateway_log_collector.schema import complete_events, encode, project, validate_directory, validate_event
from gateway_log_collector.store import Store, instant, stamp
from test_sanitize import JWT, line


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 1, 1, 12, 35, tzinfo=timezone.utc)
        self.store = Store(self.root, clock=lambda: self.now)
        self.store.connect("a" * 64)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def send(self, message="GET /actuator/health -> 200 (8 ms)", **kwargs):
        return self.store.process(line(message, **kwargs).encode())

    def manifest(self):
        self.store.publish()
        return validate_directory(self.root)

    def events(self):
        return [event for segment in self.manifest()["segments"]
                for event in complete_events(self.root / segment["file"])]

    def test_exact_contract_and_short_logger_and_render(self):
        self.send()
        event = self.events()[0]
        self.assertEqual("LoggingFilter", event["logger"])
        self.assertEqual("GET /actuator/health -> 200 (8 ms)", event["message"])
        self.assertEqual(1, event["seq"])
        self.assertNotIn("service", event)
        self.assertNotIn("traceparent", event)
        self.assertIsNone(event["reason"])

    def test_zero_correlation_ids_are_omitted_from_stored_events(self):
        self.send(trace="0" * 32, span="0" * 16)
        event = self.events()[0]
        self.assertNotIn("traceId", event)
        self.assertNotIn("spanId", event)

    def test_reject_unknown_stored_fields_and_message(self):
        self.send()
        event = self.events()[0]
        for changes in ({"message": "fictitiousFreeText"}, {"traceparent": "fictitious"},
                        {"route": "/fictitious"}, {"logger": "fictitious"},
                        {"traceId": "secret"}, {"status": True}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_event(dict(event, **changes))

    def test_every_sensitive_catalog_pattern_absent_from_all_outputs(self):
        secrets = [JWT, "fictitiousBearer", "fictitiousAccess", "fictitiousRefresh",
                   "fictional@example.invalid", "11111111-2222-4333-8444-555555555555",
                   "192.0.2.12", "2001:db8::123", "fictitiousInvitation", "fictitiousQuery",
                   "fictitiousStack", "fictitiousRequest", "fictitiousLogger"]
        for secret in secrets:
            self.send("GET /api/users/profile/" + secret + "?token=fictitiousQuery -> 200 (1 ms)")
        for message in ("Authorization: Bearer fictitiousBearer", "Cookie: fu_at=fictitiousAccess; fu_rt=fictitiousRefresh",
                        "Failed to parse " + JWT, "body=fictional@example.invalid"):
            self.send(message)
        self.send("POST /api/invitations/accept/fictitiousInvitation -> 201 (1 ms)")
        self.send("UNEXPECTED_ERROR POST /api/invitations/accept/fictitiousInvitation",
                  logger="a.e.u.f.t.p.a.w.GatewayErrorHandler", level="ERROR")
        for continuation in ("Caused by: fictitiousStack " + JWT, "\tat example(fictional@example.invalid)"):
            self.store.process(("2026-01-01T12:34:56Z " + continuation + "\n").encode())
        self.send("fictitiousFreeText", logger="fictitiousLogger", request="fictitiousRequest")
        self.manifest()
        for path in self.root.rglob("*"):
            if path.is_file():
                content = path.read_text()
                for secret in secrets + ["fictitiousFreeText"]:
                    self.assertNotIn(secret, content)

    def test_rollover_by_bytes(self):
        self.store.segment_bytes = 600
        self.send()
        self.send()
        manifest = self.manifest()
        self.assertEqual(2, len(manifest["segments"]))
        self.assertTrue(manifest["segments"][0]["closed"])
        self.assertFalse(manifest["segments"][1]["closed"])

    def test_rollover_by_ingestion_time_and_idle_close(self):
        self.send()
        self.now += timedelta(seconds=600)
        self.store.tick()
        self.assertTrue(self.manifest()["segments"][0]["closed"])
        self.send()
        self.assertEqual(2, len(self.manifest()["segments"]))

    def test_rollover_historical_source_time(self):
        self.send()
        raw = line("GET /actuator/health -> 200 (9 ms)").replace("12:34:56.123456789Z", "12:20:56.123456789Z")
        self.store.process(raw.encode())
        self.assertEqual(2, len(self.manifest()["segments"]))

    def test_age_retention_runs_while_idle(self):
        self.send()
        self.now += timedelta(hours=6)
        self.store.tick()
        manifest = self.manifest()
        self.assertEqual([], manifest["segments"])
        self.assertEqual([], list(self.root.glob("seg-*")))
        self.assertFalse(manifest["retentionTruncated"])
        self.assertEqual(0, manifest["oldestSeq"])
        self.assertEqual(1, manifest["headSeq"])

    def test_event_retention(self):
        self.store.max_events = 2
        self.store.segment_bytes = 600
        for duration in range(3):
            self.send(f"GET /actuator/health -> 200 ({duration} ms)")
        manifest = self.manifest()
        self.assertEqual([2, 3], [event["seq"] for event in self.events()])
        self.assertTrue(manifest["retentionTruncated"])

    def test_byte_retention(self):
        self.store.max_bytes = 1000
        self.store.segment_bytes = 600
        for duration in range(3):
            self.send(f"GET /actuator/health -> 200 ({duration} ms)")
        self.assertLessEqual(sum(path.stat().st_size for path in self.root.glob("seg-*")), 1000)
        self.assertTrue(self.manifest()["retentionTruncated"])

    def test_out_of_order_segments_are_pruned_to_manifest_segment_limit(self):
        for index in range(514):
            timestamp = "11:35:00Z" if index % 2 else "12:35:00Z"
            raw = line("GET /api/users/fixture-id -> 200 (1 ms)").replace("12:34:56.123456789Z", timestamp)
            self.assertTrue(self.store.process(raw.encode()))
            self.assertLessEqual(len(self.store.segments), 512)
        manifest = self.manifest()
        self.assertEqual(514, manifest["headSeq"])
        self.assertEqual(512, len(manifest["segments"]))
        self.assertEqual(3, manifest["oldestSeq"])
        self.assertTrue(manifest["retentionTruncated"])
        self.assertEqual(512, len(list(self.root.glob("seg-*"))))
        self.assertLessEqual((self.root / "manifest.json").stat().st_size, 256 * 1024)
        generation = manifest["generation"]
        self.store.close()
        self.store = Store(self.root, clock=lambda: self.now)
        self.assertEqual(generation, self.store.generation)
        self.assertEqual(512, len(self.events()))

    def test_manifest_byte_limit_prunes_oldest_segments_and_recovers(self):
        self.store.segment_bytes = 600
        # Fixed-size production metadata hits the segment limit first; lower the
        # byte budget to exercise the independent manifest-size pruning path.
        with patch("gateway_log_collector.store.MAX_MANIFEST_BYTES", 900, create=True):
            for duration in range(5):
                self.send(f"GET /actuator/health -> 200 ({duration} ms)")
            manifest = self.manifest()
            self.assertLessEqual((self.root / "manifest.json").stat().st_size, 900)
            self.assertTrue(manifest["retentionTruncated"])
            self.assertGreater(manifest["oldestSeq"], 1)
            self.assertEqual(5, manifest["headSeq"])
            self.assertEqual(len(manifest["segments"]), len(list(self.root.glob("seg-*"))))
            self.store.close()
            self.store = Store(self.root, clock=lambda: self.now)
            self.assertEqual(manifest["generation"], self.store.generation)
            self.assertTrue(self.manifest()["retentionTruncated"])

    def test_validator_rejects_more_than_512_manifest_segments(self):
        self.send()
        manifest = self.manifest()
        manifest["segments"] *= 513
        (self.root / "manifest.json").write_bytes(encode(manifest))
        with self.assertRaisesRegex(ValueError, "Too many manifest segments"):
            validate_directory(self.root)

    def test_validator_enforces_256_kib_manifest_byte_boundary(self):
        self.send()
        payload = encode(self.manifest())
        path = self.root / "manifest.json"
        path.write_bytes(payload + b" " * (256 * 1024 - len(payload)))
        validate_directory(self.root)
        with path.open("ab") as output:
            output.write(b" ")
        with self.assertRaisesRegex(ValueError, "Oversize manifest"):
            validate_directory(self.root)

    def test_capacity_includes_unadvertised_generations(self):
        self.store.max_events = 2
        self.send()
        self.store.connect("b" * 64)
        self.send()
        self.send()
        self.assertEqual(2, sum(len(list(complete_events(path))) for path in self.root.glob("seg-*")))
        self.assertTrue(self.manifest()["retentionTruncated"])

    def test_atomic_manifest_replacement_failure_keeps_old_valid_manifest(self):
        self.send()
        self.manifest()
        old = (self.root / "manifest.json").read_bytes()
        replace = os.replace

        def fail_manifest(source, target):
            if Path(target).name == "manifest.json":
                raise OSError("Fictional disk failure")
            return replace(source, target)

        with patch("gateway_log_collector.store.os.replace", side_effect=fail_manifest):
            with self.assertRaises(OSError):
                self.store.publish()
        self.assertEqual(old, (self.root / "manifest.json").read_bytes())
        validate_directory(self.root)

    def test_partial_final_line_is_ignored_and_removed_on_restart(self):
        self.send()
        manifest = self.manifest()
        self.store.close()
        path = self.root / manifest["segments"][0]["file"]
        with path.open("ab") as output:
            output.write(b'{"seq":2')
        self.assertEqual(1, len(list(complete_events(path))))
        validate_directory(self.root)
        self.store = Store(self.root, clock=lambda: self.now)
        self.assertTrue(path.read_bytes().endswith(b"\n"))
        self.assertEqual(manifest["generation"], self.store.generation)

    def test_restart_cursor_overlap_and_dedup_preserve_repeated_events(self):
        self.send()
        self.send()
        generation = self.store.generation
        self.store.close()
        self.store = Store(self.root, clock=lambda: self.now)
        since = self.store.connect("a" * 64)
        self.assertEqual(instant("2026-01-01T12:34:54.123456789Z"), instant(since))
        self.assertFalse(self.send())
        self.assertFalse(self.send())
        self.assertTrue(self.send())
        self.assertEqual([1, 2, 3], [event["seq"] for event in self.events()])
        self.assertEqual(generation, self.store.generation)

    def test_stream_identity_and_same_timestamp_multiplicity(self):
        raw = line("GET /actuator/health -> 200 (8 ms)").encode()
        self.store.process(raw, "stdout")
        self.store.process(raw, "stderr")
        self.store.connect("a" * 64)
        self.assertFalse(self.store.process(raw, "stdout"))
        self.assertFalse(self.store.process(raw, "stderr"))
        self.assertEqual(2, len(self.events()))

    def test_skew_beyond_overlap_persists_uncertain_continuity_and_rereads_window(self):
        self.send()
        older = line("GET /actuator/health -> 201 (1 ms)").replace("12:34:56.123456789Z", "11:34:56Z")
        self.assertTrue(self.store.process(older.encode(), "stderr"))
        generation = self.store.generation
        self.assertFalse(self.store.continuous)
        self.store.close()
        self.store = Store(self.root, clock=lambda: self.now)
        since = self.store.connect("a" * 64)
        self.assertEqual(self.now - timedelta(hours=6), instant(since))
        self.assertNotEqual(generation, self.store.generation)
        self.assertEqual([], self.manifest()["segments"])
        self.assertTrue(self.send())
        self.assertEqual(1, self.events()[0]["seq"])

    def test_skew_within_overlap_preserves_generation_and_dedup(self):
        self.send()
        older = line("GET /actuator/health -> 201 (1 ms)").replace("12:34:56.123456789Z", "12:34:54.123456789Z")
        self.assertTrue(self.store.process(older.encode(), "stderr"))
        generation = self.store.generation
        self.assertTrue(self.store.continuous)
        self.store.connect("a" * 64)
        self.assertEqual(generation, self.store.generation)
        self.assertFalse(self.store.process(older.encode(), "stderr"))
        self.assertEqual(2, len(self.events()))

    def test_new_container_new_generation_prior_files_not_advertised(self):
        self.send()
        old_generation = self.store.generation
        old_path = self.root / self.manifest()["segments"][0]["file"]
        self.store.connect("b" * 64)
        self.send()
        manifest = self.manifest()
        self.assertNotEqual(old_generation, manifest["generation"])
        self.assertEqual(1, manifest["headSeq"])
        self.assertTrue(old_path.exists())
        self.assertTrue(all(manifest["generation"] in item["file"] for item in manifest["segments"]))
        self.now += timedelta(hours=6)
        self.store.tick()
        self.assertFalse(old_path.exists())

    def test_corrupt_checkpoint_forces_new_generation(self):
        self.send()
        old_generation = self.store.generation
        self.store.close()
        (self.root / ".state/checkpoint.json").write_text("{}")
        self.store = Store(self.root, clock=lambda: self.now)
        self.store.connect("a" * 64)
        self.assertNotEqual(old_generation, self.store.generation)
        self.assertEqual(0, self.manifest()["headSeq"])

    def test_durable_tail_ahead_of_checkpoint_forces_new_generation(self):
        self.send()
        manifest = self.manifest()
        event = self.events()[0]
        self.store.close()
        event["seq"] = 2
        with (self.root / manifest["segments"][0]["file"]).open("ab") as output:
            output.write(encode(event))
        self.store = Store(self.root, clock=lambda: self.now)
        self.assertNotEqual(manifest["generation"], self.store.generation)

    def test_stale_cursor_and_replay_capacity_force_new_generation(self):
        self.send()
        old = self.store.generation
        self.now += timedelta(hours=7)
        self.store.connect("a" * 64)
        self.assertNotEqual(old, self.store.generation)
        old = self.store.generation
        self.store.continuous = False
        self.store.connect("a" * 64)
        self.assertNotEqual(old, self.store.generation)

    def test_future_and_invalid_time_do_not_prolong_retention(self):
        for timestamp in ("2099-01-01T12:34:56Z", "2026-99-99T12:34:56Z"):
            self.assertFalse(self.store.process(line("GET /actuator/health -> 200 (1 ms)").replace("2026-01-01T12:34:56.123456789Z", timestamp).encode()))
        self.assertEqual([], self.events())

    def test_permissions_and_heartbeat_without_events(self):
        self.now += timedelta(seconds=15)
        self.store.tick()
        manifest = self.manifest()
        self.assertEqual(stamp(self.now), manifest["heartbeatAt"])
        self.assertIsNone(manifest["lastEventAt"])
        self.assertEqual(0o750, self.root.stat().st_mode & 0o777)
        self.assertEqual(0o640, (self.root / "manifest.json").stat().st_mode & 0o777)
        self.assertEqual(0o600, (self.root / ".state/checkpoint.json").stat().st_mode & 0o777)
        self.send()
        self.assertEqual(0o640, (self.root / self.manifest()["segments"][0]["file"]).stat().st_mode & 0o777)

    def test_disconnected_preserves_history(self):
        self.send()
        self.store.disconnect()
        self.assertEqual("disconnected", self.manifest()["sourceStatus"])
        self.assertEqual(1, len(self.events()))

    def test_exclusive_writer_lock(self):
        with self.assertRaises(OSError):
            Store(self.root, clock=lambda: self.now)
        self.send()
        self.assertEqual(1, len(self.events()))

    def test_uppercase_correlation_is_preserved(self):
        self.send(trace="ABCDEF1234567890ABCDEF1234567890", span="ABCDEF1234567890")
        event = self.events()[0]
        self.assertEqual("ABCDEF1234567890ABCDEF1234567890", event["traceId"])
        self.assertEqual("ABCDEF1234567890", event["spanId"])

    def test_replay_maps_are_bounded_without_dropping_live_events(self):
        with patch("gateway_log_collector.store.REPLAY_KEYS", 4):
            for duration in range(20):
                self.send(f"GET /actuator/health -> 200 ({duration} ms)")
            self.assertLessEqual(len(self.store.keys), 4)
            self.assertLessEqual(len(self.store.ordinals), 4)
            self.assertFalse(self.store.continuous)
            self.assertEqual(20, len(self.events()))
            old = self.store.generation
            self.store.connect("a" * 64)
            self.assertNotEqual(old, self.store.generation)

    def test_replay_keys_age_out_as_the_source_advances(self):
        self.send()
        later = line("GET /actuator/health -> 200 (9 ms)").replace("12:34:56.123456789Z", "12:35:00.123456789Z")
        self.store.process(later.encode())
        self.assertEqual(1, len(self.store.keys))
        self.assertEqual(1, len(self.store.ordinals))

    def test_expiring_out_of_order_segment_keeps_monotonic_sequence(self):
        self.store.segment_bytes = 600
        for timestamp in ("12:30:00Z", "12:20:00Z", "12:34:00Z"):
            raw = line("GET /actuator/health -> 200 (1 ms)").replace("12:34:56.123456789Z", timestamp)
            self.store.process(raw.encode())
        self.now = datetime(2026, 1, 1, 18, 25, tzinfo=timezone.utc)
        self.store.tick()
        self.assertEqual([1, 3], [event["seq"] for event in self.events()])

    def test_capacity_flag_and_omissions_expire(self):
        self.store.max_events = 0
        self.send("Cookie: fu_at=fictitiousCookie")
        self.assertTrue(self.manifest()["retentionTruncated"])
        self.assertEqual(1, self.manifest()["omittedCount"])
        self.now += timedelta(hours=6, minutes=1)
        self.store.tick()
        self.assertFalse(self.manifest()["retentionTruncated"])
        self.assertEqual(0, self.manifest()["omittedCount"])


class FramingTests(unittest.TestCase):
    def test_partial_lines_and_oversize_suffix_draining(self):
        framer = Framer()
        self.assertEqual([], framer.feed(b"part"))
        self.assertEqual([b"partial\n"], framer.feed(b"ial\n"))
        self.assertEqual([None], framer.feed(b"x" * 17000))
        self.assertEqual([b"safe\n"], framer.feed(b"fake header\nsafe\n"))

    def test_carriage_return_controls_do_not_split_physical_line(self):
        self.assertEqual([b"one\rtwo\vthree\n"], Framer().feed(b"one\rtwo\vthree\n"))

    def test_complete_valid_line_after_oversize_line(self):
        self.assertEqual([None, b"valid\n"], Framer().feed(b"x" * 17000 + b"\nvalid\n"))


class FixtureTests(unittest.TestCase):
    def test_shared_fixture_validates_with_two_segments(self):
        root = Path(__file__).resolve().parents[1] / "fixtures/example"
        self.assertEqual(2, len(validate_directory(root)["segments"]))
