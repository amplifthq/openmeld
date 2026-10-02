"""Repeatable Inbox browsing data, backed by real local Space messages and Threads.

This prepares fictional data only; it never starts Agent work or fakes runtime state.
"""
import json
import sqlite3


def seed(context):
    db, now = context.db, context.now
    spaces = db.execute(
        "SELECT space_id,space_name FROM space_index_spaces WHERE organization_id=? AND space_name IN ('Release coordination','Design feedback','API design')",
        (context.org["id"],),
    ).fetchall()
    for space_index, space in enumerate(spaces):
        sid, name = space["space_id"], space["space_name"]
        speakers = db.execute("SELECT profile_id,profile_kind_snapshot,profile_name_snapshot FROM space_index_memberships WHERE space_id=? AND status='active' ORDER BY profile_id", (sid,)).fetchall()
        path = context.state / "do/openmeld-core-Space" / f"{sid}.sqlite"
        with sqlite3.connect(path, timeout=30) as source:
            with sqlite3.connect(context.backup.parent / f"{context.backup.stem}-inbox-{sid}.sqlite") as backup:
                source.backup(backup)
            for thread_index, topic in enumerate([
                "Release checklist and rollback plan",
                "Keyboard navigation and focus order",
                "Search performance on large workspaces",
                "Customer feedback on onboarding",
                "API pagination and empty results",
                "Accessibility review",
                "Documentation updates",
                "Mobile layout",
                "Follow-up questions",
            ]):
                root = context.ident(f"inbox-root:{sid}:{thread_index}")
                thread = "thr_" + context.ident(f"inbox-thread:{sid}:{thread_index}")
                speaker = speakers[thread_index % len(speakers)]
                speaker_name = speaker["profile_name_snapshot"]
                agent = speaker["profile_kind_snapshot"] == "agent"
                created = now - 86_400_000 - thread_index * 60000
                _signal(source, speaker, sid, root, created, topic)
                source.execute(
                    "INSERT OR REPLACE INTO space_threads VALUES (?,?,?,?,?,?)",
                    (thread, sid, root, speaker["profile_id"], created, now),
                )
                source.execute("INSERT OR REPLACE INTO space_thread_signal_placements VALUES (?,?,?,?)",
                               (root, thread, "root", created))
                count = 110 if thread_index == 0 else 4
                for index in range(count):
                    mid = context.ident(f"inbox-reply:{sid}:{thread_index}:{index}")
                    ts = now - (space_index * 30 + thread_index * 5 + count - index) * 60000
                    text = f"{topic}: update {index + 1}. The notes are ready to discuss with the team."
                    if index == count - 1:
                        text = f"{topic}: the proposed changes are ready. Please review the notes before the next team meeting."
                    _signal(source, speaker, sid, mid, ts, text, root)
                    source.execute("INSERT OR REPLACE INTO space_thread_signal_placements VALUES (?,?,?,?)",
                                   (mid, thread, "thread", ts))
                    target = {"kind": "space", "spaceId": sid, "signalId": mid, "threadRootSignalId": root}
                    mention = thread_index == 1 and index == count - 1
                    _item(context, f"reply:{sid}:{thread_index}:{index}", {
                        "kind": "space_mention" if mention else ("agent_reply" if agent else "space_message"),
                        "title": f"{speaker_name} mentioned you in {name}" if mention else f"{speaker_name} replied in {name}",
                        "preview": text, "context_label": name, "source_kind": "space_signal",
                        "source_target_json": json.dumps(target),
                        "source_facts_json": json.dumps({"version": 1, "recipientReasons": ["human_mention" if mention else "thread_reply"]}),
                        "occurred_at_ms": ts,
                        "read_at_ms": now if index < count - 3 else None,
                    })
    for index in range(12):
        _item(context, f"desktop:{index}", {
            "organization_id": None, "kind": "desktop_update",
            "title": f"OpenMeld 0.1.{index + 10} installed",
            "preview": "Desktop on Studio Mac confirmed the installed version.",
            "context_label": "Studio Mac", "source_kind": "desktop_update",
            "source_target_json": json.dumps({
                "kind": "desktop_update", "installationId": context.ident("inbox-installation"),
                "lane": "dev-local", "deviceName": "Studio Mac", "version": f"0.1.{index + 10}",
                "platform": "darwin", "state": "installed",
            }),
            "occurred_at_ms": now - index * 3600000,
        })
    # Ordinary source-linked requests: no fabricated live execution or Wake facts.
    for category, title, preview in [
        ("action", "Check the build computer connection", "The last connection check needs your attention. Open Computers to inspect the device."),
        ("review", "Review notification preferences", "Review which conversations should notify you before enabling notifications on this computer."),
    ]:
        _item(context, f"request:{category}", {
            "kind": "system_issue", "attention": "action_required", "resolution_status": "open",
            "title": title, "preview": preview, "context_label": "Workspace setup",
            "source_kind": "system_attention_event",
            "source_target_json": json.dumps({"kind": "settings", "section": "computers" if category == "action" else "notifications"}),
            "source_facts_json": json.dumps({"version": 1, "recipientReasons": ["requester"], "requestCategory": category}),
        })
    db.commit()


def _signal(db, speaker, sid, mid, ts, text, root=None):
    profile = {"kind": speaker["profile_kind_snapshot"], "profileId": speaker["profile_id"], "profileName": speaker["profile_name_snapshot"]}
    data = {"text": text}
    if root:
        data["messageEnvelope"] = {"activationTargets": [], "referenceTargets": [], "replyToSignalId": root, "text": text}
    envelope = {"v": 1, "id": mid, "spaceId": sid, "ts": ts, "profile": profile, "type": "signal.text", "data": data}
    db.execute("INSERT OR REPLACE INTO space_signals (id,ts,type,profile_id,profile_kind,client_message_id,payload_json) VALUES (?,?,?,?,?,?,?)",
               (mid, ts, envelope["type"], profile["profileId"], profile["kind"], mid, json.dumps(envelope)))


def _item(context, key, values):
    row = {
        "id": context.ident(f"inbox-demo:{key}"), "organization_id": context.org["id"],
        "recipient_user_id": context.viewer["id"], "attention": "update", "importance": "normal",
        "source_key": context.ident(f"inbox-demo-source:{key}"),
        "resolution_status": "not_applicable", "occurred_at_ms": context.now,
        "created_at_ms": context.now, "updated_at_ms": context.now,
        "read_at_ms": None, "cleared_at_ms": None, **values,
    }
    context.insert("inbox_items", **row)
    columns = [column for column in row if column != "id"]
    context.db.execute(f"UPDATE inbox_items SET {','.join(column + '=?' for column in columns)} WHERE id=?",
                       (*[row[column] for column in columns], row["id"]))
