import { setTimeout as delay } from "node:timers/promises";
import { readProcessRows } from "./process-rows.mjs";

// Roots must already have been attributed to the caller. Never walk upwards
// into a terminal, coding agent, or another worktree's supervisor.
export function collectDescendants(rows, rootPids, excludedPids = []) {
  const selected = new Set(rootPids);
  const excluded = new Set(excludedPids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (
        !excluded.has(row.pid) &&
        selected.has(row.parentPid) &&
        !selected.has(row.pid)
      ) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => selected.has(row.pid) && !excluded.has(row.pid));
}

export function sameProcess(expected, actual) {
  return Boolean(
    actual &&
      expected.pid === actual.pid &&
      expected.startedAt &&
      expected.startedAt === actual.startedAt &&
      !actual.state?.startsWith("Z")
  );
}

// Snapshot identities before signalling; keep observing children while their
// owners are alive, including children created during a configuration reload.
export async function stopProcessTree(
  targets,
  { repoRoot, graceMs = 5000 } = {}
) {
  const tracked = new Map(targets.map((row) => [row.pid, row]));
  const refresh = () => {
    const rows = readProcessRows({ repoRoot, includeMetrics: true });
    const live = rows.filter((row) =>
      sameProcess(tracked.get(row.pid) ?? {}, row)
    );
    for (const row of collectDescendants(
      rows,
      live.map((item) => item.pid),
      [process.pid]
    )) {
      if (!tracked.has(row.pid)) {
        tracked.set(row.pid, row);
      }
    }
    return rows.filter((row) => sameProcess(tracked.get(row.pid) ?? {}, row));
  };
  const signal = (rows, value) => {
    for (const row of rows) {
      try {
        process.kill(row.pid, value);
      } catch (error) {
        if (error.code !== "ESRCH") {
          throw error;
        }
      }
    }
  };
  let live = refresh();
  const roots = live.filter((row) => !tracked.has(row.parentPid));
  signal(roots, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (live.length && Date.now() < deadline) {
    await delay(150);
    live = refresh();
  }
  if (live.length) {
    signal(live.toReversed(), "SIGTERM");
    await delay(300);
    signal(refresh().toReversed(), "SIGKILL");
    const killDeadline = Date.now() + 3000;
    do {
      await delay(100);
      live = refresh();
    } while (live.length && Date.now() < killDeadline);
  }
  if (live.length) {
    throw new Error(
      `Owned processes did not exit: ${live.map((row) => row.pid).join(", ")}. State was preserved.`
    );
  }
}
