import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildIsolatedDevEnvironment,
  releaseIsolatedDevLane,
  reserveIsolatedDevLane,
} from "./dev-isolated-lane.mjs";

const DUPLICATE_STACK_RE =
  /already has an isolated dev stack \(pid=30001\).*No process was stopped/u;
const DUPLICATE_WEB_RE =
  /already has an isolated web server \(pid=50002\).*No process was stopped/u;
const ATTACHED_WEB_PORT_CONFLICT_RE =
  /live isolated web server.*cannot move to a different port block.*Stop.*Web server/u;
const DOPPLER_WORKTREE_COMMAND_RE = /pnpm dev:worktree/u;

test("tells a new developer how to start the Worker stack before Web", async () => {
  const fixture = createFixture();

  try {
    await assert.rejects(
      () =>
        reserveIsolatedDevLane({
          gitCommonDir: fixture.gitCommonDir,
          isPidAlive: () => false,
          kind: "web",
          pid: 9001,
          repoRoot: fixture.firstWorktree,
          stackStartCommand: "pnpm dev:worktree",
        }),
      (error) => {
        assert.match(error.message, DOPPLER_WORKTREE_COMMAND_RE);
        return true;
      }
    );
  } finally {
    fixture.cleanup();
  }
});

test("gives concurrent worktrees separate complete port blocks", async () => {
  const fixture = createFixture();
  const alivePids = new Set([10_001, 10_002]);

  try {
    const first = await reserveStack(fixture, {
      pid: 10_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });
    const second = await reserveStack(fixture, {
      pid: 10_002,
      repoRoot: fixture.secondWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });

    assert.notEqual(first.laneId, second.laneId);
    assert.equal(portValues(first).length, 9);
    assert.equal(new Set(portValues(first)).size, 9);
    assert.equal(
      portValues(first).some((port) => portValues(second).includes(port)),
      false
    );
    assert.equal(first.ports.gateway, first.ports.web + 1);
    assert.equal(first.ports.auth, first.ports.web + 2);
    assert.equal(first.ports.remoteAgent, first.ports.web + 3);
    assert.equal(first.ports.webInspector, first.ports.web + 8);
    assert.equal(first.ports.remoteAgentInspector, first.ports.web + 12);
  } finally {
    fixture.cleanup();
  }
});

test("reclaims a dead stack owner and keeps the worktree on its stable lane", async () => {
  const fixture = createFixture();
  const alivePids = new Set([20_001]);

  try {
    const first = await reserveStack(fixture, {
      pid: 20_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });

    alivePids.delete(20_001);
    alivePids.add(20_002);
    const restarted = await reserveStack(fixture, {
      pid: 20_002,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });

    assert.equal(restarted.laneId, first.laneId);
    assert.deepEqual(restarted.ports, first.ports);
    assert.equal(restarted.stackPid, 20_002);
  } finally {
    fixture.cleanup();
  }
});

test("keeps a live attached web server on its port block when the stack restarts", async () => {
  const fixture = createFixture();
  const alivePids = new Set([21_001, 21_002]);

  try {
    const first = await reserveStack(fixture, {
      pid: 21_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });
    await reserveIsolatedDevLane({
      gitCommonDir: fixture.gitCommonDir,
      isPidAlive: (pid) => alivePids.has(pid),
      kind: "web",
      pid: 21_002,
      repoRoot: fixture.firstWorktree,
    });

    alivePids.delete(21_001);
    alivePids.add(21_003);
    const restarted = await reserveStack(fixture, {
      pid: 21_003,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
      listeningPortOwners: [
        { command: "isolated-web", pid: 21_004, port: first.ports.web },
        {
          command: "isolated-web-inspector",
          pid: 21_005,
          port: first.ports.webInspector,
        },
      ],
      processRows: [
        {
          command: `node ${join(fixture.firstWorktree, "scripts", "dev", "dev-isolated-web.mjs")}`,
          parentPid: 1,
          pid: 21_002,
        },
        { command: "pnpm dev:isolated", parentPid: 21_002, pid: 21_004 },
        { command: "vite dev", parentPid: 21_004, pid: 21_005 },
      ],
    });

    assert.deepEqual(restarted.ports, first.ports);
    assert.equal(restarted.stackPid, 21_003);
    assert.equal(restarted.webPid, 21_002);
  } finally {
    fixture.cleanup();
  }
});

