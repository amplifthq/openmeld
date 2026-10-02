import assert from "node:assert/strict";
import test from "node:test";
import { prepareOpenCodeDeliveryOnlyTurn } from "../dist/transport/opencode-delivery-only.js";

const SERVER = "openmeld_internal_dispatch_space_action";
const env = { OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" };

for (const scenario of [
  "narrow",
  "newer-prerelease",
  "prerelease-below-floor",
  "old-controller",
  "same-session",
  "unconfirmed-write",
  "invalid-inventory",
]) {
  test(`OpenCode delivery-only permission boundary: ${scenario}`, async () => {
    const original = [
      { permission: `${SERVER}_reply`, pattern: "*", action: "deny" },
      { permission: `${SERVER}_read_receipt`, pattern: "*", action: "ask" },
    ];
    const sessions = {
      original: { id: "original", permission: original },
      fork: { id: "fork", permission: [] },
    };
    const writes = [];
    // Shapes from @opencode-ai/sdk/v2: Session, PermissionRuleset, Config and ToolIds.
    const client = {
      global: {
        health: async () => ({
          healthy: true,
          version:
            {
              "old-controller": "1.18.0",
              "newer-prerelease": "1.18.32-beta.1",
              "prerelease-below-floor": "1.18.31-rc.1",
            }[scenario] ?? "1.18.31",
        }),
      },
      config: {
        get: async () => ({
          mcp: { [SERVER]: { enabled: true }, github: { enabled: true } },
        }),
      },
      tool: {
        ids: async () =>
          scenario === "invalid-inventory"
            ? ["*"]
            : ["bash", "read", "edit", "task", "skill", `${SERVER}_reply`],
      },
      session: {
        get: async ({ sessionID }) => sessions[sessionID],
        update: ({ sessionID, permission }) => {
          writes.push(sessionID);
          if (scenario !== "unconfirmed-write") {
            sessions[sessionID] = { id: sessionID, permission };
          }
          return Promise.resolve();
        },
      },
    };
    const execute = () =>
      prepareOpenCodeDeliveryOnlyTurn({
        client,
        directory: "/fixture",
        sessionId: scenario === "same-session" ? "original" : "fork",
        sourceSessionId: "original",
        env,
      });
    if (["narrow", "newer-prerelease"].includes(scenario)) {
      await execute();
      assert.deepEqual(writes, ["fork"]);
      assert.deepEqual(
        sessions.fork.permission.slice(0, original.length),
        original
      );
      assert.deepEqual(
        sessions.fork.permission.slice(original.length),
        ["bash", "read", "edit", "task", "skill", "github_*"].map(
          (permission) => ({ permission, pattern: "*", action: "deny" })
        )
      );
    } else {
      await assert.rejects(execute, {
        code: "space.action.delivery_only_unverified",
      });
      assert.deepEqual(
        writes,
        scenario === "unconfirmed-write" ? ["fork"] : []
      );
    }
    assert.deepEqual(sessions.original.permission, original);
  });
}
