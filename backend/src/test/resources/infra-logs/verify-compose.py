"""Validate the opt-in reader group with Compose config only (no containers)."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ReaderGroupOverlayTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[5]
        self.scratch = tempfile.TemporaryDirectory(prefix="logs-compose-")
        self.addCleanup(self.scratch.cleanup)
        self.env = {
            "PATH": os.environ["PATH"],
            "DOCKER_CONFIG": self.scratch.name,
            "POSTGRES_PASSWORD": "fictional-db-value",
            "HYDRA_DB_PASSWORD": "fictional-hydra-value",
            "HYDRA_SYSTEM_SECRET": "fictional-system-value",
            "SESSION_SECRET": "fictional-session-value-at-least32",
            "COOKIE_SECURE": "false",
            "PUBLIC_BASE_URL": "http://fixture.invalid",
            "TS_AUTHKEY": "fictional-tailnet-value",
            "TS_HOSTNAME": "fictional-backend",
            "INFRA_LOGS_DIR": self.scratch.name,
        }
        self.command = [
            "docker", "compose", "--env-file", "/dev/null",
            "-f", "docker-compose.yml", "-f", "docker-compose.tailscale.yml",
            "-f", "docker-compose.gateway-logs.yml", "config",
        ]

    def config(self, *options):
        return subprocess.run(self.command + list(options), cwd=self.root,
                              env=self.env, capture_output=True, text=True, timeout=30)

    def test_missing_gid_is_rejected(self):
        result = self.config("--quiet")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("set the numeric gid of tpi-log-read", result.stderr)

    def test_empty_gid_is_rejected(self):
        self.env["INFRA_LOGS_GID"] = ""
        self.assertNotEqual(self.config("--quiet").returncode, 0)

    def test_numeric_reader_group_preserves_read_only_mount_and_mesh(self):
        self.env["INFRA_LOGS_GID"] = "43210"
        self.assertEqual(self.config("--quiet").returncode, 0)
        result = self.config("--format", "json")
        self.assertEqual(result.returncode, 0)
        backend = json.loads(result.stdout)["services"]["backend"]
        self.assertIn("43210", backend.get("group_add", []))
        self.assertEqual(backend["network_mode"], "service:mesh")
        self.assertEqual(backend["environment"]["APP_INFRA_LOGS_ENABLED"], "true")
        mounts = [mount for mount in backend["volumes"]
                  if mount["target"] == "/var/lib/tpi-log-view/sanitized"]
        self.assertEqual(len(mounts), 1)
        self.assertTrue(mounts[0]["read_only"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
