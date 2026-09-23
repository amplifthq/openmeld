"""Keep disposable message fixtures and their sidebar read model consistent."""
import json
import sqlite3


def refresh(context, sid):
    path = context.state / "do/openmeld-core-Space" / f"{sid}.sqlite"
    if not path.exists():
        raise RuntimeError(f"Missing fixture Space database: {sid}")
    # Fixture writers bypass publication; prepare the corresponding read model
    # as well. Never use this helper to repair production or claim API acceptance.
    with sqlite3.connect(path, timeout=30) as db:
        with sqlite3.connect(context.backup.parent / f"{context.backup.stem}-preview-{sid}.sqlite") as target:
            db.backup(target)
        row = db.execute("""SELECT payload_json FROM space_signals
            WHERE type='signal.text'
            AND COALESCE(json_extract(payload_json, '$.data.meta.purpose'), '') != 'space_message_changed'
            ORDER BY ts DESC, id DESC LIMIT 1""").fetchone()
        preview = None
        if row:
            message = json.loads(row[0])
            preview = {"signalId": message["id"], "profileId": message["profile"]["profileId"],
                       "timestamp": message["ts"],
                       "text": " ".join(message["data"]["text"].split())[:240] or "Message"}
        revision = db.execute("""INSERT INTO space_message_preview_revision (singleton, revision) VALUES (1, 1)
            ON CONFLICT(singleton) DO UPDATE SET revision=revision+1 RETURNING revision""").fetchone()[0]
    with context.db:
        context.db.execute("""UPDATE space_index_spaces SET message_preview_revision=?, message_preview_json=?
            WHERE space_id=? AND organization_id=? AND status='active'
            AND (message_preview_revision IS NULL OR message_preview_revision<=?)""",
            (revision, json.dumps(preview) if preview else None, sid, context.org["id"], revision))
