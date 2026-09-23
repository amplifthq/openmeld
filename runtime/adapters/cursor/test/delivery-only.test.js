import assert from "node:assert/strict";
import test from "node:test";
import { invokeCursorAcpTransport } from "../dist/transport/cursor-acp-transport.js";

test("Cursor refuses unverified delivery repair before opening a conversation or selecting another mode", async () => {
  for (const agentControllerPermissionMode of [
    "cursor:default",
    "cursor:plan",
    "cursor:runEverything",
  ]) {
    const request = Object.freeze({
      agentControllerPermissionMode,
      cursorTimeoutMs: 1000,
      cursorWorkdir: "/must-not-access",
      env: Object.freeze({ OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" }),
      launchContract: { kind: "executable", commandPath: "/must-not-execute" },
      prompt: "Deliver the existing result only",
      sessionId: "canonical-session",
      taskId: "repair",
      onActiveTurn() {
        assert.fail("No correction turn may be registered");
      },
    });
    await assert.rejects(invokeCursorAcpTransport(request), {
      code: "space.action.delivery_only_unsupported",
    });
    assert.equal(
      request.agentControllerPermissionMode,
      agentControllerPermissionMode
    );
    assert.equal(request.sessionId, "canonical-session");
  }
});
