import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import {
  ANTIGRAVITY_SPACE_ACTION_JSON_SCHEMA,
  withAntigravityDispatchSpaceAction,
} from "../dist/transport/antigravity-space-action-plugin.js";

const STRUCTURED_OUTCOME_PATTERN = /structured outcome/u;
const UNNECESSARY_TOOL_USE_PATTERN =
  /do not inspect the workspace or run a command just to orient yourself/u;
const INCONSISTENT_PATTERN = /inconsistent/u;

test("does not configure structured output outside an OpenMeld dispatch", async () => {
  const result = await withAntigravityDispatchSpaceAction({
    env: {},
    run: async (configuration) => ({
      configuration,
      structuredOutput: null,
    }),
  });
  assert.deepEqual(result.configuration, {
    addDir: null,
    jsonSchema: null,
  });
});

test("records one temporary structured reply and removes its plugin", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openmeld-antigravity-"));
  const commandPath = join(fixtureRoot, "openmeld-dev");
  const invocationPath = join(fixtureRoot, "invocation.json");
  await writeFile(
    commandPath,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({ args: process.argv.slice(2), stdin }));
`,
    { encoding: "utf8", mode: 0o700 }
  );

  let pluginRoot = "";
  try {
    const result = await withAntigravityDispatchSpaceAction({
      env: dispatchEnv(commandPath),
      run: async ({ addDir, jsonSchema }) => {
        assert.ok(addDir);
        pluginRoot = addDir;
        const pluginId = basename(addDir);
        const pluginDir = join(addDir, ".agents", "plugins", pluginId);
        const hooks = JSON.parse(
          await readFile(join(pluginDir, "hooks.json"), "utf8")
        );
        assert.equal(
          hooks["openmeld-space-action"].PreInvocation[0].command,
          "node ./inject-space-action.mjs"
        );
        const instructionSource = await readFile(
          join(pluginDir, "inject-space-action.mjs"),
          "utf8"
        );
        assert.match(instructionSource, STRUCTURED_OUTCOME_PATTERN);
        assert.match(instructionSource, UNNECESSARY_TOOL_USE_PATTERN);
        assert.equal(jsonSchema, ANTIGRAVITY_SPACE_ACTION_JSON_SCHEMA);
        return {
          structuredOutput: {
            action: "reply",
            mentionTargets: ["human-1"],
            referenceTargets: [],
            status: "none",
            text: "It is ready.",
            wakeTargets: [],
          },
          value: "ran",
        };
      },
    });

    assert.equal(result.value, "ran");
    assert.deepEqual(JSON.parse(await readFile(invocationPath, "utf8")), {
      args: [
        "space",
        "action",
        "reply",
        "--message-file",
        "-",
        "--mention",
        "human-1",
      ],
      stdin: "It is ready.",
    });
    await assert.rejects(access(pluginRoot));
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("rejects an inconsistent structured outcome without invoking the writer", async () => {
  await assert.rejects(
    withAntigravityDispatchSpaceAction({
      env: dispatchEnv("/tmp/openmeld-dev"),
      run: async () => ({
        structuredOutput: {
          action: "silent",
          mentionTargets: ["human-1"],
          referenceTargets: [],
          status: "none",
          text: "No reply needed.",
          wakeTargets: [],
        },
      }),
    }),
    (error) =>
      error?.code === "space.action.record_failed" &&
      INCONSISTENT_PATTERN.test(error.message)
  );
});

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
