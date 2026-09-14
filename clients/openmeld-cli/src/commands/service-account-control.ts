import { setTimeout as delay } from "node:timers/promises";
import {
  SERVICE_ACCOUNT_STOP_REFUSED_CODE,
  type ServiceAccountControlRequest,
  serviceAccountControlRequestSchema,
} from "@openmeld/schemas";
import {
  getAuthSessionState,
  readServiceAdmissionSessionWithOwnership,
  type StoredAuthSession,
  withAdmittedServiceSession,
} from "../config/auth-session";
import { withAuthSessionTransitionMutationLock } from "../config/auth-session-transition-lock";
import { readDaemonRuntimeLease } from "../config/daemon-runtime-lease";
import {
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../config/daemon-service-contract";
import { withDaemonServiceRunLock } from "../config/daemon-state";
import {
  cancelServiceAccountAdmission,
  readServiceAccountAdmission,
  reserveServiceAccountAdmission,
  ServiceAccountAdmissionError,
} from "../config/service-account-admission";
import {
  LocalDaemonControlPlaneClientError,
  requestLocalDaemonShutdown,
} from "../local-service/control-plane/client";
import { CONTROLLED_SHUTDOWN_REQUEST_TIMEOUT_MS } from "../local-service/core/constants";
import { buildDaemonSystemServiceCommandSpec } from "../local-service/lifecycle/daemon-service-command-spec";
import {
  type DaemonServiceManager,
  resolveDaemonServiceManager,
} from "../local-service/lifecycle/daemon-service-manager";
import { readCurrentDaemonRuntimeContext } from "../local-service/lifecycle/daemon-service-runtime";
import { resolveServiceAccountIdentity } from "../local-service/lifecycle/service-account-authorization";
import { resolveRuntimeContext } from "../runtime/context";
import { readProcessStartIdentity } from "../system/process-identity";
import { fetchAuthUserSnapshot } from "./auth-device-session-client";
import { runDaemonServiceDetached, runDaemonStop } from "./service";
import { createQuietPresenter } from "./service-output";

type Contract = NonNullable<
  Awaited<ReturnType<typeof readDaemonServiceContract>>
>;

function refused(reason: string, message: string): never {
  throw new ServiceAccountAdmissionError(reason, message);
}

export async function runServiceAccountControl(
  request: ServiceAccountControlRequest
): Promise<void> {
  const parsed = serviceAccountControlRequestSchema.safeParse(request);
  if (!parsed.success) {
    refused(
      "missing_account",
      "Choose a signed-in account before controlling this Service."
    );
  }
  const input = parsed.data;
  if (process.platform === "win32") {
    refused(
      "unsupported_platform",
      "Account-checked Service control is not available on Windows yet."
    );
  }
  const auth = await getAuthSessionState();
  if (auth.state !== "valid" || !auth.session) {
    refused(
      "authentication_required",
      "Sign in to the CLI with the matching account and try again."
    );
  }
  const preparedSession = auth.session;
  if (preparedSession.user?.id !== input.expectedAccount) {
    refused(
      "account_mismatch",
      "The CLI is signed in to a different account. Sign in with the matching account and try again."
    );
  }
  // The shared Auth endpoint proves the principal. Local metadata alone does not.
  const user = await fetchAuthUserSnapshot({
    authBaseUrl: preparedSession.authBaseUrl,
    accessToken: preparedSession.accessToken,
  });
  if (user.id !== input.expectedAccount) {
    refused(
      "account_mismatch",
      "The CLI session belongs to a different account. Sign in again and retry."
    );
  }

  await withDaemonServiceRunLock(async () => {
    const contract = await readDaemonServiceContract();
    if (!contract) {
      refused(
        "ownership_unknown",
        "Connect this computer through OpenMeld setup before controlling its Service."
      );
    }
    const observed = await readCurrentDaemonRuntimeContext();
    const lease = await readDaemonRuntimeLease();
    if (
      input.operation === "start" &&
      observed.effectiveRuntimeStatus !== "not_running"
    ) {
      refused(
        "busy",
        "The Service is already running or its state is uncertain. Check Service status before trying again."
      );
    }
    if (
      input.operation === "stop" &&
      (observed.effectiveRuntimeStatus !== "running" ||
        !lease ||
        lease.generation !== contract.generation)
    ) {
      refused(
        "ownership_unknown",
        "OpenMeld could not verify the running Service. Check Service status before trying again."
      );
    }

    let boundSession: StoredAuthSession = preparedSession;
    const reservation = await withAuthSessionTransitionMutationLock(
      async () => {
        boundSession = await readServiceAdmissionSessionWithOwnership();
        if (
          boundSession.accessToken !== preparedSession.accessToken ||
          boundSession.createdAt !== preparedSession.createdAt ||
          boundSession.user?.id !== input.expectedAccount
        ) {
          refused(
            "account_changed",
            "The CLI sign-in changed before this action was accepted. Check the account and try again."
          );
        }
        const current = await readDaemonServiceContract();
        if (!current || JSON.stringify(current) !== JSON.stringify(contract)) {
          refused(
            "ownership_changed",
            "The Service changed before this action was accepted. Check its status and try again."
          );
        }
        const identity = await resolveServiceAccountIdentity(
          boundSession,
          contract
        );
        if (
          input.operation === "start" &&
          contract.desiredState !== "background"
        ) {
          identity.contractGeneration += 1;
        }
        return await reserveServiceAccountAdmission({
          operation: input.operation,
          identity,
          ...(input.operation === "stop" && lease
            ? {
                target: {
                  ownerPid: lease.pid,
                  ownerProcessStartedAt:
                    readProcessStartIdentity(lease.pid) ??
                    refused(
                      "ownership_unknown",
                      "OpenMeld could not identify the Service process. Check its status and try again."
                    ),
                },
              }
            : {}),
        });
      }
    );

    try {
      await withAdmittedServiceSession(boundSession, async () => {
        if (input.operation === "stop") {
          await stopReservedService(contract, reservation.id, lease?.pid ?? 0);
          return;
        }
        const manager =
          contract.serviceController === "legacy-detached"
            ? null
            : await resolveDaemonServiceManager(contract.serviceController);
        if (
          contract.serviceController !== "legacy-detached" &&
          !(manager && (await manager.status()).installed)
        ) {
          refused(
            "installation_required",
            "This Service needs setup before it can start. Run OpenMeld setup and try again."
          );
        }
        await upsertDaemonServiceContract({
          ...contract,
          desiredState: "background",
        });
        if (contract.serviceController === "legacy-detached") {
          const runtime = await resolveRuntimeContext({ view: "agent" });
          await runDaemonServiceDetached({
            accountAdmissionId: reservation.id,
            deviceId: contract.deviceId,
            gatewayUrl: contract.gatewayUrl,
            heartbeatMs: contract.heartbeatMs,
            runtime,
            presenter: createQuietPresenter(runtime),
            mode: "background",
          });
        } else if (manager) {
          // Refresh the existing stopped supervisor definition with an immutable
          // generation argument. Never install a missing Service.
          await manager.deactivate();
          await manager.install(
            buildDaemonSystemServiceCommandSpec({
              controller: manager.controller,
              accountAdmissionId: reservation.id,
            })
          );
          await manager.start();
        }
        await waitForAdmittedService(reservation.id);
      });
    } finally {
      await cancelServiceAccountAdmission(reservation.id);
    }
  });
}

async function waitForAdmittedService(id: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await readServiceAccountAdmission();
    const runtime = await readCurrentDaemonRuntimeContext();
    if (
      current?.id === id &&
      current.state === "admitted" &&
      current.carrier?.ownerPid === runtime.runtimeStatus.pid &&
      runtime.effectiveRuntimeStatus === "running"
    ) {
      return;
    }
    await delay(50);
  }
  refused(
    "startup_unconfirmed",
    "OpenMeld could not confirm that this Service started. Check Service status before trying again."
  );
}

