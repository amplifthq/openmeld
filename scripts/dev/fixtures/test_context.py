"""Prove local fixture selection cannot follow another lane or external state."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fixtures.context import current_lane


class LaneSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.registry = self.root / ".git/openmeld-dev/isolated-lanes.json"
        self.registry.parent.mkdir(parents=True)
        self.lane = {"laneId": "wt-fixture", "repoRoot": str(self.root),
                     "stackPid": os.getpid(),
                     "wranglerStateDirectory": str(self.root / ".wrangler-dev-state/isolated/wt-fixture")}

    def read(self):
        self.registry.write_text(json.dumps({"lanes": {"wt-fixture": self.lane}}))
        with patch("fixtures.context.subprocess.check_output", return_value=".git\n"):
            return current_lane(self.root)

    def test_accepts_own_running_lane(self):
        self.assertEqual(self.read(), self.lane)

    def test_rejects_other_worktree(self):
        self.lane["repoRoot"] = str(self.root / "other")
        with self.assertRaisesRegex(RuntimeError, "exact worktree"):
            self.read()

    def test_rejects_external_database(self):
        self.lane["wranglerStateDirectory"] = str(self.root / "other-state")
        with self.assertRaisesRegex(RuntimeError, "belong to this worktree"):
            self.read()

    def test_rejects_path_traversal(self):
        self.lane["laneId"] = "wt-fixture/../../other"
        with self.assertRaisesRegex(RuntimeError, "isolated"):
            self.read()

    def test_rejects_stopped_lane(self):
        self.lane["stackPid"] = None
        with self.assertRaisesRegex(RuntimeError, "dev:worktree"):
            self.read()


if __name__ == "__main__":
    unittest.main()
