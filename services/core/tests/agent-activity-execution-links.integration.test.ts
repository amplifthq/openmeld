import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { afterEach, describe, expect, it } from "vitest";
import { linkAcceptedAgentActivityExecutions } from "../src/agent-activity/activity-execution-link-repository";
import { env } from "../test-support/worker-env";

const owned = new Set<string>();
afterEach(async () => {
  for (const suffix of owned) {
    const graph = ids(suffix);
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_execution_links" WHERE runtime_coordinator_execution_id = $1',
              values: [],
            },
            values: [graph.executionId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_sessions" WHERE organization_id = $1',
              values: [],
            },
            values: [graph.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldDaemon_dispatch_result_inbox" WHERE runtime_coordinator_execution_id = $1',
              values: [],
            },
            values: [graph.executionId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" WHERE runtime_coordinator_execution_id = $1',
              values: [],
            },
            values: [graph.executionId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE binding_id = $1',
              values: [],
            },
            values: [graph.bindingId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1',
              values: [],
            },
            values: [graph.agentProfileId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."users" WHERE id = $1',
              values: [],
            },
            values: [graph.memberUserId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldDaemon_runtime_registry_records" WHERE openmeld_service_runtime_id = $1',
              values: [],
            },
            values: [graph.runtimeId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."space_index_spaces" WHERE space_id = $1',
              values: [],
            },
            values: [graph.spaceId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."organizations" WHERE id = $1',
              values: [],
            },
            values: [graph.organizationId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
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
        db: getPostgresDatabase(env),
        nowMs: 2000,
        runtimeCoordinatorExecutionId: executionFirst.executionId,
      })
    ).resolves.toBe(0);
    await insertSession(executionFirst);
    await expect(
      linkAcceptedAgentActivityExecutions({
        activitySession: activitySession(executionFirst),
        db: getPostgresDatabase(env),
        nowMs: 2001,
      })
    ).resolves.toBe(1);
    await expect(
      linkAcceptedAgentActivityExecutions({
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
        nowMs: 2000,
      })
    ).resolves.toBe(0);
    await insertExecution(sessionFirst);
    await expect(
      linkAcceptedAgentActivityExecutions({
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
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
      db: getPostgresDatabase(env),
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
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET agent_controller_conversation_id = $1 WHERE binding_id = $2',
              values: [],
            },
            values: [conflictingConversationId, graph.bindingId],
          },
          {
            ...{
              text: 'UPDATE "openmeld"."openMeldDaemon_dispatch_result_inbox" SET result_payload_json = $1 WHERE runtime_coordinator_execution_id = $2',
              values: [],
            },
            values: [
              resultPayload(graph.controllerRef, conflictingConversationId),
              graph.executionId,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    await expect(
      linkAcceptedAgentActivityExecutions({
        db: getPostgresDatabase(env),
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
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Execution Link Org\', $2, 1)',
      values: [],
    },
    values: [graph.organizationId, `execution-link-${suffix}`],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."users" (
      id, name, email, email_verified, created_at, updated_at
    ) VALUES ($1, 'Execution Link Owner', $2, 1, 1, 1)`,
      values: [],
    },
    values: [graph.memberUserId, `execution-link-${suffix}@example.com`],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."space_index_spaces" (
      space_id, organization_id, organization_visibility, status,
      source_updated_at_ms, projected_at_ms, projection_event_id
    ) VALUES ($1, $2, 'private', 'active', 1, 1, $3)`,
      values: [],
    },
    values: [
      graph.spaceId,
      input.spaceOrganizationId ?? graph.organizationId,
      `projection_${suffix}`,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_registry_records" (
      openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane,
      created_at_ms, last_registered_at_ms, updated_at_ms
    ) VALUES ($1, 'owner_account', $2, $3, 'dev', 1, 1, 1)`,
      values: [],
    },
    values: [
      graph.runtimeId,
      input.runtimeOwnerId ?? graph.memberUserId,
      input.runtimeDeviceId ?? graph.deviceId,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."openmeld_profiles" (
      profile_id, profile_name, profile_handle, profile_kind, is_default,
      status, organization_id, owner_user_id, created_by_user_id, source,
      created_at, updated_at
    ) VALUES ($1, 'Execution Link Agent', $2, 'agent', 0, 'active', $3, $4, $5, 'cli_create', 1, 1)`,
      values: [],
    },
    values: [
      graph.agentProfileId,
      `execution-link-${suffix}`,
      graph.organizationId,
      graph.memberUserId,
      graph.memberUserId,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
      binding_id, owner_kind, owner_id, agent_profile_id,
      openmeld_service_runtime_id, runtime_kind, agent_controller_ref,
      agent_controller_conversation_id, binding_state,
      created_at_ms, updated_at_ms
    ) VALUES ($1, 'owner_account', $2, $3, $4, 'openmeld_service', $5, $6, 'enabled_primary', 1, 1)`,
      values: [],
    },
    values: [
      graph.bindingId,
      graph.memberUserId,
      graph.agentProfileId,
      graph.runtimeId,
      graph.controllerRef,
      graph.conversationId,
    ],
  });
  if (input.includeSession) {
    await insertSession(graph);
  }
  if (input.includeExecution) {
    await insertExecution(graph, input);
  }
  return graph;
}
async function insertSession(graph: Graph) {
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."agent_activity_sessions" (
      id, organization_id, project_id, member_user_id, device_id,
      openmeld_service_runtime_id, provider, client_kind,
      provider_session_id, title, model, status, git_branch, git_commit,
      repository_fingerprint, started_at_ms, last_observed_at_ms,
      expires_at_ms, provider_metadata_json, last_event_id,
      last_accepted_sequence, created_at_ms, updated_at_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL,
      'active', NULL, NULL, NULL, 900, 1000, 2000, '{}', $10, 1, 1000, 1000)`,
      values: [],
    },
    values: [
      graph.sessionId,
      graph.organizationId,
      graph.projectId,
      graph.memberUserId,
      graph.deviceId,
      graph.runtimeId,
      graph.provider,
      clientKindForProvider(graph.provider),
      graph.conversationId,
      `event_${graph.executionId}`,
    ],
  });
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
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions" (
      runtime_coordinator_execution_id, model_version, space_id, dispatch_id,
      target_profile_id, openMeld_service_runtime_id_source,
      openmeld_service_runtime_id, binding_id, agent_controller_ref, status,
      created_at_ms, updated_at_ms
    ) VALUES ($1, 'v1', $2, $3, $4, 'runtime_registry_authority', $5, $6, $7, $8, 1000, 1000)`,
      values: [],
    },
    values: [
      graph.executionId,
      graph.spaceId,
      graph.dispatchId,
      overrides.executionTargetProfileId ?? graph.agentProfileId,
      overrides.executionRuntimeId ?? graph.runtimeId,
      overrides.executionBindingId ?? graph.bindingId,
      controllerRef,
      overrides.executionStatus ?? "result_accepted",
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_result_inbox" (
      result_key, dispatch_id, attempt_id, task_id, target_profile_id,
      daemon_session_id, lease_epoch, submitted_connection_generation,
      runtime_coordinator_execution_id, result_payload_json, accepted_at_ms,
      publish_state, updated_at_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $8, 1500, 'pending_publication', 1500)`,
      values: [],
    },
    values: [
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
      ),
    ],
  });
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
  return await getPostgresDatabase(env)
    .query({
      ...{
        text: `SELECT activity_session_id, runtime_coordinator_execution_id,
      provider_conversation_id
    FROM "openmeld"."agent_activity_execution_links"
    WHERE runtime_coordinator_execution_id = $1`,
        values: [],
      },
      values: [executionId],
    })
    .then((result) => result.rows[0] ?? null);
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
