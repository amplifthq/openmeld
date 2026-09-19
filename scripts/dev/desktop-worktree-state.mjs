import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { withRegistryLock } from "./dev-isolated-lane.mjs";
import { readProcessRows } from "./process-rows.mjs";
import {
  collectDescendants,
  sameProcess,
  stopProcessTree,
} from "./process-tree.mjs";

const recordPath = (root) =>
  join(root, ".turbo", "dev", "desktop-worktree.json");

export function readDesktopRecord(root) {
  try {
    const record = JSON.parse(readFileSync(recordPath(root), "utf8"));
    if (record.version !== 1 || record.repoRoot !== resolve(root)) {
      throw new Error("Desktop ownership record belongs to another worktree.");
    }
    return record;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function writeDesktopRecord(root, record) {
  const file = recordPath(root);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ ...record, version: 1, repoRoot: resolve(root) })}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, file);
}

/** No PID-only attribution, upward process walks, or matches against other apps. */
export function desktopProcessOwners(
  root,
  rows,
  record = readDesktopRecord(root)
) {
  if (!record || record.repoRoot !== resolve(root) || record.version !== 1) {
    return [];
  }
  const owners = rows.filter((row) => sameProcess(record, row));
  // Recover a cold OS launch / surviving GUI after its shell owner exited. Only
  // our generated bundle can be discovered this way, never a supplied .app.
  const executable = record.executable;
  if (
    typeof executable === "string" &&
    executable.startsWith(
      join(resolve(root), "clients/desktop/dist/development") + sep
    )
  ) {
    for (const row of rows) {
      if (
        row.startedAt &&
        (row.command === executable || row.command.startsWith(`${executable} `))
      ) {
        owners.push(row);
      }
    }
  }
  return [...new Map(owners.map((row) => [row.pid, row])).values()];
}

export function desktopProcessSnapshot(
  root,
  rows = readProcessRows({ repoRoot: root, includeMetrics: true })
) {
  const record = readDesktopRecord(root);
  const processes = collectDescendants(
    rows,
    desktopProcessOwners(root, rows, record).map((row) => row.pid),
    [process.pid]
  );
  const running = processes.length > 0;
  const ownerPresent = record && rows.some((row) => sameProcess(record, row));
  let phase = "stopped";
  if (running) {
    phase = ownerPresent ? (record.phase ?? "running") : "running";
  }
  return { record, processes, running, phase };
}

export async function stopDesktopWorktree(root, { dryRun = false } = {}) {
  const snapshot = desktopProcessSnapshot(root);
  if (!dryRun) {
    await stopProcessTree(snapshot.processes, { repoRoot: root });
  }
  return {
    running: snapshot.running,
    dryRun,
    pids: snapshot.processes.map((row) => row.pid),
  };
}

export function withDesktopWorktreeOwner(root, signal, callback) {
  return withRegistryLock(
    {
      lockPath: join(root, ".turbo", "dev", "desktop-worktree.lock"),
      lockPid: process.pid,
      timeoutMs: 2000,
      signal,
      isPidAlive(pid) {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") {
            return false;
          }
          throw error;
        }
      },
    },
    async () => {
      const snapshot = desktopProcessSnapshot(root);
      if (snapshot.running) {
        throw new Error(
          "This worktree already owns a Desktop process. Inspect pnpm desktop:status; stop it explicitly before rebuilding."
        );
      }
      const owner = readProcessRows({
        repoRoot: root,
        includeMetrics: true,
      }).find((row) => row.pid === process.pid);
      if (!owner?.startedAt) {
        throw new Error("Cannot verify Desktop launcher process identity.");
      }
      writeDesktopRecord(root, {
        ...snapshot.record,
        pid: owner.pid,
        startedAt: owner.startedAt,
        phase: "preparing",
      });
      try {
        return await callback(owner);
      } finally {
        const current = readDesktopRecord(root);
        if (
          current?.pid === owner.pid &&
          current.startedAt === owner.startedAt
        ) {
          writeDesktopRecord(root, {
            ...current,
            pid: null,
            startedAt: null,
            phase: "stopped",
          });
        }
      }
    }
  );
}
