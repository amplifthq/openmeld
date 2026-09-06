#!/usr/bin/env python3
"""Seed a shared product fixture into the current worktree's running local lane."""
import argparse
import json
from pathlib import Path

from fixtures.context import Context
from fixtures import people, spaces, messages, sidebar


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["people", "spaces", "messages"],
                        help="Seed one area and its dependencies (default: all).")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    context = Context(root)
    context.bootstrap()
    common = (context.db, context.org, context.viewer, context.human,
              context.now, context.ident, context.insert)
    owners = people.seed(*common)
    runtime_states = []
    if args.only in (None, "spaces"):
        runtime_states = spaces.seed(*common, {"token": context.token}, context.lane["ports"]["gateway"],
                                     f"{context.lane['laneId']}.localhost:{context.lane['ports']['gateway']}")
    if args.only in (None, "messages"):
        messages.seed(context)
    sidebar.seed(context)
    manifest_path = root / "clients/web/scripts/sidebar-preview/runtime-states.generated.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    if manifest.get("organizationId") != context.org["id"]:
        manifest = {}
    manifest.update({"organizationId": context.org["id"], "organizationSlug": context.org["slug"],
                     "profileId": context.human["profile_id"],
                     "agents": [{"profileId": "agt_" + context.ident(f"agent:{i}"),
                                 "state": ["available", "checking", "offline", "connect", "unavailable"][i % 5]} for i in range(42)],
                     "people": [{"profileId": pid, "state": ["connected", "offline", "unconnected", "needs_attention", "unknown"][i % 5]}
                                for i, (_, pid, _) in enumerate(owners[1:])]})
    if args.only in (None, "spaces") or "spaces" not in manifest:
        manifest["spaces"] = runtime_states
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    url = f"http://{context.lane['laneId']}.localhost:{context.lane['ports']['web']}/o/{context.org['slug']}/spaces"
    print(f"Seed complete: {args.only or 'all areas'}\nOpen: {url}\nLocal sign-in: {context.account['email']}\nPassword: {context.account['password']}\nBackup: {context.backup}")
    context.db.close()


if __name__ == "__main__":
    main()
