import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readIsolatedDevOwners } from "./dev-isolated-lane.mjs";
import { collectTargetProcesses } from "./dev-stop.mjs";
import { admissionReason, resourcePolicy } from "./local-resources.mjs";
import { parseMacMemory } from "./machine-memory.mjs";
import { buildProcessMatcherContext } from "./process-matchers.mjs";
import { readProcessRows } from "./process-rows.mjs";
import { sameProcess, stopProcessTree } from "./process-tree.mjs";

const fixture = fileURLToPath(
  new URL("./fixtures/resource-child.mjs", import.meta.url)
);
const BUDGET_PATTERN = /startup budget/u;
const UNKNOWN_PATTERN = /could not be measured/u;
const INTEGER_PATTERN = /integer/u;
function startChild(t, mode, directory) {
  const child = spawn(process.execPath, [fixture, mode, directory], {
    env: {
      ...process.env,
      OPENMELD_LOCAL_HEAVY_GIB: "0.001",
      OPENMELD_LOCAL_MEMORY_HEADROOM_GIB: "0.001",
      OPENMELD_LOCAL_HEAVY_SLOTS: "1",
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const messages = [];
  const waiting = new Map();
  child.on("message", (event) => {
    messages.push(event);
    waiting.get(event.type)?.(event);
  });
  t.after(async () => {
    const rows = readProcessRows({ includeMetrics: true });
    const root = rows.find((row) => row.pid === child.pid);
    if (root) {
      await stopProcessTree([root], { graceMs: 100 });
    }
  });
  return {
    child,
    message: (type) =>
      Promise.resolve(
        messages.find((event) => event.type === type) ??
          new Promise((resolve) => waiting.set(type, resolve))
      ),
  };
}

test(
  "coordinates separate processes, permits nested work, cancels waiting and recovers a dead owner",
  { timeout: 60_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "openmeld-resources-"));
    assert.deepEqual(
      readIsolatedDevOwners(join(directory, "removed-worktree"), [], directory),
      []
    );
    // Register removal first; cleanup hooks run in registration order, so explicit
    // child cleanup below precedes directory retirement.
    const a = startChild(t, "resource", directory);
    await a.message("acquired");
    a.child.send("nested");
    await a.message("nested-acquired");
    const b = startChild(t, "resource", directory);
    await b.message("waiting");
    b.child.send("cancel");
    await b.message("cancelled");
    const c = startChild(t, "resource", directory);
    await c.message("waiting");
    a.child.kill("SIGKILL");
    await c.message("acquired");
    c.child.send("release");
    t.after(() => rmSync(directory, { recursive: true, force: true }));
  }
);

test(
  "stops a real parent and orphaned child while another environment stays alive",
  { timeout: 60_000 },
  async (t) => {
    const a = startChild(t, "tree", "unused");
    const b = startChild(t, "tree", "unused");
    const first = await a.message("ready");
    const second = await b.message("ready");
    const rows = readProcessRows({ includeMetrics: true });
    const root = rows.find((row) => row.pid === first.pid);
    assert.ok(root.startedAt);
    assert.ok(root.rssBytes > 0);
    const targets = collectTargetProcesses(rows, {
      currentPid: process.pid,
      roots: [root],
      matcherContext: buildProcessMatcherContext("/not-a-real-repository"),
    });
    assert.deepEqual(
      targets.map((row) => row.pid).sort((x, y) => x - y),
      [first.pid, first.leafPid].sort((x, y) => x - y)
    );
    await stopProcessTree(targets, { graceMs: 100 });
    const after = readProcessRows({ includeMetrics: true });
    assert.equal(
      after.some((row) =>
        targets.some((expected) => sameProcess(expected, row))
      ),
      false
    );
    assert.ok(after.some((row) => row.pid === second.leafPid));
    assert.equal(
      sameProcess({ ...root, startedAt: "reused-pid" }, root),
      false
    );
  }
);

test("reserves pending startup memory and distinguishes unknown memory", () => {
  const policy = resourcePolicy(
    { OPENMELD_LOCAL_MEMORY_HEADROOM_GIB: "1" },
    16 * 1024 ** 3
  );
  const input = {
    kind: "stack",
    entries: [],
    rows: [],
    availableBytes: 8 * 1024 ** 3,
    policy,
  };
  assert.equal(admissionReason(input), null);
  assert.match(
    admissionReason({
      ...input,
      entries: [{ pid: 10, bytes: 6 * 1024 ** 3, kind: "stack" }],
    }),
    BUDGET_PATTERN
  );
  assert.match(
    admissionReason({ ...input, availableBytes: null }),
    UNKNOWN_PATTERN
  );
  assert.throws(
    () => resourcePolicy({ OPENMELD_LOCAL_HEAVY_SLOTS: "1.5" }),
    INTEGER_PATTERN
  );
});

test("macOS includes inactive pages without confusing free pages with pressure", () => {
  const output =
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 4218.\nPages inactive: 534257.\nPages speculative: 10850.\nPages purgeable: 0.\n";
  const memory = parseMacMemory(output, 2, 48 * 1024 ** 3);
  assert.equal(memory.availableBytes, (4218 + 534_257 + 10_850) * 16_384);
  assert.equal(memory.pressure, "constrained");
  assert.equal(
    admissionReason({
      kind: "stack",
      entries: [],
      rows: [],
      policy: resourcePolicy({}),
      ...memory,
    }),
    "the operating system reports memory pressure"
  );
});
