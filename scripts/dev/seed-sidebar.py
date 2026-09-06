#!/usr/bin/env python3
"""Add repeatable sidebar fixtures to an explicitly selected isolated local lane."""
import argparse
import datetime
import json
import sqlite3
import time
import urllib.request
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--lane", required=True)
parser.add_argument("--organization", required=True)
parser.add_argument("--gateway-port", required=True, type=int)
parser.add_argument("--viewer-email", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
if not args.lane.startswith("wt-") or "/" in args.lane or ".." in args.lane:
    raise SystemExit("Choose an isolated wt-* lane.")
state = root / ".wrangler-dev-state" / "isolated" / args.lane
paths = [p for p in (state / "v3/d1").glob("*/*.sqlite") if p.name != "metadata.sqlite"]
if len(paths) != 1:
    raise SystemExit("Expected exactly one existing local D1 database.")
db = sqlite3.connect(paths[0], timeout=30)
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys=ON")
org = db.execute("SELECT * FROM organizations WHERE slug=?", (args.organization,)).fetchone()
viewer = db.execute("SELECT * FROM users WHERE email=?", (args.viewer_email,)).fetchone()
if not org or not viewer:
    raise SystemExit("Existing fixture Organization and viewer are required.")
human = db.execute("SELECT * FROM openmeld_profiles WHERE owner_user_id=? AND is_default=1",
                   (viewer["id"],)).fetchone()
session = db.execute("SELECT token FROM sessions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1",
                     (viewer["id"], int(time.time()*1000))).fetchone()
if not human or not session:
    raise SystemExit("Sign in to the local fixture account first.")
backup = root / "dev-tmp" / f"sidebar-before-seed-{int(time.time())}.sqlite"
backup.parent.mkdir(exist_ok=True)
with sqlite3.connect(backup) as target:
    db.backup(target)
now = int(time.time()*1000)
def ident(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"openmeld-sidebar-fixture:{org['id']}:{key}"))
def insert(table, **row):
    columns = ",".join('"'+k+'"' for k in row)
    db.execute(f'INSERT OR IGNORE INTO "{table}" ({columns}) VALUES ({",".join("?" for _ in row)})',
               tuple(row.values()))

names = ["Jordan Rivera", "Avery Park", "Samir Patel", "Lena Hoffmann", "Noah Williams",
         "Sofia Martínez", "Ethan Brooks", "Yuki Tanaka", "Amara Okafor", "Oliver Chen",
         "Priya Shah", "Theo Laurent", "Isabella Rossi", "Alex Morgan", "Min-jun Kim",
         "Camille Dubois", "Gabriel Santos", "Zoe Anderson"]
owners = [(viewer["id"], human["profile_id"], viewer["name"])]
with db:
    for i, name in enumerate(names):
        uid, pid = ident(f"user:{i}"), ident(f"human:{i}")
        insert("users", id=uid, name=name, email=f"sidebar-{i}@example.invalid",
               email_verified=1, created_at=now-86400000*(i+2), updated_at=now)
        insert("members", id=ident(f"member:{i}"), organization_id=org["id"], user_id=uid,
               role="admin" if i in (0, 7) else "member", created_at=now-86400000*(i+1))
        insert("openmeld_profiles", profile_id=pid, profile_name=name, profile_handle=f"sidebar-person-{i}",
               profile_kind="human", is_default=1, owner_user_id=uid, created_by_user_id=uid,
               source="auth_bootstrap", created_at=now-86400000*(i+1), updated_at=now)
        insert("organization_member_activity", organization_id=org["id"], user_id=uid,
               human_profile_id=pid, last_active_at_ms=now-[120000,3600000,72000000,86400000*4,86400000*21][i%5],
               updated_at_ms=now)
        owners.append((uid,pid,name))
    for i in range(42):
        owner, creator, name = owners[0 if i < 9 else (i-8)%len(owners)]
        controller = ["codex","claude-code","opencode","cursor","gemini"][i%5]
        pid = "agt_"+ident(f"agent:{i}")
        label = [f"{name.split()[0]} · {controller.title()}", "Frontend accessibility review",
                 "Release notes and documentation", "Search relevance experiments",
                 "Payments API integration and regression checks", "Customer research synthesis"][i%6]
        insert("openmeld_profiles", profile_id=pid, profile_name=label, profile_handle=f"sidebar-agent-{i}",
               profile_kind="agent", owner_user_id=owner, organization_id=org["id"],
               created_by_user_id=owner, creator_profile_id=creator, source="web_create",
               status="disabled" if i in (39,40) else "active", last_used_at=now-i*7200000,
               created_at=now-86400000*30, updated_at=now)
        if i%7 == 6:
            continue
        device = ident(f"device:{owner}:{i%2}")
        runtime = ident(f"runtime:{device}")
        connected = ident(f"computer:{device}")
        insert("openMeldDaemon_connected_computers", owner_user_id=owner, connected_computer_id=connected,
               created_at_ms=now-86400000*30, updated_at_ms=now)
        insert("openMeldDaemon_owned_devices", owner_user_id=owner, device_id=device,
               connected_computer_id=connected, observed_display_name=f"{name.split()[0]}'s "+["MacBook Pro","Windows workstation"][i%2],
               platform_family=["macOS","Windows"][i%2], device_type=["laptop","desktop"][i%2],
               first_seen_at_ms=now-86400000*30, last_observed_at_ms=now-3600000*(i+1), updated_at_ms=now)
        insert("openMeldDaemon_runtime_registry_records", openmeld_service_runtime_id=runtime,
               owner_kind="owner_account", owner_id=owner, device_id=device, lane="dev-local",
               created_at_ms=now-86400000*30, last_registered_at_ms=now-86400000, updated_at_ms=now)
        disabled = i%8 == 7
        insert("openMeldDaemon_agent_profile_bindings", binding_id=ident(f"binding:{i}"),
               owner_kind="owner_account", owner_id=owner, agent_profile_id=pid,
               openmeld_service_runtime_id=runtime, agent_controller_ref=("custom:" if controller=="gemini" else "builtin:")+controller,
               agent_controller_conversation_id=ident(f"session:{i}") if i%3 else None,
               model_id=({"codex":"gpt-5.6-sol","claude-code":"claude-sonnet-4-6",
                          "opencode":"opencode/big-pickle","cursor":"auto","gemini":"gemini-2.5-pro"}[controller]),
               reasoning_level="high" if controller=="codex" else None,
               binding_state="disabled_historical" if disabled else "enabled_primary",
               disabled_at_ms=now if disabled else None,
               created_at_ms=now-86400000*30, updated_at_ms=now, created_by_profile_id=creator)
        if not disabled and i%9 != 8:
            insert("organization_binding_authorizations", id=ident(f"authorization:{i}"),
                   organization_id=org["id"], binding_id=ident(f"binding:{i}"),
                   authorized_by=owner, created_at=now)

