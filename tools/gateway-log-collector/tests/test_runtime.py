"""Exercise the actual two-process CLI against a fictional live Docker executable."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import socket
import threading
from unittest.mock import patch

from gateway_log_collector.runtime import follow, read_source

from gateway_log_collector.schema import complete_events, validate_directory
from gateway_log_collector.store import instant

ROOT = Path(__file__).resolve().parents[1]


def wait_until(predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("Fictional collector condition timed out")


class RuntimeTests(unittest.TestCase):
    def start(self, *args, env):
        process = subprocess.Popen([sys.executable, "-B", "-m", "gateway_log_collector", *args],
                                   env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.processes.append(process)
        return process

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.output = self.directory / "sanitized"
        self.socket = self.directory / "source.sock"
        self.env = dict(os.environ, PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1",
                        FAKE_DOCKER_STATE=str(self.directory), FAKE_DOCKER_FAILURES="0",
                        FAKE_DOCKER_HOLD="0.1")
        self.processes = []

    def tearDown(self):
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
            try:
                process.communicate(timeout=7)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
        self.temp.cleanup()

    def writer(self):
        writer = self.start("writer", "--out-dir", str(self.output), "--socket", str(self.socket), env=self.env)
        wait_until(self.socket.exists)
        return writer

    def reader(self):
        return self.start("reader", "--socket", str(self.socket), "--docker", str(ROOT / "fixtures/fake-docker.py"), env=self.env)

    def current(self):
        return json.loads((self.output / "manifest.json").read_text())

    def test_live_simulator_reconnection_restart_and_clean_sigterm(self):
        writer = self.writer()
        reader = self.reader()
        wait_until(lambda: self.current()["headSeq"] == 4)
        generation = self.current()["generation"]
        wait_until(lambda: int((self.directory / "attempts").read_text()) >= 2)
        reader.terminate()
        self.assertEqual((b"", b""), reader.communicate(timeout=7))
        self.assertEqual(0, reader.returncode)
        wait_until(lambda: self.current()["sourceStatus"] == "disconnected")
        manifest = validate_directory(self.output)
        self.assertEqual(4, manifest["headSeq"])
        self.assertGreaterEqual(manifest["omittedCount"], 1)
        writer.terminate()
        self.assertEqual((b"", b""), writer.communicate(timeout=7))
        self.assertEqual(0, writer.returncode)
        self.writer()
        self.reader()
        wait_until(lambda: int((self.directory / "attempts").read_text()) >= 3)
        time.sleep(0.5)
        self.assertEqual(generation, self.current()["generation"])
        self.assertEqual(4, self.current()["headSeq"])
        self.assertAlmostEqual(2, (instant((self.directory / "timestamp").read_text()) -
                                   instant((self.directory / "last-since").read_text())).total_seconds(), places=3)
        events = [event for item in validate_directory(self.output)["segments"]
                  for event in complete_events(self.output / item["file"])]
        self.assertEqual([1, 2, 3, 4], [event["seq"] for event in events])
        self.assertEqual(503, events[-1]["status"])

    def test_docker_failure_marks_disconnected_then_recovers_with_backoff(self):
        self.env["FAKE_DOCKER_FAILURES"] = "2"
        self.writer()
        self.reader()
        wait_until(lambda: self.current()["sourceStatus"] == "disconnected")
        self.assertEqual(0, self.current()["headSeq"])
        start = time.monotonic()
        wait_until(lambda: self.current()["headSeq"] == 4)
        self.assertGreaterEqual(time.monotonic() - start, 2.5)
        self.assertGreaterEqual(int((self.directory / "attempts").read_text()), 3)
        validate_directory(self.output)

    def test_cold_start_requests_full_six_hour_window(self):
        before = datetime.now(timezone.utc)
        self.writer()
        self.reader()
        wait_until(lambda: (self.directory / "last-since").exists())
        since = instant((self.directory / "last-since").read_text())
        self.assertGreaterEqual(since, before - timedelta(hours=6))
        self.assertLess(since, before - timedelta(hours=6) + timedelta(seconds=3))

    def test_skewed_stream_reconnect_rereads_all_three_source_records(self):
        self.env["V1_SOURCE_STATE"] = str(self.directory)
        self.writer()
        reader = self.start("reader", "--socket", str(self.socket), "--docker",
                            str(ROOT / "fixtures/fake-skew-docker.py"), env=self.env)
        wait_until(lambda: self.current()["headSeq"] == 2)
        generation = self.current()["generation"]
        wait_until(lambda: int((self.directory / "attempt").read_text()) >= 2)
        time.sleep(0.3)
        reader.terminate()
        self.assertEqual((b"", b""), reader.communicate(timeout=7))
        wait_until(lambda: self.current()["sourceStatus"] == "disconnected")
        manifest = validate_directory(self.output)
        entries = [event for item in manifest["segments"]
                   for event in complete_events(self.output / item["file"])]
        self.assertEqual([200, 201, 202], sorted(event["status"] for event in entries))
        self.assertNotEqual(generation, manifest["generation"])
        self.assertEqual([1, 2, 3], [event["seq"] for event in entries])
        self.assertTrue(all(manifest["generation"] in item["file"] for item in manifest["segments"]))

    def test_inspection_failure_still_marks_disconnected(self):
        self.writer()
        self.start("reader", "--socket", str(self.socket), "--docker", "/bin/false", env=self.env)
        wait_until(lambda: self.current()["sourceStatus"] == "disconnected")
        self.assertEqual(0, self.current()["headSeq"])

    def test_stalled_writer_bounds_source_queue_and_drains_both_streams(self):
        self.env["FAKE_DOCKER_FLOOD"] = "1"
        source, sink = socket.socketpair()
        try:
            with patch.dict(os.environ, self.env):
                with self.assertRaises(OSError):
                    follow(str(ROOT / "fixtures/fake-docker.py"), "api-gateway", "a" * 64,
                           source, "2026-01-01T00:00:00Z", threading.Event())
        finally:
            source.close()
            sink.close()

    def test_exponential_backoff_is_capped_at_thirty_seconds(self):
        class Stop:
            def __init__(self):
                self.delays = []

            def is_set(self):
                return False

            def wait(self, seconds):
                self.delays.append(seconds)
                return len(self.delays) >= 7

        stop = Stop()
        with patch("gateway_log_collector.runtime.socket.socket", side_effect=OSError("Fictional pipe failure")):
            read_source(self.socket, stop=stop)
        self.assertEqual([1, 2, 4, 8, 16, 30, 30], stop.delays)
