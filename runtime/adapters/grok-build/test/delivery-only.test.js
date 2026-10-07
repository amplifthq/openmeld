import assert from "node:assert/strict";
import test from "node:test";
import { invokeGrokBuildAcpTransport } from "../dist/index.js";
import {
  assertGrokBuildDeliveryInspection,
  verifyGrokBuildDeliveryScope,
} from "../dist/transport/grok-build-delivery-only.js";

// Captured fields from Grok 1.0.40 `inspect --json`, not controller source text.
const emptyInspection = {
  grokVersion: "1.0.40",
  projectTrusted: true,
  hooks: [],
  plugins: [],
  mcpServers: [],
  lspServers: [],
  permissions: {
    sources: [],
    loaded: 0,
    skipped: [],
    managedSettingsActive: false,
  },
};

test("delivery inspection rejects unavailable policy and ambient execution before native startup", () => {
  assert.doesNotThrow(() => assertGrokBuildDeliveryInspection(emptyInspection));
  assert.doesNotThrow(() =>
    assertGrokBuildDeliveryInspection({
      ...emptyInspection,
      grokVersion: "1.0.41-beta.1",
    })
  );
  for (const change of [
    { grokVersion: "1.0.39" },
    { grokVersion: "1.0.40-rc.1" },
    { grokVersion: "1.1.0-alpha.1" },
    { projectTrusted: false },
    { hooks: [{ event: "SessionStart" }] },
    { plugins: [{ name: "external" }] },
    { mcpServers: [{ name: "external" }] },
    { lspServers: [{}] },
    { warnings: ["Invalid settings"] },
    { permissions: {} },
    {
      permissions: {
        ...emptyInspection.permissions,
        managedSettingsActive: true,
      },
    },
  ]) {
    assert.throws(
      () =>
        assertGrokBuildDeliveryInspection({ ...emptyInspection, ...change }),
      { code: "space.action.delivery_only_unverified" }
    );
  }
});

test("the live correction session must have the exact final catalog and selected agent", async () => {
  const scope = { profileName: "current-delivery" };
  const snapshot = {
    "_x.ai/hooks/list": { hooks: [] },
    "_x.ai/mcp/list": {
      sessionMcpResolved: true,
      servers: [
        {
          name: "openmeld_internal_dispatch_space_action",
          session: {
            enabled: true,
            status: "ready",
            tools: ["reply", "stay_silent", "read_receipt"].map((name) => ({
              name,
              enabled: true,
            })),
          },
        },
      ],
    },
    "_x.ai/session/info": {
      sessionId: "current",
      agentName: "current-delivery",
      context: { toolDefinitionsCount: 2 },
    },
  };
  const verify = (changed = {}) =>
    verifyGrokBuildDeliveryScope({
      scope,
      sessionId: "current",
      request: (method) =>
        Promise.resolve({ result: changed[method] ?? snapshot[method] }),
    });
  await verify();
  for (const changed of [
    { "_x.ai/hooks/list": { hooks: [{ event: "PreToolUse" }] } },
    { "_x.ai/mcp/list": { sessionMcpResolved: true, servers: [] } },
    {
      "_x.ai/mcp/list": {
        sessionMcpResolved: true,
        servers: [
          {
            name: "foreign",
            session: { enabled: true, status: "ready", tools: [] },
          },
        ],
      },
    },
    {
      "_x.ai/session/info": {
        sessionId: "current",
        agentName: "business-agent",
        context: { toolDefinitionsCount: 2 },
      },
    },
  ]) {
    await assert.rejects(verify(changed), {
      code: "space.action.delivery_only_unverified",
    });
  }
});

test("Grok Build does not mistake a headless tool flag for a safe ACP correction scope", async () => {
  for (const agentControllerPermissionMode of [
    "grok-build:default",
    "grok-build:plan",
    "grok-build:bypassPermissions",
  ]) {
    const request = Object.freeze({
      agentControllerPermissionMode,
      grokBuildTimeoutMs: 1000,
      grokBuildWorkdir: "/must-not-access",
      env: Object.freeze({ OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" }),
      launchContract: { kind: "executable", commandPath: "/must-not-execute" },
      prompt: "Deliver the existing result only",
      sessionId: "canonical-session",
      taskId: "repair",
      onActiveTurn() {
        assert.fail("No correction turn may be registered");
      },
    });
    await assert.rejects(invokeGrokBuildAcpTransport(request), {
      code: "space.action.delivery_only_unsupported",
    });
    assert.equal(
      request.agentControllerPermissionMode,
      agentControllerPermissionMode
    );
    assert.equal(request.sessionId, "canonical-session");
  }
});
