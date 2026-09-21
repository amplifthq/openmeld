import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import { withAntigravityDispatchSpaceActionPlugin } from "../dist/transport/antigravity-space-action-plugin.js";

test("does not add a plugin outside an OpenMeld Space Action dispatch", async () => {
  const result = await withAntigravityDispatchSpaceActionPlugin({
    env: {},
    run: async ({ addDir }) => addDir,
  });

  assert.equal(result, null);
});

test("adds one temporary dispatch plugin and removes it after the turn", async () => {
  let pluginRoot = "";
  const result = await withAntigravityDispatchSpaceActionPlugin({
    env: dispatchEnv(),
    run: async ({ addDir }) => {
      assert.ok(addDir);
      pluginRoot = addDir;
      const pluginId = basename(addDir);
      const pluginDir = join(addDir, ".agents", "plugins", pluginId);
      const mcpConfig = JSON.parse(
        await readFile(join(pluginDir, "mcp_config.json"), "utf8")
      );
      assert.deepEqual(
        mcpConfig.mcpServers.openmeld_internal_dispatch_space_action,
        {
          args: ["space", "action", "tool-server"],
          command: "/tmp/openmeld-dispatch/bin/openmeld-dev",
          env: dispatchEnv(),
        }
      );

      const hookPath = join(pluginDir, "allow-space-action.mjs");
      const allowed = await runHook(hookPath, {
        toolCall: {
          name: "call_mcp_tool",
          args: {
            serverName: `${pluginId}_openmeld_internal_dispatch_space_action`,
            toolName: "reply",
          },
        },
      });
      assert.equal(allowed.decision, "allow");

      const unrelated = await runHook(hookPath, {
        toolCall: {
          name: "call_mcp_tool",
          args: { serverName: "another_server", toolName: "reply" },
        },
      });
      assert.equal(unrelated.decision, "ask");
      return "ran";
    },
  });

  assert.equal(result, "ran");
  await assert.rejects(access(pluginRoot));
});

async function runHook(path, payload) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout));
        return;
      }
      reject(new Error(stderr || `Hook exited with code ${String(code)}.`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function dispatchEnv() {
  return {
    OPENMELD_AUTH_URL: "http://auth.localhost",
    OPENMELD_ENV_PRESET: "dev",
    OPENMELD_GATEWAY_URL: "http://gateway.localhost",
    OPENMELD_HOME: "/tmp/openmeld-home",
    OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/openmeld-action.json",
    OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH:
      "/tmp/openmeld-dispatch/bin/openmeld-dev",
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
  };
}