test("blocks a stack restart when unrelated processes own the attached web ports", async () => {
  const fixture = createFixture();
  const alivePids = new Set([21_101, 21_102]);

  try {
    const first = await reserveStack(fixture, {
      pid: 21_101,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });
    await reserveIsolatedDevLane({
      gitCommonDir: fixture.gitCommonDir,
      isPidAlive: (pid) => alivePids.has(pid),
      kind: "web",
      pid: 21_102,
      repoRoot: fixture.firstWorktree,
    });

    alivePids.delete(21_101);
    alivePids.add(21_103);
    await assert.rejects(
      () =>
        reserveStack(fixture, {
          pid: 21_103,
          repoRoot: fixture.firstWorktree,
          isPidAlive: (pid) => alivePids.has(pid),
          listeningPortOwners: [
            {
              command: "unrelated-web",
              pid: 21_998,
              port: first.ports.web,
            },
            {
              command: "unrelated-web-inspector",
              pid: 21_999,
              port: first.ports.webInspector,
            },
          ],
          processRows: [
            {
              command: `node ${join(fixture.firstWorktree, "scripts", "dev", "dev-isolated-web.mjs")}`,
              parentPid: 1,
              pid: 21_102,
            },
            { command: "unrelated-web", parentPid: 1, pid: 21_998 },
            {
              command: "unrelated-web-inspector",
              parentPid: 1,
              pid: 21_999,
            },
          ],
        }),
      ATTACHED_WEB_PORT_CONFLICT_RE
    );
  } finally {
    fixture.cleanup();
  }
});

test("blocks a stack restart when another process conflicts with the attached web lane", async () => {
  const fixture = createFixture();
  const alivePids = new Set([22_001, 22_002]);

  try {
    const first = await reserveStack(fixture, {
      pid: 22_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });
    await reserveIsolatedDevLane({
      gitCommonDir: fixture.gitCommonDir,
      isPidAlive: (pid) => alivePids.has(pid),
      kind: "web",
      pid: 22_002,
      repoRoot: fixture.firstWorktree,
    });

    alivePids.delete(22_001);
    alivePids.add(22_003);
    await assert.rejects(
      () =>
        reserveStack(fixture, {
          pid: 22_003,
          repoRoot: fixture.firstWorktree,
          isPidAlive: (pid) => alivePids.has(pid),
          listeningPortOwners: [
            { command: "isolated-web", pid: 22_002, port: first.ports.web },
            {
              command: "unrelated-server",
              pid: 22_999,
              port: first.ports.gateway,
            },
          ],
          processRows: [
            {
              command: `node ${join(fixture.firstWorktree, "scripts", "dev", "dev-isolated-web.mjs")}`,
              parentPid: 1,
              pid: 22_002,
            },
          ],
        }),
      ATTACHED_WEB_PORT_CONFLICT_RE
    );
  } finally {
    fixture.cleanup();
  }
});

test("blocks a second live stack in the same worktree without stopping it", async () => {
  const fixture = createFixture();
  const alivePids = new Set([30_001, 30_002]);

  try {
    await reserveStack(fixture, {
      pid: 30_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });

    await assert.rejects(
      () =>
        reserveStack(fixture, {
          pid: 30_002,
          repoRoot: fixture.firstWorktree,
          isPidAlive: (pid) => alivePids.has(pid),
        }),
      DUPLICATE_STACK_RE
    );
    assert.equal(alivePids.has(30_001), true);
  } finally {
    fixture.cleanup();
  }
});

test("skips a preferred block when an unrelated process owns one of its ports", async () => {
  const fixture = createFixture();
  const alivePids = new Set([40_001, 40_002]);

  try {
    const preferred = await reserveStack(fixture, {
      pid: 40_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });
    await releaseIsolatedDevLane({
      gitCommonDir: fixture.gitCommonDir,
      isPidAlive: (pid) => alivePids.has(pid),
      kind: "stack",
      pid: 40_001,
      repoRoot: fixture.firstWorktree,
    });
    alivePids.delete(40_001);

    const moved = await reserveStack(fixture, {
      pid: 40_002,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
      listeningPortOwners: [
        { command: "unrelated-server", pid: 49_999, port: preferred.ports.web },
      ],
    });

    assert.notEqual(moved.ports.web, preferred.ports.web);
    assert.equal(portValues(moved).includes(preferred.ports.web), false);
  } finally {
    fixture.cleanup();
  }
});

