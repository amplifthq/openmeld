import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  buildPersonalRemoteAgentConversationId,
  buildRemoteAgentRuntimeConversationId,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  openMeldDaemonDispatchQueueMessageSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequestV2 } from "../../remote-agent/tests/fixtures";
import {
  activateAgentDelegationChildren,
  createAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import { prepareCenterAgentWakePublicationRecord } from "../src/center-agent/infrastructure/postgresql/center-agent-wake-publication-repo";
import { isDispatchRequestedByAgentOwner } from "../src/dispatch/application/accepted-dispatch-snapshot";
import type { CoreBindings } from "../src/lib/bindings";
import { readRemoteAgentDelegatedRequester } from "../src/remote-agent/application/delegated-requester";
import { prepareRemoteAgentMemberRequest } from "../src/remote-agent/application/remote-agent-member-request";
import { rpcCenterAgentResolveConnectorConnection } from "../src/rpc/methods";
import { postgresTestBinding } from "./helpers/postgresql-harness.test-support";

const caller = vi.hoisted(() => vi.fn());
vi.mock("../src/remote-agent/application/remote-agent-tool-caller", () => ({
  requireRemoteAgentToolCaller: caller,
}));

import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

// These cases cover the path without request chains; the enforced path is
// covered by the *-request-chain tests.
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => false,
  isRequestChainEnforced: () => false,
}));

const CENTER = "agt_00000000-0000-4000-8000-000000000001";
const CHILD = "agt_00000000-0000-4000-8000-000000000002";
const HUMAN = "22222222-2222-4222-8222-222222222222";

