import {
  buildPersonalRemoteAgentConversationId,
  buildRemoteAgentRuntimeConversationId,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequestV2 } from "../../remote-agent/tests/fixtures";
import {
  activateAgentDelegationChildren,
  createAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { readRemoteAgentDelegatedRequester } from "../src/remote-agent/application/delegated-requester";
import { rpcCenterAgentResolveConnectorConnection } from "../src/rpc/methods";

const caller = vi.hoisted(() => vi.fn());
vi.mock("../src/remote-agent/application/remote-agent-tool-caller", () => ({
  requireRemoteAgentToolCaller: caller,
}));

import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CENTER = "agt_00000000-0000-4000-8000-000000000001";
const CHILD = "agt_00000000-0000-4000-8000-000000000002";
const HUMAN = "22222222-2222-4222-8222-222222222222";

describe("delegated requester is a current projection of exact owner records", () => {
  it.each([
    "allowed",
    "revoked",
    "other_organization",
    "other_owner",
    "unrecorded_wake",
    "wrong_author",
    "cancelled",
    "changed_center",
    "unacknowledged_parent",
    "changed_parent_identity",
  ] as const)("checks the recorded chain: %s", async (scenario) => {
    const harness = createSqliteD1Harness();
    try {
      for (const table of [
        "openMeldRemoteAgent_native_delivery_ledger",
        "agent_delegations",
        "agent_delegation_children",
      ]) {
        applyDrizzleMigrationForTable(harness, table);
      }
      harness.run({
        sql: "CREATE TABLE members (id TEXT, role TEXT, organization_id TEXT, user_id TEXT)",
      });
      harness.run({
        sql: "CREATE TABLE openmeld_profiles (profile_id TEXT, organization_id TEXT, profile_kind TEXT, profile_name TEXT, owner_user_id TEXT, managed_role TEXT, status TEXT)",
      });
      harness.run({
        sql: "INSERT INTO members VALUES ('member_123', 'owner', 'org_123', 'user_1')",
      });
      harness.run({
        sql: "INSERT INTO openmeld_profiles VALUES (?, 'org_123', 'human', 'Felix', 'user_1', NULL, 'active')",
        params: [HUMAN],
      });
      harness.run({
        sql: "INSERT INTO openmeld_profiles VALUES (?, 'org_123', 'agent', 'Opus', 'user_1', NULL, 'active')",
        params: [CHILD],
      });
      harness.run({
        sql: "CREATE TABLE center_agent_designations (organization_id TEXT, agent_profile_id TEXT, duty TEXT, designated_by TEXT, operating_state TEXT, paused_at INTEGER, paused_by_user_id TEXT, created_at INTEGER)",
      });
      harness.run({
        sql: "INSERT INTO center_agent_designations VALUES ('org_123', ?, NULL, NULL, 'active', NULL, NULL, 1)",
        params: [CENTER],
      });
      const parentRequest = createSubmitTurnRequestV2({
        agentProfileId: CENTER,
      });
      await insertDelivery(harness.db, parentRequest);
      const parent = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: parentRequest.idempotencyKey,
      });
      if (!parent) {
        throw new Error("Parent fixture not persisted");
      }
      const legacy = createSubmitTurnRequestV2({
        agentProfileId: CHILD,
        bindingId: "child-binding",
        dispatchId: "child-dispatch",
        idempotencyKey: "child-identity",
        sourceClientMessageId: "child-wake",
        author: {
          profileId: CENTER,
          profileKind: "agent",
          displayName: "Center",
        },
        turnEnvelope: {
          ...parentRequest.turnEnvelope,
          sender: {
            kind: "agent_profile",
            id: CENTER,
            profileId: CENTER,
            displayName: "Center",
            verified: true,
          },
          trigger: { source: "space_wake" },
        },
      });
      const conversationId = buildPersonalRemoteAgentConversationId(legacy);
      const request = remoteAgentWorkerSubmitTurnRequestSchema.parse({
        ...legacy,
        v: 4,
        conversationId,
        conversationIdentity: { kind: "personal_agent", agentProfileId: CHILD },
        runtimeConversation: {
          generation: 0,
          id: buildRemoteAgentRuntimeConversationId({
            generation: 0,
            logicalConversationId: conversationId,
            organizationId: legacy.organizationId,
          }),
        },
        spaceDispatchContext: {
          dispatchChainId: "child-chain",
          autoRelayDepth: 1,
          visitedProfileIds: [CENTER],
          visitedProfileIdsHash: "child-chain-hash",
        },
      });
      await insertDelivery(harness.db, request);
      const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: request.idempotencyKey,
      });
      if (!delivery) {
        throw new Error("Child fixture not persisted");
      }
      await createAgentDelegation({
        db: harness.db,
        delegationId: "delegation-1",
        idempotencyKey: "delegation-key",
        organizationId: request.organizationId,
        parentTask: {
          v: 1,
          kind: "native_delivery",
          deliveryId: parent.deliveryId,
        },
        spaceId: request.spaceId,
        children: [
          {
            agentProfileId: CHILD,
            role: "primary",
            task: {
              v: 1,
              kind: "space_wake",
              spaceId: request.spaceId,
              sourceClientMessageId: "child-wake",
              targetProfileId: CHILD,
            },
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        nowMs: 1000,
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-1",
        nowMs: 1100,
      });
      const input = {
        identityDb: harness.db,
        evidenceDb: harness.db,
        delivery,
        request,
      };
      const result = await readRemoteAgentDelegatedRequester(input);
      expect(result).toEqual({
        delegationId: "delegation-1",
        parentDeliveryId: parent.deliveryId,
        memberId: "member_123",
        userId: "user_1",
        profileId: HUMAN,
      });
      harness.run({ sql: "CREATE TABLE users (id TEXT PRIMARY KEY)" });
      harness.run({ sql: "INSERT INTO users VALUES ('user_1')" });
      harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
      harness.run({ sql: "INSERT INTO organizations VALUES ('org_123')" });
      applyDrizzleMigrationForTable(harness, "connector_connections");
      harness.run({
        sql: "INSERT INTO connector_connections (connection_name, organization_id, user_id, scope, service, status, access_policy, created_at_ms, updated_at_ms) VALUES ('exact-github', 'org_123', 'user_1', 'member', 'github', 'active', ?, 1, 1)",
        params: [
          JSON.stringify({
            center_agent: "none",
            remote_agent: "read",
            local_agent: "none",
          }),
        ],
      });
      caller.mockImplementation(async () => ({
        db: harness.db,
        activeOrganization: { organizationId: "org_123", userId: "user_1" },
        personalExecution: { delivery: input.delivery, request: input.request },
      }));
      const rpcEnv = {
        OPENMELD_DB: harness.db,
        OPENMELD_AUTH_WORKER: {
          resolveUserDisplayName: async () => ({
            ok: true,
            userId: "user_1",
            displayName: "Felix",
          }),
        },
      } as unknown as CoreBindings;
      const selectionInput = {
        context: {
          activeOrganizationId: "org_123",
          agentControllerConversationId: delivery.submissionId ?? undefined,
          actorContext: {
            agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
            callerPrincipalId: "user_1",
            ownerUserId: "user_1",
            openMeldProfileId: CHILD,
            profileKind: "agent" as const,
            requestId: "select-github",
          },
        },
        service: "github" as const,
        requesterUserId: "user_1",
        includeAccessPolicy: true as const,
        includeDelegatedRequester: true as const,
        connectionPreference: "requester" as const,
      };
      await expect(
        rpcCenterAgentResolveConnectorConnection(rpcEnv, selectionInput)
      ).resolves.toMatchObject({
        connection: { connectionName: "exact-github", userId: "user_1" },
        selection: "requester",
        permission: "read",
      });
      await expect(
        rpcCenterAgentResolveConnectorConnection(rpcEnv, {
          ...selectionInput,
          requesterUserId: "another-user",
        })
      ).rejects.toThrow("no longer authorizes");
      if (scenario === "allowed") {
        harness.run({
          sql: "INSERT INTO connector_connections (connection_name, organization_id, user_id, scope, service, status, access_policy, created_at_ms, updated_at_ms) VALUES ('other-shared-account', 'org_123', 'user_1', 'shared', 'github', 'active', ?, 1, 1)",
          params: [
            JSON.stringify({
              center_agent: "write",
              remote_agent: "read",
              local_agent: "none",
            }),
          ],
        });
        harness.run({
          sql: "UPDATE connector_connections SET access_policy = ? WHERE connection_name = 'exact-github'",
          params: [
            JSON.stringify({
              center_agent: "write",
              remote_agent: "none",
              local_agent: "none",
            }),
          ],
        });
        await expect(
          rpcCenterAgentResolveConnectorConnection(rpcEnv, selectionInput)
        ).resolves.toMatchObject({ connection: null, selection: null });
        // The parent's Center permission does not substitute for the target Agent's policy.
        harness.run({
          sql: "UPDATE connector_connections SET access_policy = ?, status = 'disconnected', disconnected_at_ms = 2 WHERE connection_name = 'exact-github'",
          params: [
            JSON.stringify({
              center_agent: "none",
              remote_agent: "read",
              local_agent: "none",
            }),
          ],
        });
        await expect(
          rpcCenterAgentResolveConnectorConnection(rpcEnv, selectionInput)
        ).resolves.toMatchObject({ connection: null, selection: null });
        return;
      }
      if (scenario === "revoked") {
        harness.run({ sql: "DELETE FROM members" });
      }
      if (scenario === "other_organization") {
        input.delivery = { ...delivery, organizationId: "other-org" };
      }
      if (scenario === "other_owner") {
        input.request = { ...request, agentProfileOwnerUserId: "another-user" };
      }
      if (scenario === "unrecorded_wake") {
        input.delivery = {
          ...delivery,
          sourceClientMessageId: "unrecorded-wake",
        };
      }
      if (scenario === "wrong_author") {
        input.request = {
          ...request,
          author: { ...request.author, profileId: CHILD },
        };
      }
      if (scenario === "cancelled") {
        harness.run({
          sql: "UPDATE agent_delegations SET state = 'cancelled'",
        });
      }
      if (scenario === "changed_center") {
        harness.run({
          sql: "UPDATE center_agent_designations SET agent_profile_id = ?",
          params: [CHILD],
        });
      }
      if (scenario === "unacknowledged_parent") {
        harness.run({
          sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET status = 'submitted' WHERE delivery_id = ?",
          params: [parent.deliveryId],
        });
      }
      if (scenario === "changed_parent_identity") {
        harness.run({
          sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET binding_id = 'replaced-binding' WHERE delivery_id = ?",
          params: [parent.deliveryId],
        });
      }
      expect(await readRemoteAgentDelegatedRequester(input)).toBeNull();
      await expect(
        rpcCenterAgentResolveConnectorConnection(rpcEnv, selectionInput)
      ).rejects.toThrow("no longer authorizes");
    } finally {
      harness.close();
    }
  });
});

async function insertDelivery(
  db: D1Database,
  request: RemoteAgentWorkerSubmitTurnRequest
) {
  await upsertRemoteAgentNativeDeliveryRecord({
    db,
    nowMs: 1000,
    attemptId: null,
    bindingId: request.bindingId,
    dispatchId: request.dispatchId,
    idempotencyKey: request.idempotencyKey,
    organizationId: request.organizationId,
    profileId: request.agentProfileId,
    sourceClientMessageId: request.sourceClientMessageId ?? null,
    spaceId: request.spaceId,
    triggerMessageId: request.triggerMessageId,
    status: "submitted",
  });
  await persistRemoteAgentWorkerSubmitRequest({
    db,
    nowMs: 1000,
    idempotencyKey: request.idempotencyKey,
    workerSubmitRequest: request,
  });
  await markRemoteAgentNativeDeliveryAck({
    db,
    nowMs: 1100,
    idempotencyKey: request.idempotencyKey,
    submissionId: `submission:${request.dispatchId}`,
    workerRequestId: `worker:${request.dispatchId}`,
    accepted: true,
  });
}
