import assert from "node:assert/strict";
import test from "node:test";
import { resolveOwnedCommandInvocation } from "../dev/owned-command.mjs";
import { testCliSkill } from "./cli-skill-test.mjs";

const ROOT_PNPM_ENTRY_FAILURE = /through a root pnpm script/u;
const CLI_SKILL_TEST_FAILURE = /Official CLI Skill tests failed/u;

test("launches pnpm through its JavaScript entrypoint on Windows", () => {
  assert.deepEqual(
    resolveOwnedCommandInvocation("pnpm", ["exec", "turbo"], {
      env: { npm_execpath: "C:\\tools\\pnpm.cjs" },
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      platform: "win32",
    }),
    {
      args: ["C:\\tools\\pnpm.cjs", "exec", "turbo"],
      command: "C:\\Program Files\\nodejs\\node.exe",
    }
  );
});

test("keeps the ordinary pnpm executable on non-Windows platforms", () => {
  assert.deepEqual(
    resolveOwnedCommandInvocation("pnpm", ["exec", "turbo"], {
      env: { npm_execpath: "/tools/pnpm.cjs" },
      platform: "darwin",
    }),
    { args: ["exec", "turbo"], command: "pnpm" }
  );
});

test("fails closed instead of shell-launching a Windows pnpm shim", () => {
  assert.throws(
    () =>
      resolveOwnedCommandInvocation("pnpm", ["exec", "turbo"], {
        env: {},
        platform: "win32",
      }),
    ROOT_PNPM_ENTRY_FAILURE
  );
});

test("builds CLI workspace dependencies before the focused Skill integration test", async () => {
  const calls = [];
  await testCliSkill({
    cwd: "/exact-release-source",
    env: { npm_execpath: "C:\\tools\\pnpm.cjs" },
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return 0;
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      {
        command: "pnpm",
        args: ["exec", "turbo", "run", "build", "--filter=openmeld^..."],
      },
      {
        command: "pnpm",
        args: [
          "--dir",
          "clients/openmeld-cli",
          "exec",
          "vitest",
          "run",
          "--config",
          "vitest.integration.config.ts",
          "tests/official-cli-skill.integration.test.ts",
        ],
      },
    ]
  );
  assert.ok(
    calls.every(({ options }) => options.cwd === "/exact-release-source")
  );
  assert.ok(
    calls.every(
      ({ options }) => options.env.npm_execpath === "C:\\tools\\pnpm.cjs"
    )
  );
});

test("stops before Vitest when the dependency build fails", async () => {
  const calls = [];
  await assert.rejects(
    testCliSkill({
      run: (command, args) => {
        calls.push({ command, args });
        return 1;
      },
    }),
    CLI_SKILL_TEST_FAILURE
  );
  assert.equal(calls.length, 1);
});
