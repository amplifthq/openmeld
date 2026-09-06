"""Synthetic DM previews, scoped to this suite's stable fictional profiles."""
import json
import sqlite3
import uuid

CASES = ["Done. The updated designs are ready for your review.",
         "I reviewed the onboarding flow and left notes about keyboard navigation and focus order.",
         "The release checklist is ready.\nAll regression checks passed.",
         None, "Thanks! I’ll send the next update on Monday."]


def seed(context):
    peers = [context.ident(f"human:{i}") for i in range(4)] + ["agt_" + context.ident(f"agent:{i}") for i in range(2)] + [context.ident("human:4")]
    for i, peer in enumerate(peers):
        result = context.request("gateway", "/v1/organizations/current/dm-space", {"targetProfileId": peer})
        sid = result.get("data", result)["spaceId"]
        if i == 6:
            # Intentionally empty: creation timestamp and no-messages state.
            continue
        path = context.state / "do/openmeld-core-Space" / f"{sid}.sqlite"
        if not path.exists():
            raise RuntimeError(f"The created DM has no local Space database: {sid}")
        profile = context.db.execute("SELECT profile_name,profile_kind FROM openmeld_profiles WHERE profile_id=?", (peer,)).fetchone()
        with sqlite3.connect(path, timeout=30) as db:
            backup = context.backup.parent / f"{context.backup.stem}-dm-{sid}.sqlite"
            with sqlite3.connect(backup) as target:
                db.backup(target)
            for suffix, sender, kind, name, body, ts in [
                ("outgoing", context.human["profile_id"], "human", context.viewer["name"], "Thanks, I’ll take a look.", context.now - i * 86400000),
                ("incoming", peer, profile[1], profile[0], CASES[i % len(CASES)], context.now - i * 86400000 + 1000),
            ]:
                if body is None:
                    continue
                mid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"dm-preview:{sid}:{suffix}"))
                envelope = {"v": 1, "id": mid, "spaceId": sid, "ts": ts,
                            "profile": {"kind": kind, "profileId": sender, "profileName": name},
                            "type": "signal.text", "data": {"text": body}}
                db.execute("INSERT OR REPLACE INTO space_signals (id,ts,type,profile_id,profile_kind,client_message_id,payload_json) VALUES (?,?,?,?,?,?,?)",
                           (mid, ts, "signal.text", sender, kind, mid, json.dumps(envelope)))
