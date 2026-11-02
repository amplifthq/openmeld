import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { serviceExecutionHostOwnerSchema } from "@openmeld/schemas";
import { z } from "zod/v4";
import {
  acquireLock,
  isOpenMeldLockError,
  MALFORMED_LOCK_RECOVERY_GRACE_MS,
  releaseLock,
} from "../../config/lock";
import { systemDir } from "../../config/paths";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isProcessIdentityAlive,
  readProcessStartIdentity,
} from "../../system/process-identity";
import { toErrorMessage, warnDaemonEvent } from "../core/logger";
import { ExecutionHostError } from "./channel";

const run = promisify(execFile);
const WINDOWS_BOOT_EVENT = /^\d+:\d+$/;
const DECIMAL = /^\d+$/;

type OwnedProcessEvent = {
  phase: "process_exit" | "process_spawned";
  processId: number | null;
  signalTarget: "process" | "process_group";
  taskId: string;
};

type HostOwnerReceipt = Extract<
  z.infer<typeof serviceExecutionHostOwnerSchema>,
  {
    schema:
      | "service-execution-host-owner-v2"
      | "service-execution-host-owner-v3";
  }
>;

export type ExecutionHostWorkState = {
  localQuiescent: boolean;
  // Controls, adapter maintenance and workspace cleanup launch unrecorded processes.
  unattributedWork: boolean;
  runningTaskIds: readonly string[];
};

export type ProviderInvocationEvent = {
  phase: "ended" | "started";
  taskId: string;
};

type TaskEvidence = {
  activeInvocations: number;
  // Points where a running invocation may launch a process it has not yet
  // recorded: its start, and each recorded exit before it ends.
  unrecordedLaunches: number;
  completedInvocation: boolean;
};

// Preparation before the first invocation can launch work it never records.
// Workspace cleanup after an invocation is tracked as unattributed work.
function isTaskEvidenceComplete(task: TaskEvidence): boolean {
  return task.activeInvocations > 0
    ? task.unrecordedLaunches === 0
    : task.completedInvocation;
}

export async function readExecutionHostBootIdentity(): Promise<string | null> {
  try {
    return await readBootIdentity();
  } catch {
    // Fresh/quiescent starts do not require reboot evidence. Unknown evidence
    // can never clear an unsafe previous owner, and is not another boot.
    console.warn(
      "[openmeld.execution_host.boot_unknown] Automatic recovery of unconfirmed work requires operating-system restart evidence."
    );
    return null;
  }
}

async function readBootIdentity(): Promise<string | null> {
  if (process.platform === "linux") {
    const id = z
      .uuid()
      .parse(
        (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
      );
    return `linux:${id.toLowerCase()}`;
  }
  let stdout = "";
  if (process.platform === "darwin") {
    // XNU's immutable boot-session UUID, not its clock-adjustable boot time.
    ({ stdout } = await run(
      "/usr/sbin/sysctl",
      ["-n", "kern.bootsessionuuid"],
      {
        timeout: 5000,
      }
    ));
    return `darwin:${z.uuid().parse(stdout.trim()).toLowerCase()}`;
  }
  if (process.platform === "win32") {
    ({ stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; $e=Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Kernel-General';Id=12} -MaxEvents 1; if($null -eq $e.RecordId -or $null -eq $e.TimeCreated){throw 'Boot event unavailable'}; [Console]::WriteLine(([string]$e.RecordId)+':'+([string]$e.TimeCreated.ToUniversalTime().Ticks))",
      ],
      { timeout: 5000, windowsHide: true }
    ));
    if (!WINDOWS_BOOT_EVENT.test(stdout.trim())) {
      throw new Error("Invalid Windows boot event");
    }
    return `win32:${stdout.trim()}`;
  }
  return null;
}

function confirmsNewBoot(
  previous: string | null,
  current: string | null
): boolean {
  if (!(previous && current) || previous === current) {
    return false;
  }
  const [priorSource, priorId, priorTime] = previous.split(":");
  const [source, id, time] = current.split(":");
  if (source !== priorSource) {
    return false;
  }
  if (source === "linux" || source === "darwin") {
    return (
      z.uuid().safeParse(id).success && z.uuid().safeParse(priorId).success
    );
  }
  // Kernel-General 12 records OS startup, not EventLog-service restarts or
  // wall-clock corrections. Require a later retained event in both fields;
  // missing/cleared/rotated evidence cannot authorize replacing unknown work.
  if (
    source !== "win32" ||
    !id ||
    !time ||
    !priorId ||
    !priorTime ||
    ![id, time, priorId, priorTime].every((value) => DECIMAL.test(value))
  ) {
    return false;
  }
  return BigInt(id) > BigInt(priorId) && BigInt(time) > BigInt(priorTime);
}

