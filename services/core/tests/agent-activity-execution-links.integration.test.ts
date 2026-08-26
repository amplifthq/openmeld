import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { linkAcceptedAgentActivityExecutions } from "../src/agent-activity/activity-execution-link-repository";

const owned = new Set<string>();

afterEach(async () => {
  for (const suffix of owned) {
    const graph = ids(suffix);
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_execution_links WHERE runtime_coordinator_execution_id = ?"
      ).bind(graph.executionId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_sessions WHERE organization_id = ?"
      ).bind(graph.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openMeldDaemon_dispatch_result_inbox WHERE runtime_coordinator_execution_id = ?"
      ).bind(graph.executionId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openMeldDaemon_runtime_coordinator_executions WHERE runtime_coordinator_execution_id = ?"
      ).bind(graph.executionId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openMeldDaemon_agent_profile_bindings WHERE binding_id = ?"
      ).bind(graph.bindingId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openmeld_profiles WHERE profile_id = ?"
      ).bind(graph.agentProfileId),
      env.OPENMELD_DB.prepare("DELETE FROM users WHERE id = ?").bind(
        graph.memberUserId
      ),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openMeldDaemon_runtime_registry_records WHERE openmeld_service_runtime_id = ?"
      ).bind(graph.runtimeId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM space_index_spaces WHERE space_id = ?"
      ).bind(graph.spaceId),
      env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?").bind(
        graph.organizationId
      ),
    ]);
  }
  owned.clear();
});

describe("Agent Activity execution links", () => {
  it("links in both arrival orders and keeps retries idempotent", async () => {
    const executionFirst = await seedGraph({
      includeExecution: true,
      includeSession: false,
    });
    await expect(
      linkAcceptedAgentActivityExecutions({
        db: env.OPENMELD_DB,
        nowMs: 2000,
        runtimeCoordinatorExecutionId: executionFirst.executionId,
      })
    ).resolves.toBe(0);
    await insertSession(executionFirst);
    await expect(
      linkAcceptedAgentActivityExecutions({
        activitySession: activitySession(executionFirst),
        db: env.OPENMELD_DB,
        nowMs: 2001,
      })
    ).resolves.toBe(1);
    await expect(
      linkAcceptedAgentActivityExecutions({
        db: env.OPENMELD_DB,
        nowMs: 2002,
        runtimeCoordinatorExecutionId: executionFirst.executionId,
      })
    ).resolves.toBe(0);

    const sessionFirst = await seedGraph({
      includeExecution: false,
      includeSession: true,
    });
    await expect(
      linkAcceptedAgentActivityExecutions({
        activitySession: activitySession(sessionFirst),
        db: env.OPENMELD_DB,
        nowMs: 2000,
      })
    ).resolves.toBe(0);
    await insertExecution(sessionFirst);
    await expect(
      linkAcceptedAgentActivityExecutions({
        db: env.OPENMELD_DB,
        nowMs: 2001,
        runtimeCoordinatorExecutionId: sessionFirst.executionId,
      })
    ).resolves.toBe(1);
  });

  it("links a Cursor ACP execution to its Cursor Agent Activity session", async () => {
    const graph = await seedGraph({
      controllerRef: "builtin:cursor",
      includeExecution: true,
      includeSession: true,
      sessionProvider: "cursor",
    });

    await expect(
      linkAcceptedAgentActivityExecutions({
        db: env.OPENMELD_DB,
        nowMs: 2000,
        runtimeCoordinatorExecutionId: graph.executionId,
      })
    ).resolves.toBe(1);
    await expect(readLink(graph.executionId)).resolves.toMatchObject({
      activity_session_id: graph.sessionId,
      runtime_coordinator_execution_id: graph.executionId,
    });
  });

  it.each([
    ["organization", { spaceOrganizationId: "wrong-organization" }],
    ["member", { runtimeOwnerId: "wrong-member" }],
    ["device", { runtimeDeviceId: "wrong-device" }],
    ["runtime", { executionRuntimeId: "wrong-runtime" }],
    ["binding", { executionBindingId: "wrong-binding" }],
    ["target profile", { executionTargetProfileId: "wrong-profile" }],
    ["controller", { executionControllerRef: "builtin:opencode" }],
    ["provider", { sessionProvider: "opencode" }],
    ["conversation", { payloadConversationId: "wrong-conversation" }],
    ["unaccepted status", { executionStatus: "running" }],
  ] as const)("rejects a %s mismatch", async (_label, overrides) => {
    const graph = await seedGraph({
      includeExecution: true,
      includeSession: true,
      ...overrides,
    });

    await expect(
      linkAcceptedAgentActivityExecutions({
        db: env.OPENMELD_DB,
        nowMs: 2000,
        runtimeCoordinatorExecutionId: graph.executionId,
      })
    ).resolves.toBe(0);
    await expect(readLink(graph.executionId)).resolves.toBeNull();
  });

  it("never rewrites an existing link when later evidence conflicts", async () => {
    const graph = await seedGraph({
      includeExecution: true,
      includeSession: true,
    });
    await linkAcceptedAgentActivityExecutions({
      db: env.OPENMELD_DB,
      nowMs: 2000,
      runtimeCoordinatorExecutionId: graph.executionId,
    });
    const original = await readLink(graph.executionId);
    const conflictingConversationId = `${graph.conversationId}-conflict`;
    await insertSession({
      ...graph,
      conversationId: conflictingConversationId,
      sessionId: `${graph.sessionId}-conflict`,
    });
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE openMeldDaemon_agent_profile_bindings SET agent_controller_conversation_id = ? WHERE binding_id = ?"
      ).bind(conflictingConversationId, graph.bindingId),
      env.OPENMELD_DB.prepare(
        "UPDATE openMeldDaemon_dispatch_result_inbox SET result_payload_json = ? WHERE runtime_coordinator_execution_id = ?"
      ).bind(
        resultPayload(graph.controllerRef, conflictingConversationId),
        graph.executionId
      ),
    ]);

    await expect(
      linkAcceptedAgentActivityExecutions({
        db: env.OPENMELD_DB,
        nowMs: 3000,
        runtimeCoordinatorExecutionId: graph.executionId,
      })
    ).rejects.toThrow("conflicts with canonical RuntimeCoordinator authority");
    await expect(readLink(graph.executionId)).resolves.toEqual(original);
  });
});

