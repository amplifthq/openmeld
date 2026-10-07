import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { serviceExecutionHostOwnerSchema } from "@openmeld/schemas";
import { z } from "zod/v4";
import { acquireLock, releaseLock } from "../../config/lock";
import { systemDir } from "../../config/paths";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isProcessIdentityAlive,
  readProcessStartIdentity,
} from "../../system/process-identity";
import { ExecutionHostError } from "./channel";

const run = promisify(execFile);
const WINDOWS_BOOT_EVENT = /^\d+:\d+$/;
const DECIMAL = /^\d+$/;

type OwnedProcessEvent = {
  phase: "process_exit" | "process_spawned";
  processId: number | null;
  signalTarget: "process" | "process_group";
};

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
  const lock = await acquireLock({
    openMeldProfileId: "service-execution-host",
    key: "process-owner",
    pathResolution: { env: { ...process.env, OPENMELD_HOME: input.stateRoot } },
    meta: {
      hostInstanceId: input.hostInstanceId,
      ownerUserId: input.ownerUserId,
    },
  });
  const path = join(
    systemDir({ env: { OPENMELD_HOME: input.stateRoot } }),
    "execution-host-owner.json"
  );
  try {
    const previous = readOwner(path);
    if (
      previous &&
      !previous.localQuiescent &&
      !confirmsNewBoot(previous.bootIdentity, input.bootIdentity) &&
      !canRecoverPreviousOwnerOnSameBoot(previous)
    ) {
      throw new ExecutionHostError(
        "host.previous_work_unconfirmed",
        "The previous execution host ended before its local work was confirmed stopped. Restart this Computer, then check its connection. If restart evidence is unavailable, inspect the retained Host diagnostics before recovery. Existing results remain saved; no task will be restarted automatically."
      );
    }
    let owner = serviceExecutionHostOwnerSchema.parse({
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
    });
    persist(owner);
    function persist(next: typeof owner) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(next), {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temporary, path);
    }
    return {
      observeLocalQuiescence(quiescent: boolean) {
        if (owner.localQuiescent === quiescent) {
          return;
        }
        const next = {
          ...owner,
          localQuiescent: quiescent,
          ...(owner.schema === "service-execution-host-owner-v2"
            ? {
                processEvidenceComplete: quiescent,
                ...(quiescent ? { ownedProcessTrees: [] } : {}),
              }
            : {}),
        };
        // The unsafe transition is durable before any provider operation. A
        // failed write refuses that operation rather than weakening the fence.
        persist(next);
        owner = next;
      },
      observeOwnedProcess(event: OwnedProcessEvent) {
        if (owner.schema !== "service-execution-host-owner-v2") {
          return;
        }
        if (event.phase === "process_spawned") {
          if (event.processId === null) {
            const next = { ...owner, processEvidenceComplete: false };
            persist(next);
            owner = next;
            return;
          }
          const processStartedAt =
            readProcessStartIdentity(event.processId) ??
            `fallback:${event.processId}:unknown`;
          const next = {
            ...owner,
            processEvidenceComplete: true,
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
          };
          persist(next);
          owner = next;
          return;
        }
        if (event.processId === null) {
          return;
        }
        const next = {
          ...owner,
          ownedProcessTrees: owner.ownedProcessTrees.filter(
            (process) =>
              process.pid !== event.processId ||
              isOwnedProcessTreeAlive(process)
          ),
        };
        persist(next);
        owner = next;
      },
      release: () => releaseLock(lock),
    };
  } catch (error) {
    await releaseLock(lock);
    throw error;
  }
}

function canRecoverPreviousOwnerOnSameBoot(
  previous: ReturnType<typeof readOwner>
): boolean {
  if (
    !previous ||
    previous.schema !== "service-execution-host-owner-v2" ||
    !previous.processEvidenceComplete ||
    isProcessIdentityAlive({
      ownerPid: previous.pid,
      ownerProcessStartedAt: previous.processStartedAt,
    })
  ) {
    return false;
  }
  return previous.ownedProcessTrees.every(
    (process) => !isOwnedProcessTreeAlive(process)
  );
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = serviceExecutionHostOwnerSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ExecutionHostError(
      "host.owner_corrupt",
      "The Host ownership record cannot be verified. Preserve it for diagnostics; automatic replacement is refused."
    );
  }
  return parsed.data;
}
