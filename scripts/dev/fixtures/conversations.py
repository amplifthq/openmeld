"""Small, distinct conversations in fixture-owned local Space databases."""
import json
import sqlite3
import uuid

DAY = 86_400_000
TOPICS = [
    ("Can we narrow the first release to invite links and keyboard navigation?", "Agreed. Mobile polish can follow after we validate the invite flow."),
    ("Please review the focus order in the new navigation.", "I found two missing focus indicators. The proposed changes are ready for review."),
    ("The search response is slow on large workspaces. Can you investigate?", "I reproduced it with 8,000 documents. I’m comparing query plans before changing the index."),
    ("Prepare a release plan. Please wait for approval before publishing.", "The plan covers migration, smoke checks, and rollback. Please review it before I continue."),
    ("Three customers could not find the invite action.", "Two expected it in Members; one looked in the Space menu. Let’s test both entry points."),
    ("Here is the proposed landing page copy:\n\n## Work together\nPeople and agents, in one shared conversation.", "The headline works. Could we replace the second paragraph with one concrete example?"),
    ("Which mobile layouts should we support first?", "Start with 390px and 430px. The composer must stay visible when the keyboard opens."),
    ("Document the pagination contract, including empty pages.", "Use an opaque cursor. An empty result is valid; only a missing next cursor means the list is complete."),
]


def seed(context, sid, index, members):
    path = context.state / "do/openmeld-core-Space" / f"{sid}.sqlite"
    if not path.exists():
        raise RuntimeError(f"Missing fixture Space database: {sid}")
    # A deliberately empty Space, plus today/yesterday/week/older boundaries.
    age = [11 * 60_000, 75 * 60_000, 3 * 3600_000, DAY, 3 * DAY, 8 * DAY, 32 * DAY][index % 7]
    last = context.now - age - index * 71_000
    with sqlite3.connect(path, timeout=30) as db:
        with sqlite3.connect(context.backup.parent / f"{context.backup.stem}-space-{sid}.sqlite") as target:
            db.backup(target)
        if index == 23:
            return
        prompt, answer = TOPICS[index % len(TOPICS)]
        speakers = [context.human["profile_id"], *members]
        count = 480 if index == 0 else 90 if index == 1 else 31 if index == 4 else 3
        texts = []
        for n in range(count):
            question, response = TOPICS[(n // 3) % len(TOPICS)]
            cycle = n // (3 * len(TOPICS)) + 1
            text = [f"Review {cycle}: {question}", response + "\n\nThe next step is to review the proposed change in the complete workflow.\n\n- Check the first attempt from a fresh session.\n- Keep the original reading position when new messages arrive.\n- Record the final decision in this Space.",
                    f"Decision recorded for review {cycle}. We’ll revisit this after the next customer session."][n % 3]
            texts.append(text if count > 3 else [prompt, answer, "I’ll capture the decision here so the next person has the context."][n])
        for n, text in enumerate(texts):
            pid = speakers[n % len(speakers)]
            profile = context.db.execute("SELECT profile_name,profile_kind FROM openmeld_profiles WHERE profile_id=?", (pid,)).fetchone()
            mid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fixture-conversation:{sid}:{n}"))
            ts = last - (count - 1 - n) * (6 * 3600_000 if count > 3 else 180_000)
            envelope = {"v": 1, "id": mid, "spaceId": sid, "ts": ts,
                        "profile": {"kind": profile[1], "profileId": pid, "profileName": profile[0]},
                        "type": "signal.text", "data": {"text": text}}
            db.execute("INSERT OR REPLACE INTO space_signals (id,ts,type,profile_id,profile_kind,client_message_id,payload_json) VALUES (?,?,?,?,?,?,?)",
                       (mid, ts, envelope["type"], pid, profile[1], mid, json.dumps(envelope)))
        if index in (12, 13, 22):
            kind, text = {12: ("terminal_failure", "The billing sandbox did not respond. No changes were applied. Check the connection before retrying."),
                          13: ("wake_stopped", "The investigation was stopped at your request. The notes above are saved."),
                          22: ("policy_blocked", "This Agent does not have permission to access the requested project.")}[index]
            mid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fixture-notice:{sid}"))
            envelope.update({"id": mid, "ts": last + 60_000, "type": "signal.system_notice",
                             "data": {"noticeType": kind, "dispatchId": f"fixture-{mid}", "text": text, "generatedBy": "openmeld"}})
            db.execute("INSERT OR REPLACE INTO space_signals (id,ts,type,profile_id,profile_kind,client_message_id,payload_json) VALUES (?,?,?,?,?,?,?)",
                       (mid, envelope["ts"], envelope["type"], pid, profile[1], mid, json.dumps(envelope)))