type Graph = ReturnType<typeof ids> & {
  controllerRef: string;
  provider: "claude-code" | "cursor" | "opencode";
};

async function seedGraph(input: {
  controllerRef?: "builtin:claude-code" | "builtin:cursor" | "builtin:opencode";
  executionBindingId?: string;
  executionControllerRef?: string;
  executionRuntimeId?: string;
  executionStatus?: string;
  executionTargetProfileId?: string;
  includeExecution: boolean;
  includeSession: boolean;
  payloadConversationId?: string;
  runtimeDeviceId?: string;
  runtimeOwnerId?: string;
  sessionProvider?: "claude-code" | "cursor" | "opencode";
  spaceOrganizationId?: string;
}): Promise<Graph> {
  const suffix = crypto.randomUUID();
  owned.add(suffix);
  const graph: Graph = {
    ...ids(suffix),
    controllerRef: input.controllerRef ?? "builtin:claude-code",
    provider: input.sessionProvider ?? "claude-code",
  };
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Execution Link Org', ?, 1)"
  )
    .bind(graph.organizationId, `execution-link-${suffix}`)
    .run();
  await env.OPENMELD_DB.prepare(
    `INSERT INTO users (
      id, name, email, email_verified, created_at, updated_at
    ) VALUES (?, 'Execution Link Owner', ?, 1, 1, 1)`
  )
    .bind(graph.memberUserId, `execution-link-${suffix}@example.com`)
    .run();
  await env.OPENMELD_DB.prepare(
    `INSERT INTO space_index_spaces (
      space_id, organization_id, organization_visibility, status,
      source_updated_at_ms, projected_at_ms, projection_event_id
    ) VALUES (?, ?, 'private', 'active', 1, 1, ?)`
  )
    .bind(
      graph.spaceId,
      input.spaceOrganizationId ?? graph.organizationId,
      `projection_${suffix}`
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `INSERT INTO openMeldDaemon_runtime_registry_records (
      openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane,
      created_at_ms, last_registered_at_ms, updated_at_ms
    ) VALUES (?, 'owner_account', ?, ?, 'dev', 1, 1, 1)`
  )
    .bind(
      graph.runtimeId,
      input.runtimeOwnerId ?? graph.memberUserId,
      input.runtimeDeviceId ?? graph.deviceId
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `INSERT INTO openmeld_profiles (
      profile_id, profile_name, profile_handle, profile_kind, is_default,
      status, organization_id, owner_user_id, created_by_user_id, source,
      created_at, updated_at
    ) VALUES (?, 'Execution Link Agent', ?, 'agent', 0, 'active', ?, ?, ?, 'cli_create', 1, 1)`
  )
    .bind(
      graph.agentProfileId,
      `execution-link-${suffix}`,
      graph.organizationId,
      graph.memberUserId,
      graph.memberUserId
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `INSERT INTO openMeldDaemon_agent_profile_bindings (
      binding_id, owner_kind, owner_id, agent_profile_id,
      openmeld_service_runtime_id, runtime_kind, agent_controller_ref,
      agent_controller_conversation_id, binding_state,
      created_at_ms, updated_at_ms
    ) VALUES (?, 'owner_account', ?, ?, ?, 'openmeld_service', ?, ?, 'enabled_primary', 1, 1)`
  )
    .bind(
      graph.bindingId,
      graph.memberUserId,
      graph.agentProfileId,
      graph.runtimeId,
      graph.controllerRef,
      graph.conversationId
    )
    .run();
  if (input.includeSession) {
    await insertSession(graph);
  }
  if (input.includeExecution) {
    await insertExecution(graph, input);
  }
  return graph;
}