export async function acquireExecutionHostOwnership(input: {
  hostInstanceId: string;
  ownerUserId: string;
  deviceId: string;
  lane: "prod" | "dev-local" | "canary";
  stateRoot: string;
  bootIdentity: string | null;
}) {
  const lock = await acquireProcessOwnerLock(input);
  const path = join(
    systemDir({ env: { OPENMELD_HOME: input.stateRoot } }),
    "execution-host-owner.json"
  );
  try {
    const previous = readOwner(path);
    if (
      previous &&
      !previous.localQuiescent &&
      !confirmsNewBoot(previous.bootIdentity, input.bootIdentity)
    ) {
      assertPreviousOwnerReplaceableOnSameBoot(previous);
    }
    let owner: HostOwnerReceipt = {
      schema: "service-execution-host-owner-v2",
      hostInstanceId: input.hostInstanceId,
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: input.lane,
      pid: process.pid,
      processStartedAt: CURRENT_PROCESS_START_IDENTITY,
      bootIdentity: input.bootIdentity,
      localQuiescent: true,
      processEvidenceComplete: true,
      ownedProcessTrees: [],
    };
    serviceExecutionHostOwnerSchema.parse(owner);
    persist(owner);
    function persist(next: HostOwnerReceipt) {
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify(next), {
          mode: 0o600,
          flag: "wx",
        });
        renameSync(temporary, path);
      } catch (error) {
        warnDaemonEvent("[openmeld.execution_host.receipt_write_failed]", {
          event: "cli.execution_host.receipt_write_failed",
          detail: toErrorMessage(error),
        });
        throw new ExecutionHostError(
          "host.execution_record_unavailable",
          "The local execution host could not write its ownership record."
        );
      }
    }
    // A failed write throws to the caller, which refuses the operation rather
    // than weakening the fence.
    function update(changes: Partial<Omit<HostOwnerReceipt, "schema">>) {
      const merged = { ...owner, ...changes };
      const next: HostOwnerReceipt = {
        ...merged,
        // A quiescent receipt carries no evidence, so it keeps the shape an
        // older Service reads after a verified rollback.
        schema: merged.localQuiescent
          ? "service-execution-host-owner-v2"
          : "service-execution-host-owner-v3",
      };
      if (JSON.stringify(next) === JSON.stringify(owner)) {
        return;
      }
      persist(next);
      owner = next;
    }
    // Evidence is per running task and per provider invocation. One task's
    // record never vouches for another task, and one invocation's record never
    // vouches for the next invocation of the same task.
    const tasks = new Map<string, TaskEvidence>();
    let unattributedWork = false;
    const evidenceComplete = () =>
      !unattributedWork && [...tasks.values()].every(isTaskEvidenceComplete);
    return {
      observeWork(state: ExecutionHostWorkState) {
        if (state.localQuiescent) {
          tasks.clear();
          unattributedWork = false;
          // Idle slots do not prove a recorded process group has exited; the
          // receipt stays non-quiescent until every recorded tree is gone.
          const liveTrees = owner.ownedProcessTrees.filter(
            isOwnedProcessTreeAlive
          );
          update({
            localQuiescent: liveTrees.length === 0,
            processEvidenceComplete: true,
            ownedProcessTrees: liveTrees,
          });
          return;
        }
        const running = new Set(state.runningTaskIds);
        for (const taskId of tasks.keys()) {
          if (!running.has(taskId)) {
            tasks.delete(taskId);
          }
        }
        for (const taskId of running) {
          if (!tasks.has(taskId)) {
            tasks.set(taskId, {
              activeInvocations: 0,
              unrecordedLaunches: 0,
              completedInvocation: false,
            });
          }
        }
        unattributedWork = state.unattributedWork;
        update({
          localQuiescent: false,
          processEvidenceComplete: evidenceComplete(),
        });
      },
      // Called before a provider invocation can launch anything, so the
      // durable receipt is incomplete first; a failed write refuses it.
      observeProviderInvocation(event: ProviderInvocationEvent) {
        const task = tasks.get(event.taskId);
        if (!task) {
          return;
        }
        if (event.phase === "started") {
          task.activeInvocations += 1;
          task.unrecordedLaunches += 1;
        } else {
          task.activeInvocations = Math.max(0, task.activeInvocations - 1);
          if (task.activeInvocations === 0) {
            task.unrecordedLaunches = 0;
            task.completedInvocation = true;
          }
        }
        update({ processEvidenceComplete: evidenceComplete() });
      },
      observeOwnedProcess(event: OwnedProcessEvent) {
        const task = tasks.get(event.taskId);
        if (event.phase === "process_spawned") {
          if (event.processId === null) {
            return;
          }
          const processStartedAt =
            readProcessStartIdentity(event.processId) ??
            `fallback:${event.processId}:unknown`;
          if (task && task.activeInvocations > 0) {
            task.unrecordedLaunches = Math.max(0, task.unrecordedLaunches - 1);
          }
          update({
            localQuiescent: false,
            processEvidenceComplete: evidenceComplete(),
            ownedProcessTrees: [
              ...owner.ownedProcessTrees.filter(
                (process) => process.pid !== event.processId
              ),
              {
                pid: event.processId,
                processStartedAt,
                signalTarget: event.signalTarget,
              },
            ],
          });
          return;
        }
        if (event.processId === null) {
          return;
        }
        // A running invocation may launch again after a recorded process
        // exits, such as a context-heal retry.
        if (task && task.activeInvocations > 0) {
          task.unrecordedLaunches += 1;
        }
        update({
          processEvidenceComplete: evidenceComplete(),
          ownedProcessTrees: owner.ownedProcessTrees.filter(
            (process) =>
              process.pid !== event.processId ||
              isOwnedProcessTreeAlive(process)
          ),
        });
      },
      release: () => releaseLock(lock),
    };
  } catch (error) {
    await releaseLock(lock);
    throw error;
  }
}

