import assert from "node:assert/strict";
import test from "node:test";
import { invokeAntigravityCliTransport } from "../dist/transport/antigravity-cli-transport.js";

test("Antigravity cannot use structured output as permission to rerun business work", async () => {
  for (const agentControllerPermissionMode of [
    "antigravity:default",
    "antigravity:plan",
    "antigravity:bypassPermissions",
  ]) {
    const request = Object.freeze({
      agentControllerPermissionMode,
      timeoutMs: 1000,
      workdir: "/must-not-access",
      env: Object.freeze({ OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" }),
      launchContract: { kind: "executable", commandPath: "/must-not-execute" },
      jsonSchema: JSON.stringify({ type: "object" }),
      prompt: "Deliver the existing result only",
      sessionId: "canonical-session",
      onProcessControlEvent() {
        assert.fail("No controller may be started");
      },
    });
    await assert.rejects(invokeAntigravityCliTransport(request), {
      code: "space.action.delivery_only_unsupported",
    });
    assert.equal(
      request.agentControllerPermissionMode,
      agentControllerPermissionMode
    );
    assert.equal(request.sessionId, "canonical-session");
  }
});
