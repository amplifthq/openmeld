import assert from "node:assert/strict";
import test from "node:test";

import { prepareReleaseWorktree } from "./prepare-release-worktree.mjs";

const INSTALL_FAILURE_RE =
  /Release dependency installation failed\.\nregistry unavailable/u;
const FORCED_RELINK_FAILURE_RE =
  /Release dependencies are still unavailable after a forced relink/u;

test("keeps an already prepared release worktree unchanged", () => {
  const installCalls = [];

  const result = prepareReleaseWorktree({
    isReady: () => true,
    runInstall: (args) => {
      installCalls.push(args);
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { status: "already_ready" });
  assert.deepEqual(installCalls, []);
});

test("installs dependencies once when the clean worktree is unprepared", () => {
  const readiness = [false, true];
  const installCalls = [];

  const result = prepareReleaseWorktree({
    isReady: () => readiness.shift() ?? true,
    runInstall: (args) => {
      installCalls.push(args);
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { status: "prepared" });
  assert.deepEqual(installCalls, [["install", "--frozen-lockfile"]]);
});

test("repairs missing dependency links after pnpm reports success", () => {
  const readiness = [false, false, true];
  const installCalls = [];

  const result = prepareReleaseWorktree({
    isReady: () => readiness.shift() ?? true,
    runInstall: (args) => {
      installCalls.push(args);
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { status: "prepared_after_relink" });
  assert.deepEqual(installCalls, [
    ["install", "--frozen-lockfile"],
    ["install", "--frozen-lockfile", "--force"],
  ]);
});

test("preserves the first dependency installation failure", () => {
  assert.throws(
    () =>
      prepareReleaseWorktree({
        isReady: () => false,
        runInstall: () => ({
          status: 1,
          stderr: "registry unavailable",
        }),
      }),
    INSTALL_FAILURE_RE
  );
});

test("fails clearly when a forced relink still leaves dependencies unavailable", () => {
  assert.throws(
    () =>
      prepareReleaseWorktree({
        isReady: () => false,
        runInstall: () => ({ status: 0 }),
      }),
    FORCED_RELINK_FAILURE_RE
  );
});
