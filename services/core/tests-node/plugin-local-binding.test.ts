import { pluginActionRpcInputSchema } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeLocalPluginConnection,
  rpcPluginAction,
} from "../src/connectors/plugin-actions";
import type { CoreBindings } from "../src/lib/bindings";

const owner = vi.hoisted(() => ({
  caller: vi.fn(),
  binding: vi.fn(),
  selection: vi.fn(),
  policy: vi.fn(),
  identity: vi.fn(),
  runtime: vi.fn(),
  describe: vi.fn(),
  native: vi.fn(),
  computer: vi.fn(),
}));
vi.mock("../src/computer/personal-computer", () => ({
  ensurePersonalComputer: owner.computer,
}));
vi.mock("../src/connectors/plugin-local-caller", () => ({
  requireLocalPluginCaller: owner.caller,
}));
vi.mock(
  "../src/connectors/plugin-connection-execution-binding",
  async (load) => ({
    ...(await load<
      typeof import("../src/connectors/plugin-connection-execution-binding")
    >()),
    readSpacePluginConnectionBinding: owner.binding,
  })
);
vi.mock("../src/connectors/plugin-access", async (load) => ({
  ...(await load<typeof import("../src/connectors/plugin-access")>()),
  selectPluginConnection: owner.selection,
  readPluginAccess: owner.policy,
}));
vi.mock("../src/organizations/organization-context", () => ({
  readOrganizationAccountIdentityProjection: owner.identity,
}));
const organizationId = "org";
const NATIVE_CONNECTION_URL =
  /^http:\/\/computer\.internal\/connections\/[a-f0-9]{64}$/u;
const profileId = "agt_33333333-3333-4333-8333-333333333333";
const request = (account: "personal" | "shared") =>
  pluginActionRpcInputSchema.parse({
    expectedOrganizationId: organizationId,
    context: {
      activeOrganizationId: organizationId,
      actorContext: {
        requestId: "local-binding",
        profileKind: "agent",
        openMeldProfileId: profileId,
        ownerUserId: "user",
      },
    },
    request: { action: { operation: "actions", service: "linear", account } },
  });
const connection = {
  organizationId,
  createdAtMs: 1,
  disconnectedAtMs: null,
  status: "active",
  service: "linear",
  scope: "shared",
  userId: "user",
  connectionName: "linear-team",
  updatedAtMs: 42,
};
const env = {
  OPENMELD_REMOTE_AGENT_WORKER: {
    pluginRuntime: owner.runtime,
    describePluginConnection: owner.describe,
    createPluginComputerConnection: owner.native,
  },
} as unknown as CoreBindings;
beforeEach(() => {
  for (const mock of Object.values(owner)) {
    mock.mockReset();
  }
  owner.caller.mockResolvedValue({
    db: {},
    organizationId,
    actorProfileId: profileId,
    ownerUserId: "user",
    representedUserId: "user",
    personalAllowed: true,
    sourceSpaceId: "space",
    sourceSignalId: "continued",
  });
  owner.binding.mockResolvedValue({
    service: "linear",
    scope: "shared",
    connectionName: "linear-team",
    connectionUpdatedAtMs: 42,
  });
  owner.selection.mockResolvedValue({ connection, permission: "read" });
  owner.policy.mockResolvedValue({ policy: { local_agent: "read" } });
  owner.identity.mockResolvedValue({
    ok: true,
    organization: { id: organizationId },
    account: { userId: "user", displayName: "Maya" },
  });
  owner.runtime.mockResolvedValue({ status: "catalog", actions: [] });
});
describe("Local App execution enforces the admitted account, not just guidance", () => {
  it("reuses the selected connection, reports expiry, and rechecks current permission for native access", async () => {
    const input = pluginActionRpcInputSchema.parse({
      ...request("shared"),
      request: {
        action: {
          operation: "connection",
          service: "linear",
          account: "shared",
          key: "diagnosis",
          computer: true,
        },
      },
    });
    const description = {
      service: "linear",
      connection: {
        connectionName: "linear-team",
        health: {
          state: "reconnect_required",
          observedAt: new Date().toISOString(),
          expiresAt: null,
          reason: "oauth_token_expired",
        },
        profile: { accountId: "account", displayName: "Fixture" },
      },
      nativeHttp: null,
    };
    owner.describe.mockResolvedValue(description);
    expect(await rpcPluginAction(env, input)).toMatchObject({
      kind: "native_connection",
      connection: { connectionName: "linear-team" },
      nextAction: "Reconnect this account in Plugins.",
    });
    expect(owner.native).not.toHaveBeenCalled();
    expect(owner.computer).not.toHaveBeenCalled();
    const usable = {
      ...description,
      connection: {
        ...description.connection,
        health: {
          ...description.connection.health,
          state: "unknown",
          reason: null,
        },
      },
      nativeHttp: {
        baseUrl: "https://api.example.test",
        documentationUrl: "https://example.test/docs",
        auth: { type: "bearer" },
        read: [{ method: "GET", path: "^/items$" }],
      },
    };
    owner.describe.mockResolvedValue(usable);
    owner.computer.mockResolvedValue({
      id: "computer",
      ownerUserId: "user",
      provider: "cloudflare",
      createdAtMs: 1,
    });
    owner.native.mockImplementation(async ({ grant }) => ({
      description: usable,
      baseUrl: `http://computer.internal/connections/${grant.id}`,
      nextAction: "Use the selected account.",
    }));
    expect(await rpcPluginAction(env, input)).toMatchObject({
      kind: "native_connection",
      connection: { connectionName: "linear-team", scope: "shared" },
      baseUrl: expect.stringMatching(NATIVE_CONNECTION_URL),
    });
    expect(await authorizeLocalPluginConnection(env, input)).toMatchObject({
      connection,
      permission: "read",
    });
    owner.selection.mockResolvedValue(null);
    await expect(authorizeLocalPluginConnection(env, input)).rejects.toThrow(
      "plugin.connection_unavailable"
    );
  });
  it("looks up the original-source binding before resolving the requested account", async () => {
    expect(await rpcPluginAction(env, request("shared"))).toMatchObject({
      kind: "actions",
      connection: { scope: "shared", connectionName: "linear-team" },
    });
    expect(owner.binding).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        requesterUserId: "user",
        signalId: "continued",
        targetProfileId: profileId,
      }),
      "linear"
    );
    expect(owner.selection).toHaveBeenCalledWith(
      expect.objectContaining({ preference: "shared", consumer: "local_agent" })
    );
  });
  it("refuses a model-requested personal account and connection replacement before contacting the provider", async () => {
    await expect(rpcPluginAction(env, request("personal"))).rejects.toThrow(
      "execution_identity_changed"
    );
    expect(owner.selection).not.toHaveBeenCalled();
    owner.selection.mockResolvedValue({
      connection: { ...connection, updatedAtMs: 43 },
    });
    await expect(rpcPluginAction(env, request("shared"))).rejects.toThrow(
      "execution_identity_changed"
    );
    expect(owner.runtime).not.toHaveBeenCalled();
  });
});
