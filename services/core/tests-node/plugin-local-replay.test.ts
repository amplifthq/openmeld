import {
  openConnectorRuntimeActionSchema,
  pluginActionRpcInputSchema,
} from "@openmeld/schemas";
import type {
  PluginRuntimeRequest,
  PluginRuntimeResponse,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import capturedActions from "../../remote-agent/tests/fixtures/openconnector-runtime-actions.json";
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
}));
vi.mock("../src/rpc/methods", () => ({
  rpcReadPluginConnectionContinuationBinding: async () => null,
}));

const profileId = "agt_00000000-0000-4000-8000-000000000001";
const humanId = "22222222-2222-4222-8222-222222222222";
const connectionName = "synthetic-posthog-personal";
const action = openConnectorRuntimeActionSchema.parse({
  ...capturedActions.data[0],
  effect: "write",
  operationType: "write",
});
let harness: ReturnType<typeof createSqliteD1Harness>;
let providerCalls: PluginRuntimeRequest[];
let effects: Set<string>;
let submission: string;
let providerResult: "outcome_unknown" | "completed";
let env: CoreBindings;

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
  ]);
  harness.run({
    sql: "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('user-1', 'Synthetic member', 'synthetic@example.test', 1000, 1000)",
  });
  harness.run({
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('org-1', 'Synthetic organization', 'synthetic', 1000)",
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
  admission.caller.mockImplementation(async () => ({
    db: harness.db,
    organizationId: "org-1",
    actorProfileId: profileId,
    ownerUserId: "user-1",
    representedUserId: "user-1",
    sourceSpaceId: null,
    sourceSignalId: null,
    sourceRequestKey: submission,
    personalAllowed: true,
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
    OPENMELD_REMOTE_AGENT_WORKER: {
      pluginRuntime: (
        input: PluginRuntimeRequest
      ): Promise<PluginRuntimeResponse> => {
        if (input.operation === "list") {
          return Promise.resolve({
            status: "catalog",
            actions: [action],
          });
        }
        providerCalls.push(input);
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

describe("Local plugin replay through real operation and connection storage", () => {
  it("permits one concurrent replay, retains the provider key, and fences another operation ID", async () => {
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
});
