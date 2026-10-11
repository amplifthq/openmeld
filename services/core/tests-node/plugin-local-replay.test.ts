import {
  openConnectorRuntimeActionSchema,
  pluginActionRpcInputSchema,
  pluginConnectionContinuationResponseSchema,
  pluginDelegationAuthorizationSchema,
} from "@openmeld/schemas";
import type {
  PluginRuntimeRequest,
  PluginRuntimeResponse,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import capturedActions from "../../remote-agent/tests/fixtures/openconnector-runtime-actions.json";
import {
  listPluginActionRequests,
  retryApprovedPluginActionRequests,
  rpcPluginActionRequest,
} from "../src/connectors/plugin-action-requests";
import { rpcPluginAction } from "../src/connectors/plugin-actions";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const admission = vi.hoisted(() => ({
  caller: vi.fn(),
  identity: vi.fn(),
  trace: vi.fn(),
  continue: vi.fn(),
}));
// This seam starts after identity admission. Connection policy, operation
// storage, replay claims and provider execution all run their real owners.
vi.mock("../src/connectors/plugin-local-caller", () => ({
  requireLocalPluginCaller: admission.caller,
}));
vi.mock("../src/organizations/organization-context", () => ({
  readOrganizationAccountIdentityProjection: admission.identity,
  resolveActiveOrganizationMembership: async () => ({
    ok: true,
    organizationId: "org-1",
    userId: "user-1",
  }),
}));
vi.mock("../src/rpc/methods", () => ({
  rpcGetSpaceMemberDirectory: vi.fn(async () => undefined),
  rpcReadPluginActionRequestLocations: vi.fn(async () => []),
  rpcReadPluginConnectionContinuationBinding: async () => null,
  rpcGetSpaceDispatchTrace: admission.trace,
}));
vi.mock("../src/connectors/plugin-connection-continuation", () => ({
  continuePluginConnection: admission.continue,
}));

const profileId = "agt_00000000-0000-4000-8000-000000000001";
const humanId = "22222222-2222-4222-8222-222222222222";
const connectionName = "synthetic-posthog-personal";
const action = openConnectorRuntimeActionSchema.parse({
  ...capturedActions.data[1],
  effect: "write",
  operationType: "write",
});
const readAction = openConnectorRuntimeActionSchema.parse({
  ...capturedActions.data[0],
  effect: "read",
  operationType: "read",
});
let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
let providerCalls: PluginRuntimeRequest[];
let effects: Set<string>;
let submission: string;
let authorizedRequestRoot: string | undefined;
let actorProfileId: string;
let sourceSpaceId: string | null;
let providerResult: "outcome_unknown" | "completed";
let env: CoreBindings;
let grants:
  | ReturnType<typeof pluginDelegationAuthorizationSchema.parse>[]
  | undefined;

function request(operationId = "original-operation", replay = false) {
  return pluginActionRpcInputSchema.parse({
    expectedOrganizationId: "org-1",
    context: {
      activeOrganizationId: "org-1",
      actorContext: {
        requestId: "fixture",
        profileKind: "agent",
        openMeldProfileId: profileId,
        ownerUserId: "user-1",
      },
    },
    request: {
      includeRecoveryReceipt: true,
      includeRequestAuthorization: true,
      action: {
        operation: "execute",
        service: "posthog",
        account: "personal",
        actionId: action.id,
        operationId,
        input: { project: "isolated-target" },
        replay,
      },
    },
  });
}

beforeEach(async () => {
  admission.trace.mockReset().mockResolvedValue({ trace: null });
  admission.continue.mockReset().mockResolvedValue(
    pluginConnectionContinuationResponseSchema.parse({
      status: "requested",
      sourceSignalId: "final-reply",
      signalId: "continued-message",
      spaceId: "space-1",
      targetProfileId: profileId,
      threadId: null,
    })
  );
  harness = await createPostgresHarness();

  await harness.query({
    text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, created_at, updated_at) VALUES ('user-1', 'Synthetic member', 'synthetic@example.test', 1000, 1000)",
    values: [],
  });
  await harness.query({
    text: "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org-1', 'Synthetic organization', 'synthetic', 1000)",
    values: [],
  });
  await harness.query({
    text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, created_at) VALUES ('member-1', 'org-1', 'user-1', 'owner', 1000)",
    values: [],
  });
  await harness.query({
    text: 'UPDATE "openmeld"."users" SET email_verified = 1 WHERE id = \'user-1\'',
    values: [],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ('${profileId}', 'Synthetic Agent', 'synthetic-agent', 'agent', 'org-1', 'user-1', 'cli_create')`,
    values: [],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ('${humanId}', 'Synthetic member', 'synthetic-member', 'human', NULL, 'user-1', 'cli_create')`,
    values: [],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."connector_connections" (connection_name, organization_id, user_id, scope, service, status, created_at_ms, updated_at_ms, access_policy) VALUES ('${connectionName}', 'org-1', 'user-1', 'member', 'posthog', 'active', 1000, 1000, '{"local_agent":"write","remote_agent":"none","center_agent":"none"}')`,
    values: [],
  });
  submission = "dispatch:original-request";
  authorizedRequestRoot = undefined;
  actorProfileId = profileId;
  grants = undefined;
  sourceSpaceId = null;
  admission.caller.mockImplementation(async () => ({
    db: harness.db,
    organizationId: "org-1",
    actorProfileId,
    ownerUserId: "user-1",
    representedUserId: "user-1",
    sourceSpaceId,
    sourceSignalId: sourceSpaceId ? "original-message" : null,
    sourceRequestKey: submission,
    authorizedRequestRoot,
    personalAllowed: true,
    delegatedPluginActions: grants,
    human: { profileId: humanId, profileName: "Synthetic member" },
  }));
  admission.identity.mockResolvedValue({
    ok: true,
    organization: { id: "org-1" },
    account: { userId: "user-1", displayName: "Synthetic member" },
  });
  providerCalls = [];
  effects = new Set();
  providerResult = "outcome_unknown";
  env = {
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
    OPENMELD_REMOTE_AGENT_WORKER: {
      pluginRuntime: (
        input: PluginRuntimeRequest
      ): Promise<PluginRuntimeResponse> => {
        if (input.operation === "list") {
          return Promise.resolve({
            status: "catalog",
            actions: [action, readAction],
          });
        }
        providerCalls.push(input);
        if (input.actionId === readAction.id) {
          return Promise.resolve({
            status: "completed",
            providerExecutionId: "synthetic-read-execution",
            data: [],
            outputSchema: { type: "array" },
          });
        }
        effects.add(input.idempotencyKey);
        return Promise.resolve(
          providerResult === "completed"
            ? {
                status: "completed",
                providerExecutionId: "synthetic-provider-execution",
                data: { target: "isolated-target" },
                outputSchema: { type: "object" },
              }
            : {
                status: "outcome_unknown",
                providerExecutionId: null,
                error: "Synthetic transport loss after effect",
              }
        );
      },
    },
  } as unknown as CoreBindings;
});
afterEach(() => harness.close());

async function approveRequest(input = request()) {
  const pending = await rpcPluginAction(env, input);
  if (pending.kind !== "authorization_required") {
    throw new Error("Expected exact pending authority");
  }
  const context = {
    ...input.context,
    actorContext: {
      ...input.context.actorContext,
      openMeldProfileId: humanId,
      profileKind: "human" as const,
      callerPrincipalId: "user-1",
    },
  };
  const scope = { context, expectedOrganizationId: "org-1" };
  await rpcPluginActionRequest(env, {
    ...scope,
    command: {
      operation: "approve",
      requestId: pending.request.requestId,
    },
  });
}

describe("Local plugin replay through real operation and connection storage", () => {
  it("lists all pending requests in the current Space independently of loaded messages", async () => {
    sourceSpaceId = "space-1";
    const first = await rpcPluginAction(env, request("offscreen-request"));
    if (first.kind !== "authorization_required") {
      throw new Error("Expected approval");
    }
    sourceSpaceId = "space-2";
    await rpcPluginAction(env, request("another-space"));
    const scope = {
      context: request().context,
      expectedOrganizationId: "org-1",
      spaceId: "space-1",
    };
    const listed = await listPluginActionRequests(env, scope);
    expect(listed.requests.map((item) => item.requestId)).toEqual([
      first.request.requestId,
    ]);
    expect(listed.requests[0]?.sourceSignalId).toBe("original-message");
    expect(listed.requests[0]?.sourceThreadId).toBeUndefined();
    const humanContext = {
      ...scope.context,
      actorContext: {
        ...scope.context.actorContext,
        openMeldProfileId: humanId,
        profileKind: "human" as const,
        callerPrincipalId: "user-1",
      },
    };
    await rpcPluginActionRequest(env, {
      expectedOrganizationId: scope.expectedOrganizationId,
      context: humanContext,
      command: { operation: "reject", requestId: first.request.requestId },
    });
    expect((await listPluginActionRequests(env, scope)).requests).toEqual([]);
  });
  it("retains approved delivery while the visible reply is ahead of coordinator completion", async () => {
    sourceSpaceId = "space-1";
    admission.trace.mockResolvedValue({
      trace: {
        finalVisibleMessage: { signalId: "final-reply" },
        runtimeCoordinatorExecution: {
          status: "running",
          terminalOutcome: null,
        },
        result: null,
      },
    });
    await approveRequest();
    expect(admission.continue).not.toHaveBeenCalled();
    admission.trace.mockResolvedValue({
      trace: {
        finalVisibleMessage: { signalId: "final-reply" },
        runtimeCoordinatorExecution: {
          status: "reply_published",
          terminalOutcome: { kind: "reply_published" },
        },
        result: null,
      },
    });
    await retryApprovedPluginActionRequests({ ...env });
    expect(admission.continue).not.toHaveBeenCalled();
    admission.trace.mockResolvedValue({
      trace: {
        finalVisibleMessage: { signalId: "final-reply" },
        runtimeCoordinatorExecution: {
          status: "reply_published",
          terminalOutcome: { kind: "reply_published" },
        },
        result: { publishedSignalId: "final-reply", statusType: null },
      },
    });
    await retryApprovedPluginActionRequests({ ...env });
    await retryApprovedPluginActionRequests({ ...env });
    expect(admission.continue).toHaveBeenCalledTimes(1);
    expect(admission.continue).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ sourceSignalId: "final-reply" }),
      expect.objectContaining({
        intent: expect.objectContaining({ operationId: "original-operation" }),
      })
    );
    expect(providerCalls).toHaveLength(0);
  });
  it.each([
    "approve",
    "reject",
  ] as const)("retains %s across restart without executing the provider from approval", async (operation) => {
    sourceSpaceId = "space-1";
    const pending = await rpcPluginAction(env, request());
    if (pending.kind !== "authorization_required") {
      throw new Error("Expected pending request");
    }
    const command = {
      context: {
        activeOrganizationId: "org-1",
        actorContext: {
          requestId: "human-decision",
          openMeldProfileId: humanId,
          profileKind: "human" as const,
          callerPrincipalId: "user-1",
        },
      },
      expectedOrganizationId: "org-1",
      command: { operation, requestId: pending.request.requestId },
    };
    const decision = await rpcPluginActionRequest(env, command);
    expect(decision.state).toBe(
      operation === "approve" ? "approved" : "rejected"
    );
    expect(decision.continuation).toBe(
      operation === "approve" ? "pending" : null
    );
    await rpcPluginActionRequest(env, command);
    await retryApprovedPluginActionRequests({ ...env });
    const stored = await harness.query<{ continuation_json: string | null }>({
      text: 'SELECT continuation_json FROM "openmeld"."plugin_action_requests" WHERE id = $1',
      values: [pending.request.requestId],
    });
    expect(stored.rows[0]?.continuation_json !== null).toBe(
      operation === "approve"
    );
    expect(providerCalls).toHaveLength(0);
    await harness.query({
      text: 'UPDATE "openmeld"."plugin_action_requests" SET expires_at_ms = 0 WHERE id = $1',
      values: [pending.request.requestId],
    });
    await retryApprovedPluginActionRequests(env);
    const expired = await rpcPluginActionRequest(env, {
      ...command,
      command: { operation: "read", requestId: pending.request.requestId },
    });
    expect(expired.continuation).toBe(
      operation === "approve" ? "unavailable" : null
    );
    expect(providerCalls).toHaveLength(0);
  });

  it("reuses a verified task across cold continuations and selected executors without another approval or write", async () => {
    authorizedRequestRoot = "verified-parent-delivery";
    expect(await rpcPluginAction(env, request())).toMatchObject({
      status: "outcome_unknown",
    });
    expect(
      await rpcPluginAction({ ...env }, request("new-operation-id"))
    ).toMatchObject({
      status: "outcome_unknown",
      operationId: "original-operation",
      replayed: true,
    });
    actorProfileId = "agt_00000000-0000-4000-8000-000000000002";
    expect(
      await rpcPluginAction(env, request("child-operation"))
    ).toMatchObject({
      status: "outcome_unknown",
      operationId: "original-operation",
      replay: { allowed: false },
    });
    expect(providerCalls).toHaveLength(1);
    expect(
      await harness.db.query({
        text: 'SELECT id FROM "openmeld"."plugin_action_requests"',
        values: [],
      })
    ).toMatchObject({ rows: [] });
    actorProfileId = profileId;
    await rpcPluginAction(env, request("original-operation", true));
    expect(providerCalls).toHaveLength(2);
    expect(effects.size).toBe(1);
    authorizedRequestRoot = "independent-human-request";
    providerResult = "completed";
    expect(
      await rpcPluginAction(env, request("independent-operation"))
    ).toMatchObject({ status: "completed" });
    expect(effects.size).toBe(2);
  });
  it.each([
    "allowed",
    "target",
    "account",
    "effect",
    "expired",
    "replaced",
  ])("enforces the admitted delegation's exact action against real storage: %s", async (scenario) => {
    grants = [
      pluginDelegationAuthorizationSchema.parse({
        targetProfileId: profileId,
        service: "posthog",
        actionId: action.id,
        connectionName,
        connectionUpdatedAtMs: 1000,
        connectionOwnerUserId: "user-1",
        connectionScope: "member",
        effect: scenario === "effect" ? "read" : "write",
        expiresAtMs:
          scenario === "expired" ? Date.now() - 1 : Date.now() + 60_000,
        requestSignature: await digestCanonicalJson({
          actionId: action.id,
          service: "posthog",
          connectionName,
          input: { project: "isolated-target" },
        }),
      }),
    ];
    const input = request();
    if (input.request.action.operation !== "execute") {
      throw new Error("Expected execute fixture");
    }
    if (scenario === "target") {
      input.request.action.input = { project: "different-target" };
    }
    if (scenario === "account") {
      input.request.action.account = "shared";
    }
    if (scenario === "replaced") {
      await harness.query({
        text: 'UPDATE "openmeld"."connector_connections" SET updated_at_ms = 1001',
        values: [],
      });
    }
    if (scenario === "allowed") {
      providerResult = "completed";
      await approveRequest(input);
      expect(await rpcPluginAction(env, input)).toMatchObject({
        status: "completed",
      });
      expect(providerCalls).toHaveLength(1);
    } else {
      await expect(rpcPluginAction(env, input)).rejects.toThrow();
      expect(providerCalls).toHaveLength(0);
      expect(effects.size).toBe(0);
    }
  });

  it("permits one concurrent replay, retains the provider key, and fences another operation ID", async () => {
    await approveRequest();
    expect(await rpcPluginAction(env, request())).toMatchObject({
      status: "outcome_unknown",
      replay: { allowed: true, maxAttempts: 1 },
    });
    expect(providerCalls).toHaveLength(1);
    await rpcPluginAction(env, request());
    await rpcPluginAction(env, request("replacement-id"));
    expect(providerCalls).toHaveLength(1);
    await Promise.all([
      rpcPluginAction(env, request("original-operation", true)),
      rpcPluginAction(env, request("original-operation", true)),
    ]);
    expect(providerCalls).toHaveLength(2);
    expect(effects.size).toBe(1);
    expect(
      await rpcPluginAction(env, request("original-operation", true))
    ).toMatchObject({ replay: { allowed: false, reason: "already_replayed" } });
    expect(providerCalls).toHaveLength(2);
    submission = "dispatch:explicit-new-request";
    providerResult = "completed";
    await approveRequest(request("explicit-new-operation"));
    expect(
      await rpcPluginAction(env, request("explicit-new-operation"))
    ).toMatchObject({
      status: "completed",
      data: { target: "isolated-target" },
    });
    expect(providerCalls).toHaveLength(3);
    expect(effects.size).toBe(2);
  });

  it("denies revoked access and changed input without another provider call", async () => {
    await approveRequest();
    await rpcPluginAction(env, request());
    const changed = request("original-operation", true);
    if (changed.request.action.operation !== "execute") {
      throw new Error("Expected execute fixture");
    }
    changed.request.action.input = { project: "different-target" };
    await expect(rpcPluginAction(env, changed)).rejects.toThrow();
    await harness.query({
      text: 'UPDATE "openmeld"."connector_connections" SET access_policy = \'{"local_agent":"none","remote_agent":"none","center_agent":"none"}\'',
      values: [],
    });
    await expect(
      rpcPluginAction(env, request("original-operation", true))
    ).rejects.toThrow("plugin.action_forbidden");
    expect(providerCalls).toHaveLength(1);
  });

  it("does not replay after the same connection name is replaced", async () => {
    await approveRequest();
    await rpcPluginAction(env, request());
    await harness.query({
      text: 'UPDATE "openmeld"."connector_connections" SET updated_at_ms = 2000',
      values: [],
    });
    await expect(
      rpcPluginAction(env, request("original-operation", true))
    ).rejects.toThrow("plugin.operation_identity_changed");
    expect(providerCalls).toHaveLength(1);
  });

  it("binds a target read to the original account and keeps a page without a match unknown", async () => {
    await approveRequest();
    await rpcPluginAction(env, request());
    const check = request("verification-read");
    if (check.request.action.operation !== "execute") {
      throw new Error("Expected execute fixture");
    }
    check.request.action.actionId = readAction.id;
    check.request.action.verificationOf = {
      operationId: "original-operation",
      actionId: action.id,
    };
    const result = await rpcPluginAction(env, check);
    expect(result).toMatchObject({
      status: "completed",
      data: [],
      verificationOf: {
        operationId: "original-operation",
        actionId: action.id,
        status: "outcome_unknown",
        interpretation: "read_evidence_only",
        connection: { connectionName, ownerUserId: "user-1" },
      },
    });
    expect(providerCalls).toHaveLength(2);
    expect(effects.size).toBe(1);
    expect(await rpcPluginAction(env, request())).toMatchObject({
      status: "outcome_unknown",
    });
    const wrong = request("invalid-verification-write");
    if (wrong.request.action.operation !== "execute") {
      throw new Error("Expected execute fixture");
    }
    wrong.request.action.verificationOf = check.request.action.verificationOf;
    await expect(rpcPluginAction(env, wrong)).rejects.toThrow(
      "plugin.verification_scope_mismatch"
    );
    expect(providerCalls).toHaveLength(2);
  });

  it("keeps a legacy unknown receipt readable without granting replay", async () => {
    await approveRequest();
    await rpcPluginAction(env, request());
    await harness.query({
      text: 'UPDATE "openmeld"."center_agent_connector_action_operations" SET connection_updated_at_ms = NULL',
      values: [],
    });
    const receipt = await rpcPluginAction(
      env,
      request("original-operation", true)
    );
    expect(receipt).toMatchObject({
      status: "outcome_unknown",
      replay: { allowed: false, reason: "original_account_unverified" },
    });
    expect(providerCalls).toHaveLength(1);
  });
});
