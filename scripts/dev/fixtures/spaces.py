"""Spaces, mixed membership, unread activity, and presentation scenarios."""
import datetime
import json
import urllib.request
import uuid
from fixtures import conversations, message_previews

def seed(db, org, viewer, human, now, ident, insert, session, gateway_port, gateway_host, context):
    space_names = ["Product planning", "Design feedback", "Engineering daily", "Release coordination",
                   "Customer interviews", "Website refresh", "Mobile onboarding", "API design",
                   "Search quality", "Documentation", "Performance lab", "Accessibility review",
                   "Billing migration", "Incident follow-up", "Research notes", "Team handbook",
                   "Weekly demo", "Data pipeline", "Localization", "Partner integrations",
                   "Developer experience", "Quarterly roadmap", "Security review", "Explorations",
                   "Enterprise onboarding and customer success",
                   "Search relevance experiments and evaluation",
                   "Platform reliability and incident response",
                   "Design systems and accessibility working group",
                   "Shared HTML readability"]
    headers = {"Authorization":"Bearer "+session["token"], "Content-Type":"application/json",
               "x-openmeld-profile-id":human["profile_id"],
               "x-openmeld-requested-organization-id":org["id"]}
    runtime_states = []
    for i, name in enumerate(space_names):
        purpose = f"Sidebar development fixture {i}: discuss {name.lower()}."
        existing = db.execute("SELECT space_id FROM space_index_spaces WHERE organization_id=? AND space_purpose LIKE ?",
                              (org["id"],f"Sidebar development fixture {i}:%")).fetchone()
        if existing:
            sid = existing[0]
        else:
            request = urllib.request.Request(f"http://127.0.0.1:{gateway_port}/v1/spaces",
                       data=json.dumps({"name":name,"purpose":purpose,"visibility":"public" if i%3 else "private"}).encode(),
                       headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
            payload = result.get("data",result)
            sid = payload.get("spaceId") or payload.get("id")
            if not sid:
                raise RuntimeError(f"Unexpected create-space response keys: {list(result)}")
        pinned = datetime.datetime.fromtimestamp((now-i*1000)/1000, datetime.timezone.utc).isoformat() if i<6 else None
        # Keep a repeatable one/two/three/many-member matrix in Space-owned truth.
        # The creator is already present; mixed groups include real fixture Agents.
        preview_members = [ident(f"human:{i % 18}"), "agt_"+ident(f"agent:{i % 12}"), ident(f"human:{(i + 5) % 18}"), "agt_"+ident(f"agent:{(i + 1) % 12}")][: [2, 1, 2, 4][i % 4]]
        if i in (1, 2, 3, 8, 9, 10):
            agent_id = "agt_" + ident(f"agent:{i}")
            if agent_id not in preview_members:
                preview_members.append(agent_id)
        if preview_members:
            request = urllib.request.Request(
                f"http://127.0.0.1:{gateway_port}/v1/spaces/{sid}/organization-directory-profiles",
                data=json.dumps({"directoryProfileIds": preview_members}).encode(),
                headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=30) as response:
                json.load(response)
        request = urllib.request.Request(
            f"http://127.0.0.1:{gateway_port}/v1/profiles/{human['profile_id']}/spaces/{sid}",
            data=json.dumps({"gatewayHost":gateway_host,"pinnedAt":pinned}).encode(),
            headers=headers, method="PATCH")
        with urllib.request.urlopen(request, timeout=30) as response:
            json.load(response)
        conversations.seed(context, sid, i, preview_members)
        message_previews.refresh(context, sid)
        if i in (0, 2, 7, 9):
            signal_index = 479 if i == 0 else 2
            signal_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fixture-conversation:{sid}:{signal_index}"))
            source_target = {"kind":"space", "spaceId":sid, "signalId":signal_id}
            title = f"New discussion in {name}"
            preview = "Local sidebar fixture: please review the latest update."
            if i == 0:
                title = "Muted tray smoke message"
                preview = "This newest unread is muted and must not hide the next eligible message."
            elif i == 2:
                title = "Tray smoke: ordinary unread"
                preview = "This is the latest eligible unread after the muted message."
            elif i == 7:
                title = "Tray smoke: thread reply"
                preview = "This reply should open the exact message inside its Thread."
                source_target.update({
                    "replyToRecipient": True,
                    "threadRootSignalId": str(uuid.uuid5(uuid.NAMESPACE_URL, f"fixture-conversation:{sid}:0")),
                })
            inbox_item = {
                "organization_id": org["id"],
                "recipient_user_id": viewer["id"],
                "kind": "space_message",
                "attention": "update",
                "importance": "normal",
                "title": title,
                "preview": preview,
                "context_label": name,
                "source_kind": "space_signal",
                "source_key": ident(f"unread-source:{i}"),
                "source_target_json": json.dumps(source_target),
                "resolution_status": "not_applicable",
                "occurred_at_ms": now-i*60000,
                "created_at_ms": now,
                "updated_at_ms": now,
                "read_at_ms": None,
                "cleared_at_ms": None,
            }
            with db:
                item_id = ident(f"unread:{i}")
                insert("inbox_items", id=item_id, **inbox_item)
                assignments = ",".join(f'"{column}"=?' for column in inbox_item)
                db.execute(
                    f'UPDATE inbox_items SET {assignments} WHERE id=?',
                    (*inbox_item.values(), item_id),
                )
                if i in (0, 2, 7):
                    notification_mode = {0: "muted", 2: "all_messages", 7: "mentions_and_replies"}[i]
                    db.execute(
                        "INSERT OR REPLACE INTO inbox_conversation_notification_preferences (user_id,organization_id,space_id,mode) VALUES (?,?,?,?)",
                        (viewer["id"], org["id"], sid, notification_mode),
                    )
        if i in (1, 2, 3, 8, 9, 10):
            agent_id = "agt_"+ident(f"agent:{i}")
            agent_name = db.execute("SELECT profile_name FROM openmeld_profiles WHERE profile_id=?", (agent_id,)).fetchone()[0]
            runtime_states.append({"spaceId":sid,"profileId":"agt_"+ident(f"agent:{i}"),
                                   "profileName":agent_name,
                                   "sourceSignalId":str(uuid.uuid5(uuid.NAMESPACE_URL, f"fixture-conversation:{sid}:0")),
                                   "scenario":"plan_review" if i == 3 else "permission" if i == 10 else "question" if i == 9 else "conversation_wait" if i == 2 else "recovery" if i == 1 else "working",
                                   "needsInput":i in (3,9,10)})

    return runtime_states
