import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ROOT_DEV_SKIP_SERVICE_PREDEV_ENV,
  runGuardedServicePredev,
  shouldSkipServicePredev,
} from "./run-guarded-service-predev.mjs";

function makeMissingLockFilePath() {
  return join(
    mkdtempSync(join(tmpdir(), "openmeld-dev-predev-missing-")),
    "openmeld-dev.lock"
  );
}

test("shouldSkipServicePredev only opts in for the root dev guard env", () => {
  assert.equal(
    shouldSkipServicePredev({
      env: {},
      lockFilePath: makeMissingLockFilePath(),
    }),
    false
  );
  assert.equal(
    shouldSkipServicePredev({
      env: {
        [ROOT_DEV_SKIP_SERVICE_PREDEV_ENV]: "1",
      },
      lockFilePath: makeMissingLockFilePath(),
    }),
    true
  );
});

test("shouldSkipServicePredev trusts a live root dev lock file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "openmeld-dev-predev-"));
  const lockFilePath = join(tempDir, "openmeld-dev.lock");
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(
    lockFilePath,
    JSON.stringify({
      pid: process.pid,
      repoRoot: "/repo",
    })
  );

  assert.equal(
    shouldSkipServicePredev({
      env: {},
      lockFilePath,
    }),
    true
  );
});

test("runGuardedServicePredev skips duplicated service predev work under root pnpm dev", async () => {
  let invoked = false;

  const exitCode = await runGuardedServicePredev({
    command: "echo should-not-run",
    env: {
      [ROOT_DEV_SKIP_SERVICE_PREDEV_ENV]: "1",
    },
    label: "auth-worker",
    runCommand: () => {
      invoked = true;
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(invoked, false);
});

test("runGuardedServicePredev still runs service-local predev outside root pnpm dev", async () => {
  let received = null;

  const exitCode = await runGuardedServicePredev({
    command: "echo hello",
    cwd: "/repo",
    env: {},
    label: "gateway",
    lockFilePath: makeMissingLockFilePath(),
    runCommand: (command, options) => {
      received = { command, options };
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(received, {
    command: "echo hello",
    options: {
      cwd: "/repo",
      env: {},
    },
  });
});