async function acquireProcessOwnerLock(input: {
  hostInstanceId: string;
  ownerUserId: string;
  stateRoot: string;
}) {
  try {
    return await acquireLock({
      openMeldProfileId: "service-execution-host",
      key: "process-owner",
      pathResolution: {
        env: { ...process.env, OPENMELD_HOME: input.stateRoot },
      },
      meta: {
        hostInstanceId: input.hostInstanceId,
        ownerUserId: input.ownerUserId,
      },
    });
  } catch (error) {
    if (!(isOpenMeldLockError(error) && error.contentionState === "active")) {
      throw error;
    }
    if (typeof error.meta?.pid === "number") {
      throw new ExecutionHostError(
        "host.previous_work_running",
        "Another execution host for this installation is still running. This Host starts after it exits; no task will be restarted automatically."
      );
    }
    // A lock briefly has no owner entry while it is published or released.
    // Past the lock's own recovery grace, there is no process to wait for.
    if (await isOwnerLockHandoffPossible(error.lockPath)) {
      throw new ExecutionHostError(
        "host.previous_work_running",
        "Another execution host for this installation is starting or stopping. This Host checks again shortly; no task will be restarted automatically."
      );
    }
    throw new ExecutionHostError(
      "host.owner_lock_unverified",
      "The execution host lock for this installation has no identifiable owner. Preserve it for diagnostics; automatic replacement is refused."
    );
  }
}

async function isOwnerLockHandoffPossible(lockPath: string): Promise<boolean> {
  try {
    const stats = await lstat(lockPath);
    return Date.now() - stats.mtimeMs < MALFORMED_LOCK_RECOVERY_GRACE_MS;
  } catch (error) {
    return isNodeError(error, "ENOENT");
  }
}

// Waiting can clear only a fence whose recorded processes are still alive.
// Incomplete or legacy evidence, including a non-quiescent V2 receipt whose
// completeness was Host-wide, stays unconfirmed however long it is retried.
function assertPreviousOwnerReplaceableOnSameBoot(
  previous: NonNullable<ReturnType<typeof readOwner>>
): void {
  if (
    previous.schema !== "service-execution-host-owner-v3" ||
    !previous.processEvidenceComplete
  ) {
    throw new ExecutionHostError(
      "host.previous_work_unconfirmed",
      "The previous execution host ended before its local work was confirmed stopped. Restart this Computer, then check its connection. If restart evidence is unavailable, inspect the retained Host diagnostics before recovery. Existing results remain saved; no task will be restarted automatically."
    );
  }
  if (
    isProcessIdentityAlive({
      ownerPid: previous.pid,
      ownerProcessStartedAt: previous.processStartedAt,
    }) ||
    previous.ownedProcessTrees.some(isOwnedProcessTreeAlive)
  ) {
    throw new ExecutionHostError(
      "host.previous_work_running",
      "Local agent work recorded by the previous execution host is still running. This Host starts after that work exits; no task will be restarted automatically."
    );
  }
}

function isOwnedProcessTreeAlive(input: {
  pid: number;
  processStartedAt: string;
  signalTarget: "process" | "process_group";
}): boolean {
  if (input.signalTarget === "process_group" && process.platform !== "win32") {
    try {
      process.kill(-input.pid, 0);
      return true;
    } catch (error) {
      return !isNodeError(error, "ESRCH");
    }
  }
  return isProcessIdentityAlive({
    ownerPid: input.pid,
    ownerProcessStartedAt: input.processStartedAt,
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && String(error.code) === code
  );
}

function readOwner(path: string) {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw new ExecutionHostError(
      "host.owner_corrupt",
      `The Host ownership record cannot be read (${error instanceof Error ? error.message : String(error)}). Preserve it for diagnostics; automatic replacement is refused.`
    );
  }
  try {
    const parsed = serviceExecutionHostOwnerSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Unreadable JSON is as unverifiable as a record with the wrong shape.
  }
  throw new ExecutionHostError(
    "host.owner_corrupt",
    "The Host ownership record cannot be verified. Preserve it for diagnostics; automatic replacement is refused."
  );
}
