import {
  openConnectorRuntimeActionSchema,
  pluginActionRpcInputSchema,
  pluginDelegationAuthorizationSchema,
} from "@openmeld/schemas";
import type {
  PluginRuntimeRequest,
  PluginRuntimeResponse,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import capturedActions from "../../remote-agent/tests/fixtures/openconnector-runtime-actions.json";
import { rpcPluginActionRequest } from "../src/connectors/plugin-action-requests";
import { rpcPluginAction } from "../src/connectors/plugin-actions";
import type { CoreBindings } from "../src/lib/bindings";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const admission = vi.hoisted(() => ({ caller: vi.fn(), identity: vi.fn() }));
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
  rpcReadPluginConnectionContinuationBinding: async () => null,
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
let harness: ReturnType<typeof createSqliteD1Harness>;
let providerCalls: PluginRuntimeRequest[];
let effects: Set<string>;
let submission: string;
let authorizedRequestRoot: string | undefined;
let actorProfileId: string;
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

beforeEach(() => {
  harness = createSqliteD1Harness();
  applyDrizzleMigrationsForTables(harness, [
    "users",
    "organizations",
    "members",
    "openmeld_profiles",
    "connector_connections",
    "center_agent_connector_action_operations",
    "center_agent_audit_journal",
    "plugin_action_requests",
    "inbox_items",
    "inbox_email_deliveries",
  ]);
  harness.run({
    sql: "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('user-1', 'Synthetic member', 'synthetic@example.test', 1000, 1000)",
  });
  harness.run({
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('org-1', 'Synthetic organization', 'synthetic', 1000)",
  });
  harness.run({
    sql: "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES ('member-1', 'org-1', 'user-1', 'owner', 1000)",
  });
  harness.run({
    sql: "UPDATE users SET email_verified = 1 WHERE id = 'user-1'",
  });
  harness.run({
    sql: `INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ('${profileId}', 'Synthetic Agent', 'synthetic-agent', 'agent', 'org-1', 'user-1', 'cli_create')`,
  });
  harness.run({
    sql: `INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ('${humanId}', 'Synthetic member', 'synthetic-member', 'human', NULL, 'user-1', 'cli_create')`,
  });
  harness.run({
    sql: `INSERT INTO connector_connections (connection_name, organization_id, user_id, scope, service, status, created_at_ms, updated_at_ms, access_policy) VALUES ('${connectionName}', 'org-1', 'user-1', 'member', 'posthog', 'active', 1000, 1000, '{"local_agent":"write","remote_agent":"none","center_agent":"none"}')`,
  });
  submission = "dispatch:original-request";
  authorizedRequestRoot = undefined;
  actorProfileId = profileId;
  grants = undefined;
  admission.caller.mockImplementation(async () => ({
    db: harness.db,
    organizationId: "org-1",
    actorProfileId,
    ownerUserId: "user-1",
    representedUserId: "user-1",
    sourceSpaceId: null,
    sourceSignalId: null,
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
    OPENMELD_DB: harness.db,
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
      await harness.db.prepare("SELECT id FROM plugin_action_requests").all()
    ).toMatchObject({ results: [] });
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
      harness.run({
        sql: "UPDATE connector_connections SET updated_at_ms = 1001",
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
    harness.run({
      sql: 'UPDATE connector_connections SET access_policy = \'{"local_agent":"none","remote_agent":"none","center_agent":"none"}\'',
    });
    await expect(
      rpcPluginAction(env, request("original-operation", true))
    ).rejects.toThrow("plugin.action_forbidden");
    expect(providerCalls).toHaveLength(1);
  });

  it("does not replay after the same connection name is replaced", async () => {
    await approveRequest();
    await rpcPluginAction(env, request());
    harness.run({
      sql: "UPDATE connector_connections SET updated_at_ms = 2000",
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
    harness.run({
      sql: "UPDATE center_agent_connector_action_operations SET connection_updated_at_ms = NULL",
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