async function stopReservedService(
  contract: Contract,
  id: string,
  pid: number
): Promise<void> {
  const manager =
    contract.serviceController === "legacy-detached"
      ? null
      : await resolveDaemonServiceManager(contract.serviceController);
  await requestAccountCheckedServiceStop({ id, manager });
  const admitted = await readServiceAccountAdmission();
  if (
    admitted?.id !== id ||
    admitted.state !== "admitted" ||
    admitted.carrier?.ownerPid !== pid
  ) {
    refused(
      "admission_unconfirmed",
      "OpenMeld could not verify that the matching Service accepted Stop. Check Service status before trying again."
    );
  }
  const current = await readCurrentDaemonRuntimeContext();
  if (current.runtimeStatus.pid !== null && current.runtimeStatus.pid !== pid) {
    refused(
      "ownership_changed",
      "Another Service instance is now running. Its state was left unchanged."
    );
  }
  await runDaemonStop(
    { json: true, view: "agent" },
    {
      completedControlledShutdownOwnerPid: pid,
    }
  );
}

export async function requestAccountCheckedServiceStop({
  id,
  manager,
}: {
  id: string;
  manager: Pick<
    DaemonServiceManager,
    "status" | "disableAutostart" | "enableAutostart"
  > | null;
}): Promise<void> {
  const wasEnabled = manager ? (await manager.status()).enabled : false;
  if (manager) {
    await manager.disableAutostart();
  }
  // No compatibility fallback: only the verified carrier may admit this stop.
  try {
    const shutdown = await requestLocalDaemonShutdown({
      payload: {
        accountAdmissionId: id,
        mode: "graceful",
        gracePeriodMs: 2000,
      },
      timeoutMs: CONTROLLED_SHUTDOWN_REQUEST_TIMEOUT_MS,
    });
    if (!shutdown.accepted) {
      throw new Error("The Service did not confirm controlled shutdown.");
    }
  } catch (error) {
    if (
      manager &&
      wasEnabled &&
      error instanceof LocalDaemonControlPlaneClientError &&
      error.code === SERVICE_ACCOUNT_STOP_REFUSED_CODE
    ) {
      try {
        await manager.enableAutostart();
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Stop was refused and its previous autostart setting could not be restored."
        );
      }
    }
    if (
      !(
        error instanceof LocalDaemonControlPlaneClientError &&
        error.code === SERVICE_ACCOUNT_STOP_REFUSED_CODE
      )
    ) {
      const detail = error instanceof Error ? error.message : String(error);
      refused(
        "stop_unconfirmed",
        `Stop may already be in progress. ${manager ? "Autostart remains disabled. " : ""}Check Service status before trying again. ${detail}`
      );
    }
    throw error;
  }
}
