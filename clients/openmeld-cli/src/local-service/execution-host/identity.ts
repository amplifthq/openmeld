import { resolve } from "node:path";
import type { ServiceExecutionHostIdentity } from "@openmeld/schemas";
import {
  buildStoredAuthSessionIdentity,
  getAuthSessionState,
} from "../../config/auth-session";
import { resolveBaseUrl } from "../../config/base-url";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { resolveOpenMeldRootDir } from "../../config/paths";
import { readProcessStartIdentity } from "../../system/process-identity";
import { ExecutionHostError } from "./channel";

export async function validateExecutionHostIdentity(
  identity: ServiceExecutionHostIdentity
) {
  if (
    process.ppid !== identity.parentPid ||
    (process.platform !== "win32" &&
      readProcessStartIdentity(process.ppid) !==
        identity.parentProcessStartedAt) ||
    resolve(resolveOpenMeldRootDir()) !== resolve(identity.stateRoot)
  ) {
    throw new ExecutionHostError(
      "host.identity_mismatch",
      "The Host's parent or installation changed."
    );
  }
  const [auth, contract, gateway] = await Promise.all([
    getAuthSessionState(),
    readDaemonServiceContract(),
    resolveBaseUrl(),
  ]);
  const session = auth.session;
  if (
    auth.state !== "valid" ||
    !session ||
    !contract ||
    session.user?.id !== identity.ownerUserId ||
    buildStoredAuthSessionIdentity(session) !== identity.sessionIdentity ||
    session.authBaseUrl !== identity.authBaseUrl ||
    gateway !== identity.gatewayBaseUrl ||
    contract.gatewayUrl !== identity.gatewayBaseUrl ||
    contract.ownerUserId !== identity.ownerUserId ||
    contract.deviceId !== identity.deviceId ||
    contract.lane !== identity.lane ||
    contract.generation !== identity.serviceContractGeneration
  ) {
    throw new ExecutionHostError(
      "host.identity_mismatch",
      "The Host's account, device or Service generation changed."
    );
  }
  return { session, contract };
}
