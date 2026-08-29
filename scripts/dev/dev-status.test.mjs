import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDevMachineSnapshot,
  renderDevMachineSnapshot,
} from "./dev-status.mjs";

const ACTIVE_STACKS_PATTERN = /Active dev stacks: 1 \(2 processes\)/u;
const PEOPLE_STACK_PATTERN = /people: 2 processes/u;
const RAW_PID_PATTERN = /pid 10/u;

test("summarizes active OpenMeld stacks by exact worktree without listing every process", () => {
  const root = "/work/openmeld";
  const peopleRoot = "/work/openmeld-worktrees/people";
  const snapshot = buildDevMachineSnapshot({
    availableBytes: 3 * 1024 ** 3,
    currentPid: 999,
    processRows: [
      {
        command: `node ${peopleRoot}/scripts/dev/dev-guard.mjs`,
        pid: 10,
      },
      {
        command: `node ${peopleRoot}/node_modules/wrangler/wrangler-dist/cli.js dev`,
        pid: 11,
      },
      {
        command: `node ${root}/scripts/dev/dev-status.mjs`,
        pid: 999,
      },
    ],
    repoRoot: root,
    totalBytes: 460 * 1024 ** 3,
    worktreeRoots: [root, peopleRoot],
  });

  assert.equal(snapshot.activeStacks.length, 1);
  assert.deepEqual(snapshot.activeStacks[0], {
    coordinatorCount: 1,
    processCount: 2,
    repoRoot: peopleRoot,
    workerCount: 1,
  });
  const output = renderDevMachineSnapshot(snapshot);
  assert.match(output, ACTIVE_STACKS_PATTERN);
  assert.match(output, PEOPLE_STACK_PATTERN);
  assert.doesNotMatch(output, RAW_PID_PATTERN);
});
