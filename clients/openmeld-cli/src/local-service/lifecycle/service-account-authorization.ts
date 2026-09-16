import { resolve } from "node:path";
import type { ServiceAccountAdmissionIdentity } from "@openmeld/schemas";
import {
  readServiceAdmissionSessionWithOwnership,
  type StoredAuthSession,
  withAdmittedServiceSession,
} from "../../config/auth-session";
import { withAuthSessionTransitionMutationLock } from "../../config/auth-session-transition-lock";
import { readDaemonRuntimeLease } from "../../config/daemon-runtime-lease";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { resolveOpenMeldEnvironmentTarget } from "../../config/openmeld-environment-target";
import {
  openMeldRootDir,
  resolveOpenMeldRootDir,
  resolveOpenMeldServiceOwnedPathInput,
} from "../../config/paths";
import {
  admitServiceAccountOperation,
  ServiceAccountAdmissionError,
} from "../../config/service-account-admission";

type Contract = NonNullable<
  Awaited<ReturnType<typeof readDaemonServiceContract>>
>;
function refused(reason: string, message: string): never {
  throw new ServiceAccountAdmissionError(reason, message);
}

export async function resolveServiceAccountIdentity(
  session: StoredAuthSession,
  contract: Contract
): Promise<ServiceAccountAdmissionIdentity> {
  const target = await resolveOpenMeldEnvironmentTarget();
  if (
    resolve(openMeldRootDir()) !==
      resolve(resolveOpenMeldRootDir(resolveOpenMeldServiceOwnedPathInput())) ||
    contract.lane !== target.preset ||
    contract.gatewayUrl !== target.gatewayUrl ||
    session.authBaseUrl !== target.authBaseUrl ||
    !contract.ownerUserId ||
    contract.ownerUserId !== session.user?.id ||
    !contract.connectedComputerId
  ) {
    refused(
      "ownership_mismatch",
      "This Service does not match the signed-in account or environment. Reconnect it through OpenMeld setup before trying again."
    );
  }
  return {
    accountId: contract.ownerUserId,
    authBaseUrl: session.authBaseUrl,
    clientId: session.clientId,
    gatewayUrl: target.gatewayUrl,
    lane: target.preset,
    deviceId: contract.deviceId,
    contractGeneration: contract.generation,
  };
}

export async function runServiceAccountCarrier<T>(
  id: string,
  run: () => Promise<T>
): Promise<T> {
  const session = await withAuthSessionTransitionMutationLock(async () => {
    const local = await readServiceAdmissionSessionWithOwnership();
    const contract = await readDaemonServiceContract();
    if (!contract || contract.desiredState !== "background") {
      refused(
        "cancelled",
        "This Service startup is no longer authorized. Start the Service again from the matching account."
      );
    }
    await admitServiceAccountOperation({
      id,
      operation: "start",
      identity: await resolveServiceAccountIdentity(local, contract),
    });
    return local;
  });
  return await withAdmittedServiceSession(session, run);
}

export async function admitServiceAccountStop(input: {
  id: string;
  ownerUserId: string;
  deviceId: string;
  contractGeneration: number;
  commit: () => void;
}): Promise<void> {
  await withAuthSessionTransitionMutationLock(async () => {
    const session = await readServiceAdmissionSessionWithOwnership();
    const contract = await readDaemonServiceContract();
    const lease = await readDaemonRuntimeLease();
    if (
      !(contract && lease) ||
      lease.pid !== process.pid ||
      contract.generation !== input.contractGeneration ||
      contract.ownerUserId !== input.ownerUserId ||
      contract.deviceId !== input.deviceId
    ) {
      refused(
        "ownership_changed",
        "The running Service changed before this Stop was accepted. Check its status and try again."
      );
    }
    await admitServiceAccountOperation({
      id: input.id,
      operation: "stop",
      identity: await resolveServiceAccountIdentity(session, contract),
      commit: input.commit,
    });
  });
}