space_names = ["Product planning", "Design feedback", "Engineering daily", "Release coordination",
               "Customer interviews", "Website refresh", "Mobile onboarding", "API design",
               "Search quality", "Documentation", "Performance lab", "Accessibility review",
               "Billing migration", "Incident follow-up", "Research notes", "Team handbook",
               "Weekly demo", "Data pipeline", "Localization", "Partner integrations",
               "Developer experience", "Quarterly roadmap", "Security review", "Explorations"]
headers = {"Authorization":"Bearer "+session["token"], "Content-Type":"application/json",
           "x-openmeld-profile-id":human["profile_id"],
           "x-openmeld-requested-organization-id":org["id"]}
runtime_states = []
for i, name in enumerate(space_names):
    purpose = f"Sidebar development fixture {i}: discuss {name.lower()}."
    existing = db.execute("SELECT space_id FROM space_index_spaces WHERE organization_id=? AND space_purpose=?",
                          (org["id"],purpose)).fetchone()
    if existing:
        sid = existing[0]
    else:
        request = urllib.request.Request(f"http://127.0.0.1:{args.gateway_port}/v1/spaces",
                   data=json.dumps({"name":name,"purpose":purpose,"visibility":"public" if i%3 else "private"}).encode(),
                   headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        payload = result.get("data",result)
        sid = payload.get("spaceId") or payload.get("id")
        if not sid:
            raise RuntimeError(f"Unexpected create-space response keys: {list(result)}")
    pinned = datetime.datetime.fromtimestamp((now-i*1000)/1000, datetime.timezone.utc).isoformat() if i<6 else None
    request = urllib.request.Request(
        f"http://127.0.0.1:{args.gateway_port}/v1/profiles/{human['profile_id']}/spaces/{sid}",
        data=json.dumps({"gatewayHost":f"localhost:{args.gateway_port}","pinnedAt":pinned}).encode(),
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
manifest = root / "clients/web/scripts/sidebar-preview/runtime-states.local.json"
manifest.write_text(json.dumps({"organizationId":org["id"],"organizationSlug":org["slug"],"profileId":human["profile_id"],
                                "spaces":runtime_states,
                                "agents":[{"profileId":"agt_"+ident(f"agent:{i}"),"state":["available","checking","offline","connect","unavailable"][i%5]} for i in range(42)],
                                "people":[{"profileId":pid,"state":["connected","offline","unconnected","needs_attention","unknown"][i%5]}
                                          for i,(_,pid,_) in enumerate(owners[1:])]}, indent=2)+"\n")
print(json.dumps({"lane":args.lane,"people_added":18,"agents":42,"spaces":24,"pinned":6,
                  "backup":str(backup),"live_service_simulated":False}))
