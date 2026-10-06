import { hashPassword } from "better-auth/crypto";
import { createHistoricalD1Database } from "./d1-snapshot.mjs";
import { quoteIdentifier as quote } from "./database.mjs";

// Synthetic, reproducible migration input. These are not live product identities.
export const fixture = {
  owner: "11111111-1111-4111-8111-111111111111",
  member: "22222222-2222-4222-8222-222222222222",
  human: "33333333-3333-4333-8333-333333333333",
  agent: "agt_44444444-4444-4444-8444-444444444444",
  center: "agt_55555555-5555-4555-8555-555555555555",
  organization: "66666666-6666-4666-8666-666666666666",
  space: "7".repeat(64),
  project: "project_88888888-8888-4888-8888-888888888888",
  password: "LocalMigrationRehearsal42!",
  text: "Quoted ' and \" text, literal \\n, actual newline\n台北 😀, \\N, CR\rLF\n",
  envelope:
    '{"v":1,"iv":"c3ludGhldGljLWl2","ciphertext":"c3ludGhldGljLWVuY3J5cHRlZC1wYXlsb2Fk"}',
};

function insert(database, table, values) {
  const columns = Object.keys(values);
  database
    .prepare(
      `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
    )
    .run(...Object.values(values));
}

function routinesAndRuns(database, now) {
  for (const [id, agent] of [
    ["center-routine", null],
    ["remote-routine", fixture.agent],
  ]) {
    insert(database, "routines", {
      id,
      organization_id: fixture.organization,
      name: id,
      agent_profile_id: agent,
      instructions: "Summarize the team's work.",
      cron_expression: "0 9 * * *",
      timezone: "America/New_York",
      target_space_id: fixture.space,
      status: "paused",
      next_due_at: null,
      created_by_user_id: fixture.owner,
      updated_by_user_id: fixture.owner,
      created_at_ms: now,
      updated_at_ms: now,
    });
  }
  for (const id of ["center-routine", "remote-routine", "deleted-routine"]) {
    insert(database, "routine_runs", {
      id: `run-${id}`,
      routine_id: id,
      organization_id: fixture.organization,
      scheduled_for: now,
      status: "completed",
      routine_name_snapshot: id,
      target_space_id_snapshot: fixture.space,
      execution_engine: "legacy",
      published_signal_id: `result-${id}`,
      started_at_ms: now,
      finished_at_ms: now + 1000,
    });
  }
}

function profilesAndBindings(database, now) {
  for (const [id, name, kind, owner, organization, role] of [
    [fixture.human, "Migration Owner", "human", fixture.owner, null, null],
    [
      fixture.agent,
      "Migration Agent",
      "agent",
      fixture.owner,
      fixture.organization,
      null,
    ],
    [
      fixture.center,
      "Migration Center",
      "agent",
      null,
      fixture.organization,
      "center_agent",
    ],
  ]) {
    insert(database, "openmeld_profiles", {
      profile_id: id,
      profile_name: name,
      profile_handle: name.replaceAll(" ", "-"),
      profile_kind: kind,
      owner_user_id: owner,
      organization_id: organization,
      managed_role: role,
      source: "migration",
      is_default: kind === "human" ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
  }
  for (const [kind, owner, profile, runtime] of [
    ["owner_account", fixture.owner, fixture.agent, "openmeld_service"],
    [
      "organization",
      fixture.organization,
      fixture.center,
      "hosted_center_agent",
    ],
  ]) {
    insert(database, "openMeldDaemon_agent_profile_bindings", {
      binding_id: `binding-${kind}`,
      owner_kind: kind,
      owner_id: owner,
      agent_profile_id: profile,
      openmeld_service_runtime_id: `runtime-${kind}`,
      runtime_kind: runtime,
      hosted_runtime_identity_json:
        kind === "organization" ? '{"kind":"hosted_center_agent"}' : null,
      agent_controller_ref:
        kind === "organization" ? "openmeld:center-agent" : "codex:default",
      binding_state: "enabled_primary",
      created_at_ms: now,
      updated_at_ms: now,
    });
  }
}

function documentsAndSpace(database, now) {
  // The child intentionally sorts before its parent by rowid. COPY must keep
  // native self-referential FK semantics for a single table statement.
  database.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
  for (const [id, parent, name] of [
    ["child", "parent", "Child"],
    ["parent", null, "Parent"],
  ]) {
    insert(database, "organization_document_folders", {
      id,
      organization_id: fixture.organization,
      parent_folder_id: parent,
      name,
      created_at: now,
      updated_at: now,
    });
  }
  database.exec("COMMIT");
  insert(database, "organization_documents", {
    id: "document",
    organization_id: fixture.organization,
    kind: "knowledge",
    folder_id: "child",
    title: "Migration reference",
    content: fixture.text,
    draft_content: "",
    draft_created_by: "center_agent",
    draft_created_at: now,
    created_at: now,
    updated_at: now,
  });
  insert(database, "projects", {
    id: fixture.project,
    organization_id: fixture.organization,
    name: "Migration Project",
    slug: "migration-project",
    repository_url: "https://github.com/example/migration-rehearsal",
    created_by_user_id: fixture.owner,
    created_at_ms: now,
    updated_at_ms: now,
  });
  insert(database, "space_index_spaces", {
    space_id: fixture.space,
    organization_id: fixture.organization,
    organization_visibility: "private",
    status: "active",
    space_name: "Migration Space",
    creator_profile_id: fixture.human,
    creator_kind: "human",
    creator_owner_user_id: fixture.owner,
    source_updated_at_ms: now,
    projected_at_ms: now,
    projection_event_id: "space-event",
  });
  insert(database, "space_index_memberships", {
    space_id: fixture.space,
    profile_id: fixture.human,
    profile_kind_snapshot: "human",
    profile_name_snapshot: "Migration Owner",
    owner_user_id_snapshot: fixture.owner,
    status: "active",
    member_source: "owner_added",
    added_at_ms: now,
    source_updated_at_ms: now,
    projected_at_ms: now,
    projection_event_id: "membership-event",
  });
  insert(database, "slack_workspace_tokens", {
    slack_team_id: "SYNTHETIC",
    encrypted_bot_token: fixture.envelope,
    bot_user_id: "BOT",
    installed_by_user_id: fixture.owner,
    organization_id: fixture.organization,
    created_at_ms: now,
    updated_at_ms: now,
  });
}

function inboxAndActivity(database, now) {
  for (const [rowid, id, read, cleared] of [
    [71, "unread", null, null],
    [73, "read", now, null],
    [79, "cleared", now, now],
  ]) {
    insert(database, "inbox_items", {
      rowid,
      id,
      organization_id: fixture.organization,
      recipient_user_id: fixture.owner,
      kind: "space_message",
      attention: "update",
      importance: "normal",
      title: "Migration message",
      preview: fixture.text,
      source_kind: "space_signal",
      source_key: id,
      source_target_json: JSON.stringify({
        kind: "space_signal",
        spaceId: fixture.space,
        signalId: id,
      }),
      resolution_status: "not_applicable",
      read_at_ms: read,
      cleared_at_ms: cleared,
      occurred_at_ms: now,
      created_at_ms: now,
      updated_at_ms: now,
    });
  }
  // Tail 900 was already observed and deleted; preserving only max(rowid)=79
  // would put new arrivals inside the retained page's historical cutoff.
  insert(database, "inbox_feed_snapshots", {
    id: "page",
    organization_id: fixture.organization,
    recipient_user_id: fixture.owner,
    category: "all",
    unread_only: 0,
    agents_only: 0,
    through_row_id: 900,
    created_at_ms: now,
    expires_at_ms: now + 900_000,
  });
  insert(database, "inbox_feed_snapshot_members", {
    snapshot_id: "page",
    item_id: "unread",
  });
  insert(database, "inbox_space_thread_read_watermarks", {
    organization_id: fixture.organization,
    recipient_user_id: fixture.owner,
    space_id: fixture.space,
    thread_root_signal_id: "root-signal",
    through_occurred_at_ms: now,
    read_at_ms: now,
    created_at_ms: now,
    updated_at_ms: now,
  });
  insert(database, "agent_activity_events", {
    accepted_sequence: 41,
    id: "activity",
    event_id: "activity-event",
    canonical_payload_hash: `sha256:${"a".repeat(64)}`,
    organization_id: fixture.organization,
    project_id: fixture.project,
    member_user_id: fixture.owner,
    device_id: "device",
    openmeld_service_runtime_id: "runtime-owner_account",
    provider: "codex",
    client_kind: "cli",
    provider_session_id: "controller-session",
    event_type: "session_started",
    status: "idle",
    observed_at_ms: now,
    expires_at_ms: now + 86_400_000,
    provider_metadata_json: "{}",
    accepted_at_ms: now,
    daily_session_key: "daily-session",
  });
  database
    .prepare(
      "UPDATE sqlite_sequence SET seq=700 WHERE name='agent_activity_events'"
    )
    .run();
}

function pluginRequests(database, now) {
  insert(database, "plugin_action_requests", {
    id: "99999999-9999-4999-8999-999999999999",
    organization_id: fixture.organization,
    user_id: fixture.owner,
    actor_profile_id: fixture.agent,
    operation_id: "migration-plugin-operation",
    source_request_key: "dispatch:migration-request",
    request_digest: "a".repeat(64),
    request_json: JSON.stringify({
      organizationId: fixture.organization,
      userId: fixture.owner,
      actorProfileId: fixture.agent,
      operationId: "migration-plugin-operation",
      sourceRequestKey: "dispatch:migration-request",
      connection: {
        connectionName: "migration-plugin-account",
        ownerUserId: fixture.owner,
        ownerDisplayName: "Migration Owner",
        scope: "member",
        service: "posthog",
      },
      connectionUpdatedAtMs: now - 1000,
      accessRevision: 2,
      service: "posthog",
      actionId: "posthog.create_dashboard",
      effect: "write",
      input: { name: fixture.text },
    }),
    state: "approved",
    created_at_ms: now,
    expires_at_ms: now + 3_600_000,
    decided_at_ms: now + 1000,
  });
  insert(database, "center_agent_connector_action_operations", {
    id: "migration-plugin-receipt",
    organization_id: fixture.organization,
    actor_profile_id: fixture.agent,
    requester_attribution_key: `user:${fixture.owner}`,
    represented_user_id: fixture.owner,
    operation_id: "migration-plugin-operation",
    request_signature: "b".repeat(64),
    service: "posthog",
    action_id: "posthog.create_dashboard",
    connection_name: "migration-plugin-account",
    connection_updated_at_ms: now - 1000,
    status: "outcome_unknown",
    created_at_ms: now,
    updated_at_ms: now + 1000,
  });
}

export async function createD1RehearsalFixture(destination) {
  const { database } = await createHistoricalD1Database(destination);
  const now = Date.now();
  try {
    for (const [id, name, email] of [
      [fixture.owner, fixture.text, "migration-owner@example.com"],
      [fixture.member, "Migration Member", "migration-member@example.com"],
    ]) {
      insert(database, "users", {
        id,
        name,
        email,
        email_verified: 1,
        created_at: now,
        updated_at: now,
        image: "",
      });
      insert(database, "accounts", {
        id: `account-${id}`,
        account_id: id,
        provider_id: "credential",
        user_id: id,
        password: await hashPassword(fixture.password),
        access_token: fixture.envelope,
        refresh_token: "\\N",
        scope: "",
        created_at: now,
        updated_at: now,
      });
    }
    // Multiple source pages exercise keyset capture.
    for (let i = 0; i < 260; i += 1) {
      insert(database, "users", {
        id: `page-${i.toString().padStart(3, "0")}`,
        name: `Page ${i}`,
        email: `page-${i}@example.com`,
        created_at: now,
        updated_at: now,
      });
    }
    insert(database, "organizations", {
      id: fixture.organization,
      name: "Migration Organization",
      slug: "migration-rehearsal",
      created_at: now,
      created_by_user_id: fixture.owner,
    });
    for (const [user, role] of [
      [fixture.owner, "owner"],
      [fixture.member, "member"],
    ]) {
      insert(database, "members", {
        id: `member-${user}`,
        organization_id: fixture.organization,
        user_id: user,
        role,
        created_at: now,
      });
    }
    insert(database, "sessions", {
      id: "session",
      user_id: fixture.owner,
      token: "synthetic-archived-session",
      expires_at: now + 86_400_000,
      created_at: now,
      updated_at: now,
      active_organization_id: fixture.organization,
    });
    profilesAndBindings(database, now);
    documentsAndSpace(database, now);
    routinesAndRuns(database, now);
    // Numeric and lexical key ordering differ; reconciliation must retain
    // the INTEGER ordering even when it projects PostgreSQL values as text.
    for (const id of [2, 10]) {
      insert(database, "openMeldDaemon_dispatch_ledger", {
        id,
        idempotency_key: `numeric-key-${id}`,
        dispatch_id: `migration-dispatch-${id}`,
        space_id: fixture.space,
        source_event_id: `migration-event-${id}`,
        target_profile_id: fixture.agent,
        status: "pending",
        first_seen_at_ms: now,
        last_attempt_at_ms: now,
        attempt_count: 0,
      });
    }
    inboxAndActivity(database, now);
    pluginRequests(database, now);
    database.exec(
      "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY NOT NULL,name TEXT NOT NULL,applied_at TEXT NOT NULL)"
    );
    insert(database, "d1_migrations", {
      id: 1,
      name: "synthetic-history-applied",
      applied_at: new Date(now).toISOString(),
    });
    return { now };
  } finally {
    database.close();
  }
}
