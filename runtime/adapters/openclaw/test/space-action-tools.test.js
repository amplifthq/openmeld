import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  OPENCLAW_SPACE_ACTION_TOOL_NAMES,
  withOpenClawDispatchSpaceActionPlugin,
} from "../dist/transport/openclaw-space-action-plugin-config.js";

test("OpenClaw gets a temporary dispatch plugin config without changing user config", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-action-config-"));
  const baseConfigPath = join(fixtureDir, "openclaw.json");
  const contextPath = join(fixtureDir, "action-context.json");
  const commandPath = join(fixtureDir, "openmeld");
  await writeFile(baseConfigPath, '{"tools":{"profile":"minimal"}}\n');
  await writeFile(contextPath, "{}\n");
  await writeFile(commandPath, "#!/bin/sh\nexit 0\n");
  await chmod(commandPath, 0o755);

  let temporaryConfigPath = "";
  try {
    const result = await withOpenClawDispatchSpaceActionPlugin({
      env: {
        OPENCLAW_CONFIG_PATH: baseConfigPath,
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: contextPath,
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: commandPath,
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
      },
      run: async ({ active, env }) => {
        assert.equal(active, true);
        temporaryConfigPath = env.OPENCLAW_CONFIG_PATH;
        assert.notEqual(temporaryConfigPath, baseConfigPath);
        const config = JSON.parse(await readFile(temporaryConfigPath, "utf8"));
        assert.equal(config.$include, `./${basename(baseConfigPath)}`);
        assert.deepEqual(config.plugins.allow, ["openmeld-space-action"]);
        assert.equal(
          config.plugins.entries["openmeld-space-action"].enabled,
          true
        );
        assert.equal(config.plugins.load.paths.length, 1);
        return "ok";
      },
    });

    assert.equal(result, "ok");
    await assert.rejects(stat(temporaryConfigPath), { code: "ENOENT" });
    assert.equal(
      await readFile(baseConfigPath, "utf8"),
      '{"tools":{"profile":"minimal"}}\n'
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("OpenClaw Space reply uses the dispatch-owned CLI without shell approval", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "openclaw-action-tool-"));
  const commandPath = join(fixtureDir, "openmeld");
  const capturePath = join(fixtureDir, "capture.json");
  const contextPath = join(fixtureDir, "action-context.json");
  await writeFile(contextPath, "{}\n");
  await writeFile(
    commandPath,
    [
      "#!/usr/bin/env node",
      'let input = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", async () => {',
      '  await import("node:fs/promises").then(({ writeFile }) => writeFile(process.env.OPENMELD_TEST_CAPTURE_PATH, JSON.stringify({ argv: process.argv.slice(2), input })));',
      '  process.stdout.write("Action recorded.\\n");',
      "});",
    ].join("\n")
  );
  await chmod(commandPath, 0o755);

  const previousEnv = { ...process.env };
  try {
    process.env.OPENMELD_SPACE_ACTION_CONTEXT_PATH = contextPath;
    process.env.OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH = commandPath;
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld";
    process.env.OPENMELD_TEST_CAPTURE_PATH = capturePath;
    const result = await withOpenClawDispatchSpaceActionPlugin({
      env: {
        OPENCLAW_CONFIG_PATH: join(fixtureDir, "openclaw.json"),
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: contextPath,
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: commandPath,
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
      },
      run: async ({ pluginPath }) => {
        const openMeldSpaceActionPlugin = (
          await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`)
        ).default;
        const registeredTools = [];
        const config = {
          tools: { profile: "minimal" },
          agents: {
            list: [{ id: "main", tools: { profile: "minimal" } }],
          },
        };
        openMeldSpaceActionPlugin.register({
          config,
          registerTool(tool) {
            registeredTools.push(tool);
          },
        });

        assert.deepEqual(
          config.tools.alsoAllow,
          OPENCLAW_SPACE_ACTION_TOOL_NAMES
        );
        assert.deepEqual(
          config.agents.list[0].tools.alsoAllow,
          OPENCLAW_SPACE_ACTION_TOOL_NAMES
        );
        const replyTool = registeredTools.find(
          (tool) => tool.name === "openmeld_space_reply"
        );
        assert.ok(replyTool);
        const message =
          'First line\nLiteral \\n stays literal.\n`code` "$HOME" $(whoami) 😀';
        const toolResult = await replyTool.execute("call-1", {
          message,
          referenceTargets: ["@Reviewer"],
          wakeTargets: ["@Builder"],
        });
        return { message, toolResult };
      },
    });
    const captured = JSON.parse(await readFile(capturePath, "utf8"));

    assert.deepEqual(captured.argv, [
      "space",
      "action",
      "reply",
      "--message-file",
      "-",
      "--wake",
      "@Builder",
      "--reference",
      "@Reviewer",
    ]);
    assert.equal(captured.input, result.message);
    assert.equal(
      result.toolResult.content[0].text,
      "Action recorded for the current OpenMeld Wake."
    );
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, previousEnv);
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
