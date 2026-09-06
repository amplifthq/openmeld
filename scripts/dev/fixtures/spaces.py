"""Spaces, mixed membership, unread activity, and presentation scenarios."""
import datetime
import json
import urllib.request

def seed(db, org, viewer, human, now, ident, insert, session, gateway_port, gateway_host):
    space_names = ["Product planning", "Design feedback", "Engineering daily", "Release coordination",
                   "Customer interviews", "Website refresh", "Mobile onboarding", "API design",
                   "Search quality", "Documentation", "Performance lab", "Accessibility review",
                   "Billing migration", "Incident follow-up", "Research notes", "Team handbook",
                   "Weekly demo", "Data pipeline", "Localization", "Partner integrations",
                   "Developer experience", "Quarterly roadmap", "Security review", "Explorations",
                   "Enterprise onboarding and customer success",
                   "Search relevance experiments and evaluation",
                   "Platform reliability and incident response",
                   "Design systems and accessibility working group"]
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
        preview_members = [ident("human:0"), "agt_"+ident("agent:0"), ident("human:1"), "agt_"+ident("agent:1")][: [0, 1, 2, 4][i % 4]]
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
        if i in (0, 2, 7, 9):
            with db:
                insert("inbox_items", id=ident(f"unread:{i}"), organization_id=org["id"],
                       recipient_user_id=viewer["id"], kind="space_message", attention="update",
                       importance="normal", title=f"New discussion in {name}",
                       preview="Local sidebar fixture: please review the latest update.", context_label=name,
                       source_kind="space_signal", source_key=ident(f"unread-source:{i}"),
                       source_target_json=json.dumps({"kind":"space","spaceId":sid}),
                       resolution_status="not_applicable", occurred_at_ms=now-i*60000,
                       created_at_ms=now, updated_at_ms=now)
                db.execute("UPDATE inbox_items SET read_at_ms=NULL,cleared_at_ms=NULL WHERE id=?", (ident(f"unread:{i}"),))
        if i in (1, 2, 3, 8, 9, 10):
            agent_id = "agt_"+ident(f"agent:{i}")
            agent_name = db.execute("SELECT profile_name FROM openmeld_profiles WHERE profile_id=?", (agent_id,)).fetchone()[0]
            runtime_states.append({"spaceId":sid,"profileId":"agt_"+ident(f"agent:{i}"),
                                   "profileName":agent_name,
                                   "needsInput":i in (3,10)})

    return runtime_states
