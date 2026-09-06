"""Local-only fixture context. Never accepts a remote URL or arbitrary DB path."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import uuid

VIEWER = {"name": "Maya Chen", "email": "maya.chen@example.com",
          "password": "LocalSidebar-47!Preview"}
ORGANIZATION = "Northstar Product Studio"


def current_lane(root):
    common = subprocess.check_output(
        ["git", "rev-parse", "--git-common-dir"], cwd=root, text=True).strip()
    registry = (root / common).resolve() / "openmeld-dev/isolated-lanes.json"
    if not registry.exists():
        raise RuntimeError("Start this worktree with pnpm dev:worktree first.")
    lanes = json.loads(registry.read_text())["lanes"].values()
    matches = [lane for lane in lanes if Path(lane["repoRoot"]).resolve() == root]
    if len(matches) != 1:
        raise RuntimeError("Expected one running lane for this exact worktree.")
    lane = matches[0]
    if not lane["laneId"].startswith("wt-") or Path(lane["laneId"]).name != lane["laneId"]:
        raise RuntimeError("Only an isolated wt-* development lane can be seeded.")
    if not isinstance(lane.get("stackPid"), int) or lane["stackPid"] <= 0:
        raise RuntimeError("Start this worktree with pnpm dev:worktree first.")
    os.kill(lane["stackPid"], 0)
    expected = root / ".wrangler-dev-state/isolated" / lane["laneId"]
    if Path(lane["wranglerStateDirectory"]).resolve() != expected:
        raise RuntimeError("The lane database must belong to this worktree.")
    return lane


class Context:
    def __init__(self, root):
        self.root = root
        self.lane = current_lane(root)
        self.now = int(time.time() * 1000)
        self.state = root / ".wrangler-dev-state/isolated" / self.lane["laneId"] / "v3"
        paths = [p for p in (self.state / "d1").glob("*/*.sqlite") if p.name != "metadata.sqlite"]
        if len(paths) != 1:
            raise RuntimeError("Wait for the local Worker stack and database migrations to finish.")
        if not paths[0].resolve().is_relative_to(self.state):
            raise RuntimeError("Refusing a database outside this worktree's local state.")
        self.db = sqlite3.connect(paths[0], timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.backup = root / "dev-tmp" / f"before-dev-seed-{time.time_ns()}.sqlite"
        self.backup.parent.mkdir(exist_ok=True)
        with sqlite3.connect(self.backup) as target:
            self.db.backup(target)
        self.token = None

    def request(self, service, path, data=None, method=None):
        port = self.lane["ports"][service]
        if not isinstance(port, int) or not 1024 <= port <= 65535:
            raise RuntimeError("Invalid local lane port.")
        origin = f"http://{self.lane['laneId']}.localhost:{self.lane['ports']['web']}"
        headers = {"Content-Type": "application/json", "Origin": origin}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        if service == "gateway":
            headers.update({"x-openmeld-profile-id": self.human["profile_id"],
                            "x-openmeld-requested-organization-id": self.org["id"]})
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                  data=json.dumps(data).encode() if data is not None else None,
                  headers=headers, method=method or ("POST" if data is not None else "GET"))
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    def bootstrap(self):
        viewer = self.db.execute("SELECT * FROM users WHERE email=?", (VIEWER["email"],)).fetchone()
        if not viewer:
            self.request("auth", "/api/auth/sign-up/email", VIEWER)
            viewer = self.db.execute("SELECT * FROM users WHERE email=?", (VIEWER["email"],)).fetchone()
        if not viewer or viewer["name"] != VIEWER["name"]:
            raise RuntimeError("The fixture email is already used by another local account.")
        # Local fixture email only: no email delivery or production verification bypass.
        with self.db:
            self.db.execute("UPDATE users SET email_verified=1 WHERE id=?", (viewer["id"],))
        result = self.request("auth", "/api/auth/sign-in/email",
                              {"email": VIEWER["email"], "password": VIEWER["password"]})
        self.token = result["token"]
        self.viewer = viewer
        self.human = self.db.execute(
            "SELECT * FROM openmeld_profiles WHERE owner_user_id=? AND is_default=1",
            (viewer["id"],)).fetchone()
        self.org = self.db.execute(
            "SELECT o.* FROM organizations o JOIN members m ON m.organization_id=o.id "
            "WHERE m.user_id=? AND m.role='owner' AND o.name=?",
            (viewer["id"], ORGANIZATION)).fetchone()
        if not self.org:
            result = self.request("auth", "/api/auth/organization/create", {"name": ORGANIZATION})
            self.org = self.db.execute("SELECT * FROM organizations WHERE id=?", (result["id"],)).fetchone()
        if not self.human or not self.org:
            raise RuntimeError("Fixture account bootstrap did not create a Human Profile and Organization.")

    def ident(self, key):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"openmeld-sidebar-fixture:{self.org['id']}:{key}"))

    def insert(self, table, **row):
        columns = ",".join('"' + key + '"' for key in row)
        self.db.execute(f'INSERT OR IGNORE INTO "{table}" ({columns}) VALUES ({",".join("?" for _ in row)})', tuple(row.values()))
