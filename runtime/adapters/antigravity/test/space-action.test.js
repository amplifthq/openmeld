import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ANTIGRAVITY_SPACE_ACTION_JSON_SCHEMA,
  withAntigravityDispatchSpaceAction,
} from "../dist/transport/antigravity-space-action.js";

const STRUCTURED_OUTCOME_PATTERN = /structured outcome/u;
const UNNECESSARY_TOOL_USE_PATTERN =
  /do not inspect the workspace or run a command just to orient yourself/u;
const INCONSISTENT_PATTERN = /inconsistent/u;

test("does not configure structured output outside an OpenMeld dispatch", async () => {
  const result = await withAntigravityDispatchSpaceAction({
    env: {},
    prompt: "Ordinary task",
    workdir: "/tmp/task-workspace",
    run: async (configuration) => ({
      configuration,
      structuredOutput: null,
    }),
  });
  assert.deepEqual(result.configuration, {
    prompt: "Ordinary task",
    jsonSchema: null,
  });
});

test("records one structured reply without adding a workspace or requiring a Skill read", async () => {
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

  try {
    const result = await withAntigravityDispatchSpaceAction({
      env: dispatchEnv(commandPath),
      prompt: "Write a file in your working folder.",
      workdir: fixtureRoot,
      run: ({ prompt, jsonSchema, ...extraConfiguration }) => {
        assert.deepEqual(extraConfiguration, {});
        assert.ok(prompt.startsWith("Write a file in your working folder."));
        assert.ok(prompt.includes(JSON.stringify(fixtureRoot)));
        assert.ok(prompt.includes("Skill is not required to reply"));
        assert.match(prompt, STRUCTURED_OUTCOME_PATTERN);
        assert.match(prompt, UNNECESSARY_TOOL_USE_PATTERN);
        assert.equal(jsonSchema, ANTIGRAVITY_SPACE_ACTION_JSON_SCHEMA);
        return Promise.resolve({
          structuredOutput: {
            action: "reply",
            mentionTargets: ["human-1"],
            referenceTargets: [],
            status: "none",
            text: "It is ready.",
            wakeTargets: [],
          },
          value: "ran",
        });
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
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("rejects an inconsistent structured outcome without invoking the writer", async () => {
  await assert.rejects(
    withAntigravityDispatchSpaceAction({
      env: dispatchEnv("/tmp/openmeld-dev"),
      prompt: "Report status",
      workdir: "/tmp/task-workspace",
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
