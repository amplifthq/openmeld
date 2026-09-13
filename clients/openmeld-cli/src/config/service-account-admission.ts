import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ServiceAccountAdmission,
  type ServiceAccountAdmissionIdentity,
  serviceAccountAdmissionSchema,
} from "@openmeld/schemas";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isProcessIdentityAlive,
  readProcessStartIdentity,
} from "../system/process-identity";
import { withAuthSessionTransitionMutationLock } from "./auth-session-transition-lock";
import { writeDaemonLocalStateFile } from "./daemon-local-state-file";
import { openMeldRootDir } from "./paths";

export class ServiceAccountAdmissionError extends Error {
  readonly code: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "ServiceAccountAdmissionError";
    this.code = `service.account_admission.${reason}`;
  }
}

function admissionPath(): string {
  return join(openMeldRootDir(), "auth", "service-account-admission.json");
}

export async function readServiceAccountAdmission(): Promise<ServiceAccountAdmission | null> {
  let raw: string;
  try {
    raw = await readFile(admissionPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const parsed = serviceAccountAdmissionSchema.safeParse(value);
  if (!parsed.success) {
    throw new ServiceAccountAdmissionError(
      "unknown",
      "OpenMeld could not verify the pending Service action. Run `openmeld service status --json` for diagnostics."
    );
  }
  return parsed.data;
}

async function writeAdmission(value: ServiceAccountAdmission): Promise<void> {
  await writeDaemonLocalStateFile({
    path: admissionPath(),
    schema: serviceAccountAdmissionSchema,
    value,
    mode: 0o600,
  });
}

// Caller owns the auth mutation mutex. Cancellation is a durable generation
// fence, not removal: a delayed carrier must still be refused after recovery.
export async function assertServiceAccountAdmissionMutationAvailable(): Promise<void> {
  const current = await readServiceAccountAdmission();
  if (current?.state !== "pending") {
    return;
  }
  if (isProcessIdentityAlive(current.requester)) {
    throw new ServiceAccountAdmissionError(
      "busy",
      "OpenMeld is starting or stopping this Service. Try the account change again when that action is accepted."
    );
  }
  await writeAdmission({ ...current, state: "cancelled" });
}

// The caller must hold the auth mutation mutex and validate local credentials
// and the service contract in that same critical section.
export async function reserveServiceAccountAdmission(input: {
  operation: ServiceAccountAdmission["operation"];
  identity: ServiceAccountAdmissionIdentity;
  target?: ServiceAccountAdmission["target"];
}): Promise<ServiceAccountAdmission> {
  await assertServiceAccountAdmissionMutationAvailable();
  const previous = await readServiceAccountAdmission();
  if (!CURRENT_PROCESS_START_IDENTITY.startsWith("ps:")) {
    throw new ServiceAccountAdmissionError(
      "unknown",
      "OpenMeld could not verify this command's process identity. Try again from a supported local CLI."
    );
  }
  const reservation: ServiceAccountAdmission = {
    version: 1,
    id: randomUUID(),
    operation: input.operation,
    state: "pending",
    identity: input.identity,
    ...(input.target ? { target: input.target } : {}),
    requester: {
      ownerPid: process.pid,
      ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
    },
    ...(previous?.startupReceipt
      ? { startupReceipt: previous.startupReceipt }
      : {}),
  };
  await writeAdmission(reservation);
  return reservation;
}

export async function cancelServiceAccountAdmission(id: string): Promise<void> {
  await withAuthSessionTransitionMutationLock(async () => {
    const current = await readServiceAccountAdmission();
    if (current?.id === id && current.state === "pending") {
      await writeAdmission({ ...current, state: "cancelled" });
    }
  });
}

// Caller holds the auth mutex and has bound its actual local identity first.
export async function admitServiceAccountOperation(input: {
  id: string;
  operation: ServiceAccountAdmission["operation"];
  identity: ServiceAccountAdmissionIdentity;
  commit?: () => void;
}): Promise<void> {
  const current = await readServiceAccountAdmission();
  const contractBinding = bindServiceAccountIdentity(input.identity);
  if (
    input.operation === "start" &&
    current?.startupReceipt?.id === input.id &&
    current.startupReceipt.contractBinding === contractBinding
  ) {
    // A receipt never changes the latest command or its auth reservation.
    // Current contract identity is checked by the carrier before this call;
    // ordinary runtime ownership still prevents two active Service instances.
    return;
  }
  if (
    !current ||
    current.id !== input.id ||
    current.operation !== input.operation ||
    current.state !== "pending" ||
    readProcessStartIdentity(current.requester.ownerPid) !==
      current.requester.ownerProcessStartedAt ||
    (current.target !== undefined &&
      (current.target.ownerPid !== process.pid ||
        current.target.ownerProcessStartedAt !==
          CURRENT_PROCESS_START_IDENTITY)) ||
    JSON.stringify(current.identity) !== JSON.stringify(input.identity)
  ) {
    throw new ServiceAccountAdmissionError(
      "cancelled",
      "This Service action is no longer authorized. Check the signed-in account and try again."
    );
  }
  input.commit?.();
  await writeAdmission({
    ...current,
    state: "admitted",
    carrier: {
      ownerPid: process.pid,
      ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
    },
    ...(input.operation === "start"
      ? { startupReceipt: { id: input.id, contractBinding } }
      : {}),
  });
}

function bindServiceAccountIdentity(
  identity: ServiceAccountAdmissionIdentity
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.accountId,
        identity.authBaseUrl,
        identity.clientId,
        identity.gatewayUrl,
        identity.lane,
        identity.deviceId,
        identity.contractGeneration,
      ])
    )
    .digest("hex");
}
