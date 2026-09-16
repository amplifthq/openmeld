import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveGitCommonDirectory,
  withRegistryLock,
} from "./dev-isolated-lane.mjs";
import { readMachineMemory } from "./machine-memory.mjs";
import { readProcessRows } from "./process-rows.mjs";
import { collectDescendants, sameProcess } from "./process-tree.mjs";

const GIB = 1024 ** 3;
export const RESOURCE_TOKEN = "OPENMELD_LOCAL_RESOURCE_TOKEN";

function positiveNumber(env, key, fallback) {
  if (!env[key]) {
    return fallback;
  }
  const value = Number(env[key]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number.`);
  }
  return value;
}

export function resourcePolicy(env = process.env, memoryBytes = totalmem()) {
  const heavySlots = positiveNumber(env, "OPENMELD_LOCAL_HEAVY_SLOTS", 1);
  if (!Number.isInteger(heavySlots)) {
    throw new Error("OPENMELD_LOCAL_HEAVY_SLOTS must be an integer.");
  }
  return {
    heavySlots,
    headroomBytes:
      positiveNumber(
        env,
        "OPENMELD_LOCAL_MEMORY_HEADROOM_GIB",
        Math.max(1, (memoryBytes / GIB) * 0.15)
      ) * GIB,
    costs: {
      stack: positiveNumber(env, "OPENMELD_LOCAL_STACK_GIB", 6) * GIB,
      web: positiveNumber(env, "OPENMELD_LOCAL_WEB_GIB", 2) * GIB,
      heavy: positiveNumber(env, "OPENMELD_LOCAL_HEAVY_GIB", 2) * GIB,
    },
  };
}

export function admissionReason({
  kind,
  entries,
  rows,
  availableBytes,
  policy,
  pressure,
}) {
  if (pressure === "constrained") {
    return "the operating system reports memory pressure";
  }
  if (
    kind === "heavy" &&
    entries.filter((entry) => entry.kind === "heavy").length >=
      policy.heavySlots
  ) {
    return "another broad build or verification owns the heavy-work capacity";
  }
  if (!Number.isFinite(availableBytes) || availableBytes <= 0) {
    return "available memory could not be measured";
  }
  const pendingBytes = reservedGrowthBytes(entries, rows);
  return availableBytes <
    policy.headroomBytes + policy.costs[kind] + pendingBytes
    ? "available memory is below the startup budget plus machine headroom"
    : null;
}

export function reservedGrowthBytes(entries, rows) {
  return entries.reduce((sum, entry) => {
    const tree = collectDescendants(rows, [entry.pid]);
    if (
      tree.length === 0 ||
      tree.some((row) => !Number.isFinite(row.rssBytes))
    ) {
      return sum + entry.bytes;
    }
    const rss = tree.reduce((bytes, row) => bytes + row.rssBytes, 0);
    // Only an explicit successful Worker readiness probe ends startup.
    // Web retains its startup budget because compilation is request-driven.
    const growth =
      entry.kind === "stack" && entry.ready === true
        ? Math.max(GIB, rss * 0.25)
        : Math.max(0, entry.bytes - rss);
    return sum + growth;
  }, 0);
}

export async function markLocalStackReady({
  repoRoot = process.cwd(),
  env = process.env,
  gitCommonDir,
} = {}) {
  const token = env[RESOURCE_TOKEN];
  if (!token) {
    return;
  }
  const commonDir = resolveGitCommonDirectory({ repoRoot, gitCommonDir });
  const registryPath = join(commonDir, "openmeld-dev", "resources.json");
  await withRegistryLock(
    {
      lockPath: join(commonDir, "openmeld-dev", "resources.lock"),
      lockPid: process.pid,
      timeoutMs: 30_000,
      isPidAlive: (pid) => {
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
    () => {
      const entries = JSON.parse(readFileSync(registryPath, "utf8"));
      const rows = readProcessRows({ repoRoot, includeMetrics: true });
      const owner = entries.find(
        (entry) => entry.token === token && entry.kind === "stack"
      );
      if (
        !(
          owner &&
          sameProcess(
            owner,
            rows.find((row) => row.pid === owner.pid)
          ) &&
          collectDescendants(rows, [owner.pid]).some(
            (row) => row.pid === process.pid
          )
        )
      ) {
        throw new Error(
          "Cannot attribute Worker readiness to a live resource owner."
        );
      }
      owner.ready = true;
      const temporary = `${registryPath}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(entries)}\n`, { mode: 0o600 });
      renameSync(temporary, registryPath);
    }
  );
}

// One ledger per Git common directory. It coordinates OpenMeld worktrees, not
// unrelated clones, applications, or OS-enforced memory quotas.
export async function acquireLocalResources({
  kind,
  repoRoot = process.cwd(),
  env = process.env,
  signal,
  onWait = console.error,
  gitCommonDir,
  readMemory = readMachineMemory,
} = {}) {
  const policy = resourcePolicy(env, readMemory().totalBytes);
  if (!(kind in policy.costs)) {
    throw new Error(`Unsupported local resource kind: ${kind}`);
  }
  const commonDir = resolveGitCommonDirectory({ repoRoot, gitCommonDir });
  const directory = join(commonDir, "openmeld-dev");
  const registryPath = join(directory, "resources.json");
  const token = randomUUID();
  let lastReason;
  const transact = (callback, waitingSignal) => {
    return withRegistryLock(
      {
        lockPath: join(directory, "resources.lock"),
        lockPid: process.pid,
        // Process inspection can exceed the lane registry's two-second budget
        // on a busy machine or Windows. Keep lock waiting cancellable.
        timeoutMs: 30_000,
        signal: waitingSignal,
        isPidAlive: (pid) => {
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
      () => {
        const rows = readProcessRows({ repoRoot, includeMetrics: true });
        let records = [];
        try {
          records = JSON.parse(readFileSync(registryPath, "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
        if (!Array.isArray(records)) {
          throw new Error(
            "Invalid local resource registry. No work was started."
          );
        }
        const entries = records.filter((entry) =>
          sameProcess(
            entry,
            rows.find((row) => row.pid === entry.pid)
          )
        );
        const result = callback(entries, rows);
        const temporary = `${registryPath}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(entries)}\n`, {
          mode: 0o600,
        });
        renameSync(temporary, registryPath);
        return result;
      }
    );
  };
  while (true) {
    signal?.throwIfAborted();
    // OS probes can be slow under pressure; do not hold the shared lock while
    // running them. Pending reservations are still reconciled inside the lock.
    const memory = readMemory();
    const result = await transact((entries, rows) => {
      const inherited = entries.find(
        (entry) =>
          entry.token === env[RESOURCE_TOKEN] &&
          entry.kind === kind &&
          collectDescendants(rows, [entry.pid]).some(
            (row) => row.pid === process.pid
          )
      );
      if (inherited) {
        return { inherited: true, token: inherited.token };
      }
      const reason = admissionReason({
        kind,
        entries,
        rows,
        availableBytes: memory.availableBytes,
        pressure: memory.pressure,
        policy,
      });
      if (reason) {
        return {
          reason,
          budget: `Memory GiB: available=${(memory.availableBytes / GIB).toFixed(1)}, headroom=${(policy.headroomBytes / GIB).toFixed(1)}, new=${(policy.costs[kind] / GIB).toFixed(1)}, reserved growth=${(reservedGrowthBytes(entries, rows) / GIB).toFixed(1)}.`,
          owners: entries
            .map((entry) => `${entry.kind}: ${entry.repoRoot}`)
            .join("; "),
        };
      }
      const owner = rows.find((row) => row.pid === process.pid);
      if (!owner?.startedAt) {
        throw new Error(
          "Cannot establish resource owner identity. No work was started."
        );
      }
      entries.push({
        pid: owner.pid,
        startedAt: owner.startedAt,
        kind,
        bytes: policy.costs[kind],
        repoRoot: resolve(repoRoot),
        token,
      });
      return { token };
    }, signal);
    if (!result.reason) {
      return {
        token: result.token,
        release: async () => {
          if (!result.inherited) {
            await transact((entries) => {
              const index = entries.findIndex((entry) => entry.token === token);
              if (index >= 0) {
                entries.splice(index, 1);
              }
            });
          }
        },
      };
    }
    const message = `[local-resources] Waiting: ${result.reason}. ${result.owners || "Other applications also use machine memory."} Cancel with Ctrl+C; inspect pnpm dev:status.`;
    if (message !== lastReason) {
      onWait(`${message} ${result.budget}`);
      lastReason = message;
    }
    await delay(1000, undefined, { signal });
  }
}