describe("delegated requester is a current projection of exact owner records", () => {
  it.each([
    "allowed",
    "allowed_secondary_space",
    "revoked",
    "other_organization",
    "other_owner",
    "unrecorded_wake",
    "wrong_space",
    "wrong_author",
    "cancelled",
    "changed_center",
    "unacknowledged_parent",
    "changed_parent_identity",
  ] as const)("checks the recorded chain: %s", async (scenario) => {
    const harness = await createPostgresHarness();
    try {
      await harness.query({
        text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('user_1','Felix','user1@example.test')`,
      });
      await harness.query({
        text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org_123','Organization','org-123',1000)`,
      });
      await harness.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id,profile_name,profile_handle,profile_kind,organization_id,created_by_user_id,managed_role,source,status) VALUES ($1,'Center Agent','center-agent','agent','org_123','user_1','center_agent','auth_bootstrap','active')`,
        values: [CENTER],
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"members\" (id, role, organization_id, user_id, \"created_at\") VALUES ('member_123', 'owner', 'org_123', 'user_1', 1700000000000)",
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, organization_id, profile_kind, profile_name, owner_user_id, managed_role, status, profile_handle, source, is_default) VALUES ($1, NULL, 'human', 'Felix', 'user_1', NULL, 'active', 'felix', 'auth_bootstrap', 1)",
        values: [HUMAN],
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, organization_id, profile_kind, profile_name, owner_user_id, managed_role, status, profile_handle, source) VALUES ($1, 'org_123', 'agent', 'Opus', 'user_1', NULL, 'active', 'opus', 'web_create')",
        values: [CHILD],
      });

      await harness.query({
        text: "INSERT INTO \"openmeld\".\"center_agent_designations\" (organization_id, agent_profile_id, duty, designated_by, operating_state, paused_at, paused_by_user_id, created_at) VALUES ('org_123', $1, NULL, NULL, 'active', NULL, NULL, 1)",
        values: [CENTER],
      });
      const parentRequest = createSubmitTurnRequestV2({
        agentProfileId: CENTER,
      });
      await insertDelivery(harness.db, parentRequest);
      const parent = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: parentRequest.idempotencyKey,
      });
      if (!parent?.submissionId) {
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
        spaceId: scenario === "allowed" ? request.spaceId : "space-first",
        children: [
          ...(scenario === "allowed"
            ? []
            : [
                {
                  agentProfileId: CHILD,
                  role: "primary" as const,
                  task: {
                    v: 1 as const,
                    kind: "space_wake" as const,
                    spaceId: "space-first",
                    sourceClientMessageId: "first-child-wake",
                    targetProfileId: CHILD,
                  },
                },
              ]),
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

      await harness.query({
        text: "INSERT INTO \"openmeld\".\"connector_connections\" (connection_name, organization_id, user_id, scope, service, status, access_policy, created_at_ms, updated_at_ms) VALUES ('exact-github', 'org_123', 'user_1', 'member', 'github', 'active', $1, 1, 1)",
        values: [
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
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
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
      const localOwnerRequest = async (
        sourceProfileId = input.request.author.profileId
      ) =>
        await isDispatchRequestedByAgentOwner({
          env: rpcEnv,
          targetOwnerUserId: input.request.agentProfileOwnerUserId ?? undefined,
          message: openMeldDaemonDispatchQueueMessageSchema.parse({
            v: 2,
            dispatchId: "local-child-dispatch",
            spaceId: input.delivery.spaceId,
            organizationId: input.delivery.organizationId,
            sourceEventId: "child-signal",
            sourceClientMessageId: input.delivery.sourceClientMessageId,
            targetProfileId: CHILD,
            dispatchOwner: { kind: "owner_account", id: "user_1" },
            dispatchChainId: "chain",
            autoRelayDepth: 0,
            visitedProfileIds: [],
            visitedProfileIdsHash: "stable32:11111111",
            dispatchContractVersion: 2,
            dispatchPolicy: "mention_only",
            ruleSource: "registry",
            ruleId: "registry.default.all_members.v1",
            ruleReason: "fixture",
            taskId: "child-task",
            transportMode: "codex-app-server",
            contextIdMappingSpec: null,
            controllerSnapshot: {
              bindingId: "child-binding",
              configurationRevision: 1,
              targetBindingState: "bound",
              targetBindingEnabled: true,
              agentControllerRef: "builtin:codex",
            },
            sourceSignalSnapshot: {
              profileId: sourceProfileId,
              profileKind: sourceProfileId === HUMAN ? "human" : "agent",
              text: "Continue the authorized task.",
            },
            dispatchRulesSnapshot: {
              dispatchPolicy: "mention_only",
              ruleSource: "registry",
              ruleId: "registry.default.all_members.v1",
              ruleReason: "fixture",
            },
            dispatchSnapshot: {
              dispatchPolicy: "mention_only",
              ruleSource: "registry",
              ruleId: "registry.default.all_members.v1",
              ruleReason: "fixture",
              targetBindingState: "bound",
              targetBindingEnabled: true,
            },
            idempotencyKey: "local-child",
            enqueuedAtMs: Date.now(),
          }),
        });
      expect(await localOwnerRequest()).toBe(true);
      expect(await localOwnerRequest(HUMAN)).toBe(true);
      const pluginAction = await seedPluginGrant({
        harness,
        parentSubmissionId: parent.submissionId,
        context: selectionInput.context,
        spaceId: request.spaceId,
      });
      await expect(
        rpcCenterAgentResolveConnectorConnection(rpcEnv, {
          ...selectionInput,
          service: "posthog",
        })
      ).resolves.toMatchObject({
        connection: { connectionName: "exact-posthog" },
        permission: "write",
      });
      for (const effect of ["read", "write"] as const) {
        await expect(
          prepareRemoteAgentMemberRequest(
            rpcEnv,
            selectionInput.context,
            { memberId: "member_123", userId: "user_1" },
            {
              ...pluginAction,
              effect,
              actionId: `fixture.${effect}`,
              requestSignature: await fixtureSignature(effect),
            }
          )
        ).resolves.toMatchObject({
          member: {
            userId: "user_1",
            sourceNativeDeliveryId: delivery.deliveryId,
          },
        });
      }
      for (const override of [
        { connectionName: "another-account" },
        { requestSignature: "0".repeat(64) },
        { effect: "destructive" },
        { actionId: "fixture.delete" },
      ]) {
        await expect(
          prepareRemoteAgentMemberRequest(
            rpcEnv,
            selectionInput.context,
            { memberId: "member_123", userId: "user_1" },
            { ...pluginAction, ...override }
          )
        ).rejects.toThrow("plugin.delegation_scope_mismatch");
      }
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
      if (scenario === "allowed" || scenario === "allowed_secondary_space") {
        await harness.query({
          text: `UPDATE "openmeld"."connector_connections" SET updated_at_ms = 2 WHERE connection_name = 'exact-posthog'`,
        });
        await expect(
          prepareRemoteAgentMemberRequest(
            rpcEnv,
            selectionInput.context,
            { memberId: "member_123", userId: "user_1" },
            pluginAction
          )
        ).rejects.toThrow("plugin.delegation_account_changed");
        await harness.query({
          text: "INSERT INTO \"openmeld\".\"connector_connections\" (connection_name, organization_id, user_id, scope, service, status, access_policy, created_at_ms, updated_at_ms) VALUES ('other-shared-account', 'org_123', 'user_1', 'shared', 'github', 'active', $1, 1, 1)",
          values: [
            JSON.stringify({
              center_agent: "write",
              remote_agent: "read",
              local_agent: "none",
            }),
          ],
        });
        await harness.query({
          text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = \'exact-github\'',
          values: [
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
        await harness.query({
          text: "UPDATE \"openmeld\".\"connector_connections\" SET access_policy = $1, status = 'disconnected', disconnected_at_ms = 2 WHERE connection_name = 'exact-github'",
          values: [
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
        await harness.query({ text: 'DELETE FROM "openmeld"."members"' });
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
      if (scenario === "wrong_space") {
        input.delivery = { ...delivery, spaceId: "unrecorded-space" };
      }
      if (scenario === "wrong_author") {
        input.request = {
          ...request,
          author: { ...request.author, profileId: CHILD },
        };
      }
      if (scenario === "cancelled") {
        await harness.query({
          text: 'UPDATE "openmeld"."agent_delegations" SET state = \'cancelled\'',
        });
      }
      if (scenario === "changed_center") {
        await harness.query({
          text: 'UPDATE "openmeld"."center_agent_designations" SET agent_profile_id = $1',
          values: [CHILD],
        });
      }
      if (scenario === "unacknowledged_parent") {
        await harness.query({
          text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET status = \'submitted\' WHERE delivery_id = $1',
          values: [parent.deliveryId],
        });
      }
      if (scenario === "changed_parent_identity") {
        await harness.query({
          text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET binding_id = \'replaced-binding\' WHERE delivery_id = $1',
          values: [parent.deliveryId],
        });
      }
      expect(await readRemoteAgentDelegatedRequester(input)).toBeNull();
      expect(await localOwnerRequest()).toBe(false);
      await expect(
        prepareRemoteAgentMemberRequest(
          rpcEnv,
          selectionInput.context,
          { memberId: "member_123", userId: "user_1" },
          pluginAction
        )
      ).rejects.toThrow("plugin.delegation_unavailable");
      await expect(
        rpcCenterAgentResolveConnectorConnection(rpcEnv, selectionInput)
      ).rejects.toThrow("no longer authorizes");
    } finally {
      await harness.close();
    }
  });
});

async function seedPluginGrant(input: {
  harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  parentSubmissionId: string;
  context: Parameters<typeof prepareRemoteAgentMemberRequest>[1];
  spaceId: string;
}) {
  const { harness } = input;

  await harness.query({
    text: "INSERT INTO \"openmeld\".\"connector_connections\" (connection_name, organization_id, user_id, scope, service, status, access_policy, created_at_ms, updated_at_ms) VALUES ('exact-posthog', 'org_123', 'user_1', 'member', 'posthog', 'active', $1, 1, 1)",
    values: [
      JSON.stringify({
        center_agent: "write",
        remote_agent: "write",
        local_agent: "write",
      }),
    ],
  });
  const requestSignature = await fixtureSignature("write");
  await prepareCenterAgentWakePublicationRecord({
    db: harness.db,
    nowMs: 1000,
    command: {
      v: 1,
      clientMessageId: "child-wake",
      delegationId: "delegation-1",
      organizationId: "org_123",
      spaceId: input.spaceId,
      context: {
        ...input.context,
        actorContext: {
          ...input.context.actorContext,
          openMeldProfileId: CENTER,
        },
        agentControllerConversationId: input.parentSubmissionId,
      },
      parentSubmissionId: input.parentSubmissionId,
      profile: { kind: "agent", profileId: CENTER, profileName: "Center" },
      attribution: {
        actorProfileId: CENTER,
        onBehalfOf: {
          userId: "user_1",
          profileId: HUMAN,
          displayName: "Felix",
        },
      },
      activationTargets: [CHILD],
      mentionTargets: [],
      referenceTargets: [],
      fallbackAgentProfileId: null,
      subscriptionIds: ["subscription-1"],
      text: "Use only the specified synthetic fixture.",
      completionMode: "resume_parent_when_all_terminal",
      pluginActions: await Promise.all(
        (["read", "write"] as const).map(async (effect) => ({
          targetProfileId: CHILD,
          service: "posthog" as const,
          connectionName: "exact-posthog",
          actionId: `fixture.${effect}`,
          effect,
          expiresAtMs: Date.now() + 60_000,
          connectionUpdatedAtMs: 1,
          connectionOwnerUserId: "user_1",
          connectionScope: "member" as const,
          requestSignature: await fixtureSignature(effect),
        }))
      ),
    },
  });
  await harness.query({
    text: 'UPDATE "openmeld"."center_agent_wake_publications" SET state = \'completed\', accepted_at_ms = 1100, completed_at_ms = 1200, signal_json = $1',
    values: [
      JSON.stringify({
        v: 1,
        id: "child-signal",
        type: "signal.text",
        ts: 1100,
        spaceId: input.spaceId,
        profile: { kind: "agent", profileId: CENTER, profileName: "Center" },
        data: {
          text: "Synthetic fixture",
          meta: { clientMessageId: "child-wake" },
          messageEnvelope: {
            text: "Synthetic fixture",
            activationTargets: [CHILD],
            referenceTargets: [],
          },
        },
      }),
    ],
  });
  return {
    service: "posthog",
    connectionName: "exact-posthog",
    actionId: "fixture.write",
    effect: "write",
    requestSignature,
  };
}

function fixtureSignature(effect: "read" | "write") {
  return digestCanonicalJson({
    actionId: `fixture.${effect}`,
    service: "posthog",
    connectionName: "exact-posthog",
    input: { target: "isolated-A", text: "synthetic" },
  });
}

async function insertDelivery(
  db: PostgresDatabase,
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
