import assert from "node:assert/strict";
import test from "node:test";
import { invokeCodexCliTransport } from "../dist/transport/codex-cli-transport.js";
import { buildCodexDeliveryOnlyConfig } from "../dist/transport/codex-delivery-only.js";

const SERVER = "openmeld_internal_dispatch_space_action";

test("Codex correction narrows ambient capabilities without granting a denied or approval-gated Space tool", () => {
  const policy = {
    command: "/fixture/openmeld",
    enabled: false,
    disabled_tools: ["reply"],
    default_tools_approval_mode: "prompt",
    tool_timeout_sec: null,
  };
  const original = {
    config: {
      approval_policy: "on-request",
      mcp_servers: {
        [SERVER]: policy,
        github: { command: "/fixture/github", enabled: true },
      },
      apps: { custom: { enabled: true } },
    },
  };
  const restricted = buildCodexDeliveryOnlyConfig(original);
  assert.deepEqual(restricted.mcp_servers[SERVER], {
    command: policy.command,
    enabled: false,
    disabled_tools: ["reply"],
    default_tools_approval_mode: "prompt",
  });
  assert.equal(restricted.mcp_servers.github.enabled, false);
  assert.equal(restricted.apps.custom.enabled, false);
  assert.equal(restricted["agents.enabled"], false);
  assert.equal(Object.hasOwn(restricted, "approval_policy"), false);
  assert.equal(Object.hasOwn(restricted, "sandbox_mode"), false);
  assert.equal(original.config.mcp_servers.github.enabled, true);
  assert.deepEqual(original.config.mcp_servers[SERVER], policy);
});

test("Codex legacy CLI does not start an unrestricted correction or replace the user's mode", async () => {
  await assert.rejects(
    invokeCodexCliTransport({
      launchContract: { kind: "executable", commandPath: "/must-not-run" },
      agentControllerPermissionMode: "codex:fullAccess",
      codexTimeoutMs: 1000,
      codexWorkdir: "/must-not-read",
      threadId: "original",
      prompt: "Deliver only",
      env: { OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" },
    }),
    { code: "space.action.delivery_only_unsupported" }
  );
});
