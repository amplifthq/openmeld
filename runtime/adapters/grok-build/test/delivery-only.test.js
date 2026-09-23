import assert from "node:assert/strict";
import test from "node:test";
import { invokeGrokBuildAcpTransport } from "../dist/index.js";

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
