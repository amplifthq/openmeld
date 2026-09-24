import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { invokeCursorAcpTransport } from "../dist/transport/cursor-acp-transport.js";
import { buildCursorDeliveryHookSource } from "../dist/transport/cursor-delivery-only.js";

test("Cursor requires the host-owned delivery catalog before opening a conversation or selecting another mode", async () => {
  for (const agentControllerPermissionMode of [
    "cursor:default",
    "cursor:plan",
    "cursor:force",
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

test("the native delivery hook vetoes business, foreign and expired requests without granting permission", async () => {
  const home = await mkdtemp(join(tmpdir(), "cursor-hook-boundary-"));
  after(() => rm(home, { recursive: true, force: true }));
  const active = join(home, "active.json");
  const hook = join(home, "hook.mjs");
  await writeFile(active, JSON.stringify({ sessionId: "current-session" }));
  await writeFile(hook, buildCursorDeliveryHookSource(active));
  const base = {
    session_id: "current-session",
    conversation_id: "current-session",
    hook_event_name: "beforeMCPExecution",
    mcp_server_name: "openmeld_internal_dispatch_space_action",
    tool_name: "reply",
  };
  for (const [overrides, permitted] of [
    [{}, true],
    [{ tool_name: "stay_silent" }, true],
    [{ tool_name: "read_receipt" }, true],
    [{ hook_event_name: "preToolUse", tool_name: "MCP:reply" }, true],
    [{ hook_event_name: "preToolUse", tool_name: "Shell" }, false],
    [{ hook_event_name: "preToolUse", tool_name: "Read" }, false],
    [{ tool_name: "status" }, false],
    [{ tool_name: "update_task" }, false],
    [{ session_id: "old-session" }, false],
    [{ mcp_server_name: "foreign-server" }, false],
  ]) {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ ...base, ...overrides }),
      encoding: "utf8",
    });
    assert.equal(result.status, permitted ? 0 : 2);
    assert.deepEqual(
      JSON.parse(result.stdout),
      permitted
        ? {}
        : {
            permission: "deny",
            user_message:
              "This correction can only submit the current Space outcome or read its receipt.",
            agent_message:
              "The operation was not executed. Do not repeat business work or seek another transport.",
          }
    );
  }
  await rm(active);
  const late = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(base),
    encoding: "utf8",
  });
  assert.equal(late.status, 2);
  assert.equal(JSON.parse(late.stdout).permission, "deny");
});
