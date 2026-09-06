#!/usr/bin/env python3
"""Seed only synthetic preview messages in existing DMs in an explicit local lane."""
import argparse
import datetime
import json
from pathlib import Path
import sqlite3
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--lane", required=True)
parser.add_argument("--viewer-profile", required=True)
args = parser.parse_args()
if not args.lane.startswith("wt-") or "/" in args.lane or ".." in args.lane:
    raise SystemExit("An isolated wt-* lane is required.")
root = Path(__file__).resolve().parents[2]
state = root / ".wrangler-dev-state" / "isolated" / args.lane / "v3"
paths = [p for p in (state / "d1").glob("*/*.sqlite") if p.name != "metadata.sqlite"]
if len(paths) != 1:
    raise SystemExit("Expected one existing local fixture database.")
db = sqlite3.connect(f"file:{paths[0]}?mode=ro", uri=True)
rows = db.execute("SELECT space_id,direct_message_pair_key FROM space_index_spaces WHERE direct_message_pair_key IS NOT NULL AND (space_purpose IS NULL OR space_purpose != 'center_agent_direct_message') ORDER BY space_id").fetchall()
cases = [(0, "Done. The updated designs are ready for your review."),
         (1, "I reviewed the onboarding flow and left a few notes about keyboard navigation, focus order, and the welcome screen. Let’s walk through them together."),
         (3, "The release checklist is ready.\nAll regression checks passed."),
         (None, None), (7, "Thanks! I’ll send the next update on Monday.")]
now = datetime.datetime.now().astimezone()
index = 0
for sid, pair in rows:
    members = pair.split(":")
    if args.viewer_profile not in members:
        continue
    peer = next(pid for pid in members if pid != args.viewer_profile)
    profile = db.execute("SELECT profile_name,profile_kind FROM openmeld_profiles WHERE profile_id=?", (peer,)).fetchone()
    if not profile or "Center Agent" in profile[0]:
        continue
    path = state / "do/openmeld-core-Space" / f"{sid}.sqlite"
    if not path.exists():
        continue
    days, text = cases[index % len(cases)]
    index += 1
    connection = sqlite3.connect(path, timeout=30)
    backup = root / "dev-tmp" / f"dm-preview-before-{sid}.sqlite"
    if not backup.exists():
        with sqlite3.connect(backup) as target:
            connection.backup(target)
    # Stable IDs update only this script's own fixtures; never erase real messages.
    with connection:
        for suffix, sender, kind, name, body, ts in [
            ("outgoing", args.viewer_profile, "human", "Maya Chen", "Thanks, I’ll take a look.", int(now.timestamp() * 1000)),
            ("incoming", peer, profile[1], profile[0], text,
             int((now - datetime.timedelta(days=days or 0, minutes=15)).timestamp() * 1000)),
        ]:
            if body is None:
                continue
            mid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"dm-preview:{sid}:{suffix}"))
            envelope = {"v": 1, "id": mid, "spaceId": sid, "ts": ts,
                        "profile": {"kind": kind, "profileId": sender, "profileName": name},
                        "type": "signal.text", "data": {"text": body}}
            connection.execute("INSERT OR REPLACE INTO space_signals (id,ts,type,profile_id,profile_kind,client_message_id,payload_json) VALUES (?,?,?,?,?,?,?)",
                               (mid, ts, "signal.text", sender, kind, mid, json.dumps(envelope)))
    print(f"{profile[0]}: {'outgoing only' if days is None else str(days) + ' days ago'}")
    connection.close()