async function insertSession(graph: Graph) {
  await env.OPENMELD_DB.prepare(
    `INSERT INTO agent_activity_sessions (
      id, organization_id, project_id, member_user_id, device_id,
      openmeld_service_runtime_id, provider, client_kind,
      provider_session_id, title, model, status, git_branch, git_commit,
      repository_fingerprint, started_at_ms, last_observed_at_ms,
      expires_at_ms, provider_metadata_json, last_event_id,
      last_accepted_sequence, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
      'active', NULL, NULL, NULL, 900, 1000, 2000, '{}', ?, 1, 1000, 1000)`
  )
    .bind(
      graph.sessionId,
      graph.organizationId,
      graph.projectId,
      graph.memberUserId,
      graph.deviceId,
      graph.runtimeId,
      graph.provider,
      clientKindForProvider(graph.provider),
      graph.conversationId,
      `event_${graph.executionId}`
    )
    .run();
}

function clientKindForProvider(provider: Graph["provider"]) {
  if (provider === "cursor") {
    return "cursor-cli";
  }
  return provider === "claude-code" ? "claude-code-cli" : "unknown";
}

async function insertExecution(
  graph: Graph,
  overrides: {
    executionBindingId?: string;
    executionControllerRef?: string;
    executionRuntimeId?: string;
    executionStatus?: string;
    executionTargetProfileId?: string;
    payloadConversationId?: string;
  } = {}
) {
  const controllerRef = overrides.executionControllerRef ?? graph.controllerRef;
  await env.OPENMELD_DB.prepare(
    `INSERT INTO openMeldDaemon_runtime_coordinator_executions (
      runtime_coordinator_execution_id, model_version, space_id, dispatch_id,
      target_profile_id, openMeld_service_runtime_id_source,
      openmeld_service_runtime_id, binding_id, agent_controller_ref, status,
      created_at_ms, updated_at_ms
    ) VALUES (?, 'v1', ?, ?, ?, 'runtime_registry_authority', ?, ?, ?, ?, 1000, 1000)`
  )
    .bind(
      graph.executionId,
      graph.spaceId,
      graph.dispatchId,
      overrides.executionTargetProfileId ?? graph.agentProfileId,
      overrides.executionRuntimeId ?? graph.runtimeId,
      overrides.executionBindingId ?? graph.bindingId,
      controllerRef,
      overrides.executionStatus ?? "result_accepted"
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `INSERT INTO openMeldDaemon_dispatch_result_inbox (
      result_key, dispatch_id, attempt_id, task_id, target_profile_id,
      daemon_session_id, lease_epoch, submitted_connection_generation,
      runtime_coordinator_execution_id, result_payload_json, accepted_at_ms,
      publish_state, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 1500, 'pending_publication', 1500)`
  )
    .bind(
      `result_${graph.executionId}`,
      graph.dispatchId,
      `attempt_${graph.executionId}`,
      `task_${graph.executionId}`,
      graph.agentProfileId,
      `daemon_${graph.executionId}`,
      graph.executionId,
      resultPayload(
        controllerRef,
        overrides.payloadConversationId ?? graph.conversationId
      )
    )
    .run();
}

function resultPayload(controllerRef: string, conversationId: string) {
  return JSON.stringify({
    payload: {
      agentControllerConversation: {
        agentControllerConversationId: conversationId,
        agentControllerRef: controllerRef,
      },
    },
  });
}

function activitySession(graph: Graph) {
  return {
    deviceId: graph.deviceId,
    memberUserId: graph.memberUserId,
    organizationId: graph.organizationId,
    provider: graph.provider,
    providerSessionId: graph.conversationId,
  };
}

async function readLink(executionId: string) {
  return await env.OPENMELD_DB.prepare(
    `SELECT activity_session_id, runtime_coordinator_execution_id,
      provider_conversation_id
    FROM agent_activity_execution_links
    WHERE runtime_coordinator_execution_id = ?`
  )
    .bind(executionId)
    .first();
}

function ids(suffix: string) {
  return {
    agentProfileId: `agt_${suffix}`,
    bindingId: `binding_${suffix}`,
    conversationId: `conversation_${suffix}`,
    deviceId: `device_${suffix}`,
    dispatchId: `dispatch_${suffix}`,
    executionId: `execution_${suffix}`,
    memberUserId: `user_${suffix}`,
    organizationId: `org_execution_link_${suffix}`,
    projectId: `project_${suffix}`,
    runtimeId: `runtime_${suffix}`,
    sessionId: `session_${suffix}`,
    spaceId: `space_${suffix}`,
  };
}
