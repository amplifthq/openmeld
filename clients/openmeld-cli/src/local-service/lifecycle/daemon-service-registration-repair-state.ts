import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DaemonServiceController } from "../../config/daemon-state";
import { daemonRuntimeStateRootPath } from "../../config/daemon-state";
import {
  type OpenMeldPathResolutionInput,
  resolveOpenMeldPresetOwnedPathInput,
} from "../../config/paths";

const REGISTRATION_REPAIR_STATE_SCHEMA =
  "openmeld-service-registration-repair-v1";
const REGISTRATION_REPAIR_STATE_FILENAME = "registration-repair.json";

export type DaemonServiceRegistrationRepairState = {
  v: 1;
  schema: typeof REGISTRATION_REPAIR_STATE_SCHEMA;
  controller: DaemonServiceController;
  pendingSince: string;
};

export async function readDaemonServiceRegistrationRepairState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceRegistrationRepairState | null> {
  const path = registrationRepairStatePath(pathInput);
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (readErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }
  const parsed = JSON.parse(
    raw
  ) as Partial<DaemonServiceRegistrationRepairState>;
  if (
    parsed.v !== 1 ||
    parsed.schema !== REGISTRATION_REPAIR_STATE_SCHEMA ||
    !isDaemonServiceController(parsed.controller) ||
    typeof parsed.pendingSince !== "string" ||
    parsed.pendingSince.length === 0
  ) {
    throw new Error("service registration repair state is invalid");
  }
  return {
    v: 1,
    schema: REGISTRATION_REPAIR_STATE_SCHEMA,
    controller: parsed.controller,
    pendingSince: parsed.pendingSince,
  };
}

export async function markDaemonServiceRegistrationRepairPending(
  controller: DaemonServiceController,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  const path = registrationRepairStatePath(pathInput);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const state: DaemonServiceRegistrationRepairState = {
    v: 1,
    schema: REGISTRATION_REPAIR_STATE_SCHEMA,
    controller,
    pendingSince: new Date().toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
  } catch (writeError) {
    try {
      await rm(tempPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [writeError, cleanupError],
        "service registration repair state write failed and its temporary file could not be removed"
      );
    }
    throw writeError;
  }
}

export async function clearDaemonServiceRegistrationRepairPending(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await rm(registrationRepairStatePath(pathInput), { force: true });
}

function registrationRepairStatePath(
  pathInput: OpenMeldPathResolutionInput
): string {
  const ownerPathInput = resolveOpenMeldPresetOwnedPathInput(pathInput);
  return join(
    daemonRuntimeStateRootPath(ownerPathInput),
    REGISTRATION_REPAIR_STATE_FILENAME
  );
}

function isDaemonServiceController(
  value: unknown
): value is DaemonServiceController {
  return (
    value === "launchd" ||
    value === "systemd" ||
    value === "windows-service" ||
    value === "legacy-detached" ||
    value === "unknown"
  );
}

function readErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    return typeof error.code === "string" ? error.code : null;
  }
  return null;
}
