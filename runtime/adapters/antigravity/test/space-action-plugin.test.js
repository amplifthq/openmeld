import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

test("adds one temporary scoped action command and removes it after the turn", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openmeld-antigravity-"));
  const commandPath = join(fixtureRoot, "openmeld-dev");
  await writeFile(
    commandPath,
    `#!/usr/bin/env node
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
console.log(JSON.stringify({ args: process.argv.slice(2), stdin }));
`,
    { encoding: "utf8", mode: 0o700 }
  );

  let pluginRoot = "";
  try {
    const result = await withAntigravityDispatchSpaceActionPlugin({
      env: dispatchEnv(commandPath),
      run: async ({ addDir }) => {
        assert.ok(addDir);
        pluginRoot = addDir;
        const pluginId = basename(addDir);
        const pluginDir = join(addDir, ".agents", "plugins", pluginId);
        const actionCommand = join(pluginDir, "openmeld-space-action");
        const hooks = JSON.parse(
          await readFile(join(pluginDir, "hooks.json"), "utf8")
        );
        assert.equal(
          hooks["openmeld-space-action"].PreToolUse[0].matcher,
          "run_command"
        );

        const permissionHook = join(pluginDir, "allow-space-action.mjs");
        const allowed = await runJsonHook(permissionHook, {
          toolCall: {
            name: "run_command",
            args: { CommandLine: `'${actionCommand}' reply 'It is ready.'` },
          },
        });
        assert.equal(allowed.decision, "allow");

        const chained = await runJsonHook(permissionHook, {
          toolCall: {
            name: "run_command",
            args: {
              CommandLine: `'${actionCommand}' reply ok; touch /tmp/nope`,
            },
          },
        });
        assert.equal(chained.decision, "ask");

        const instruction = await runJsonHook(
          join(pluginDir, "inject-space-action.mjs"),
          {}
        );
        assert.match(
          instruction.injectSteps[0].ephemeralMessage,
          new RegExp(actionCommand.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")
        );

        const executed = await runProcess(actionCommand, [
          "reply",
          "It is ready.",
          "--mention",
          "profile-1",
        ]);
        assert.deepEqual(JSON.parse(executed.stdout.trim()), {
          args: [
            "space",
            "action",
            "reply",
            "--message-file",
            "-",
            "--mention",
            "profile-1",
          ],
          stdin: "It is ready.",
        });
        return "ran";
      },
    });

    assert.equal(result, "ran");
    await assert.rejects(access(pluginRoot));
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

async function runJsonHook(path, payload) {
  const result = await runProcess(process.execPath, [path], {
    stdin: JSON.stringify(payload),
  });
  return JSON.parse(result.stdout);
}

async function runProcess(path, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(path, args, { stdio: ["pipe", "pipe", "pipe"] });
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
        resolve({ stderr, stdout });
        return;
      }
      reject(new Error(stderr || `Process exited with code ${String(code)}.`));
    });
    child.stdin.end(options.stdin ?? "");
  });
}

function dispatchEnv(commandPath) {
  return {
    OPENMELD_AUTH_URL: "http://auth.localhost",
    OPENMELD_ENV_PRESET: "dev",
    OPENMELD_GATEWAY_URL: "http://gateway.localhost",
    OPENMELD_HOME: "/tmp/openmeld-home",
    OPENMELD_SPACE_ACTION_CONTEXT_PATH: "/tmp/openmeld-action.json",
    OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: commandPath,
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
  };
}