test("attaches one isolated web server to the live stack lane", async () => {
  const fixture = createFixture();
  const alivePids = new Set([50_001, 50_002, 50_003]);

  try {
    const stack = await reserveStack(fixture, {
      pid: 50_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => alivePids.has(pid),
    });
    const web = await reserveIsolatedDevLane({
      gitCommonDir: fixture.gitCommonDir,
      isPidAlive: (pid) => alivePids.has(pid),
      kind: "web",
      listeningPortOwners: [],
      pid: 50_002,
      repoRoot: fixture.firstWorktree,
    });

    assert.equal(web.laneId, stack.laneId);
    assert.deepEqual(web.ports, stack.ports);
    assert.equal(web.stackPid, 50_001);
    assert.equal(web.webPid, 50_002);

    await assert.rejects(
      () =>
        reserveIsolatedDevLane({
          gitCommonDir: fixture.gitCommonDir,
          isPidAlive: (pid) => alivePids.has(pid),
          kind: "web",
          listeningPortOwners: [],
          pid: 50_003,
          repoRoot: fixture.firstWorktree,
        }),
      DUPLICATE_WEB_RE
    );
  } finally {
    fixture.cleanup();
  }
});

test("builds one explicit environment for workers, Web, Wrangler, and OPENMELD_HOME", async () => {
  const fixture = createFixture();

  try {
    const lane = await reserveStack(fixture, {
      pid: 60_001,
      repoRoot: fixture.firstWorktree,
      isPidAlive: (pid) => pid === 60_001,
    });
    const env = buildIsolatedDevEnvironment(lane);

    assert.equal(env.OPENMELD_DEV_ISOLATED, "1");
    assert.equal(env.OPENMELD_DEV_LANE_ID, lane.laneId);
    assert.equal(
      env.OPENMELD_GATEWAY_URL,
      `http://localhost:${String(lane.ports.gateway)}`
    );
    assert.equal(
      env.BETTER_AUTH_URL,
      `http://localhost:${String(lane.ports.auth)}`
    );
    assert.equal(env.WEB_APP_URL, `http://localhost:${String(lane.ports.web)}`);
    assert.equal(env.OPENMELD_HOME, lane.openMeldHome);
    assert.equal(env.WRANGLER_REGISTRY_PATH, lane.wranglerRegistryPath);
    assert.equal(
      env.OPENMELD_DEV_WRANGLER_STATE_DIR,
      lane.wranglerStateDirectory
    );
  } finally {
    fixture.cleanup();
  }
});

test("passes the isolated D1 state directory through every startup DB task", () => {
  const turboConfig = JSON.parse(
    readFileSync(new URL("../../turbo.json", import.meta.url), "utf8")
  );

  for (const taskName of ["db:check", "db:migrate:dev", "db:verify:dev"]) {
    assert.equal(
      turboConfig.tasks[taskName]?.passThroughEnv?.includes(
        "OPENMELD_DEV_WRANGLER_STATE_DIR"
      ),
      true,
      `${taskName} must receive OPENMELD_DEV_WRANGLER_STATE_DIR`
    );
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "openmeld-isolated-lane-"));
  const gitCommonDir = join(root, "git-common");
  const firstWorktree = join(root, "worktree-a");
  const secondWorktree = join(root, "worktree-b");
  mkdirSync(gitCommonDir, { recursive: true });
  mkdirSync(firstWorktree, { recursive: true });
  mkdirSync(secondWorktree, { recursive: true });

  return {
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    firstWorktree,
    gitCommonDir,
    secondWorktree,
  };
}

function portValues(lane) {
  return Object.values(lane.ports);
}

function reserveStack(fixture, options) {
  return reserveIsolatedDevLane({
    gitCommonDir: fixture.gitCommonDir,
    isPidAlive: options.isPidAlive,
    kind: "stack",
    listeningPortOwners: options.listeningPortOwners ?? [],
    processRows: options.processRows,
    pid: options.pid,
    repoRoot: options.repoRoot,
  });
}
