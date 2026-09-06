"""Directory fixtures: people, Agents, computers, and bindings."""

def seed(db, org, viewer, human, now, ident, insert):
    names = ["Jordan Rivera", "Avery Park", "Samir Patel", "Lena Hoffmann", "Noah Williams",
             "Sofia Martínez", "Ethan Brooks", "Yuki Tanaka", "Amara Okafor", "Oliver Chen",
             "Priya Shah", "Theo Laurent", "Isabella Rossi", "Alex Morgan", "Min-jun Kim",
             "Camille Dubois", "Gabriel Santos", "Zoe Anderson"]
    owners = [(viewer["id"], human["profile_id"], viewer["name"])]
    with db:
        for i, name in enumerate(names):
            uid, pid = ident(f"user:{i}"), ident(f"human:{i}")
            insert("users", id=uid, name=name, email=f"sidebar-{uid}@example.invalid",
                   email_verified=1, created_at=now-86400000*(i+2), updated_at=now)
            insert("members", id=ident(f"member:{i}"), organization_id=org["id"], user_id=uid,
                   role="admin" if i in (0, 7) else "member", created_at=now-86400000*(i+1))
            insert("openmeld_profiles", profile_id=pid, profile_name=name, profile_handle=f"sidebar-person-{uid}",
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
            insert("openmeld_profiles", profile_id=pid, profile_name=label, profile_handle=f"sidebar-agent-{pid[4:]}",
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


    return owners
