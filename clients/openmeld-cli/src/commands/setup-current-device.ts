import { createCurrentDeviceApi } from "@openmeld/api-client";
import { readServiceAdmissionSessionWithOwnership } from "../config/auth-session";
import { withAuthSessionTransitionMutationLock } from "../config/auth-session-transition-lock";
import { normalizeGatewayBaseUrlOrNull } from "../config/base-url";
import {
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../config/daemon-service-contract";
import { withDaemonServiceLifecycleLock } from "../config/daemon-state";
import { buildRequestAuthHeaders } from "../config/request-headers";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { collectObservedDeviceMetadata } from "../system/observed-device-metadata";

export async function syncLocalSetupCurrentDeviceTargetFromServiceContract(input: {
  connectedComputerId?: string;
  gatewayUrl: string;
}): Promise<{ deviceId: string; runtimeLane: string }> {
  const serviceContract = await readDaemonServiceContract();
  const deviceId = serviceContract?.deviceId ?? null;
  const runtimeLane = serviceContract?.lane ?? null;
  const expectedOwnerUserId = serviceContract?.ownerUserId;
  if (!(serviceContract && deviceId && runtimeLane && expectedOwnerUserId)) {
    throw new Error(
      `OpenMeld could not reconnect this computer because OpenMeld Service has not finished starting. Keep OpenMeld Service running, then run \`${formatOpenMeldCliCommand(
        "openmeld setup --view agent"
      )}\` again. You can also run \`${formatOpenMeldCliCommand(
        "openmeld service status --view agent"
      )}\` to inspect the local service.`
    );
  }

  if (
    normalizeGatewayBaseUrlOrNull(input.gatewayUrl) !==
    normalizeGatewayBaseUrlOrNull(serviceContract.gatewayUrl)
  ) {
    throw new Error(
      "This Computer connection no longer matches OpenMeld Service. Run setup again."
    );
  }
  const currentDeviceApi = createCurrentDeviceApi(
    createCliApiClientFoundation(input.gatewayUrl, { expectedOwnerUserId })
  );

  const enrollment = await currentDeviceApi.enrollLocalRuntime({
    ...(input.connectedComputerId
      ? { connectedComputerId: input.connectedComputerId }
      : {}),
    deviceId,
    runtimeLane,
  });
  await withDaemonServiceLifecycleLock(
    { intent: "upgrade_reconcile", command: "openmeld setup" },
    async () =>
      await withAuthSessionTransitionMutationLock(async () => {
        await buildRequestAuthHeaders({
          authSession: await readServiceAdmissionSessionWithOwnership(),
          expectedOwnerUserId,
          requestUrl: input.gatewayUrl,
        });
        await writeConnectedComputerEnrollmentToServiceContract({
          connectedComputerId: enrollment.connectedComputerId,
          serviceContract,
        });
      })
  );

  // Enrollment and its local identity must succeed. Display-only observations
  // cannot undo that identity or establish Service/Agent readiness.
  try {
    const metadata = await collectObservedDeviceMetadata();
    await currentDeviceApi.writeObservedMetadata({ deviceId, metadata });
  } catch (error) {
    console.warn("[openmeld.setup.device_details_unavailable]", {
      deviceId,
      runtimeLane,
      event: "cli.setup.device_details_unavailable",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return {
    deviceId,
    runtimeLane,
  };
}

async function writeConnectedComputerEnrollmentToServiceContract(input: {
  connectedComputerId: string | undefined;
  serviceContract: NonNullable<
    Awaited<ReturnType<typeof readDaemonServiceContract>>
  >;
}): Promise<void> {
  if (!input.connectedComputerId) {
    return;
  }
  await upsertDaemonServiceContract(
    {
      autoStart: input.serviceContract.autoStart,
      bundleId: input.serviceContract.bundleId,
      connectedComputerId: input.connectedComputerId,
      daemonVersion: input.serviceContract.daemonVersion,
      desiredState: input.serviceContract.desiredState,
      deviceId: input.serviceContract.deviceId,
      gatewayUrl: input.serviceContract.gatewayUrl,
      heartbeatMs: input.serviceContract.heartbeatMs,
      lane: input.serviceContract.lane,
      ...(input.serviceContract.ownerUserId
        ? { ownerUserId: input.serviceContract.ownerUserId }
        : {}),
      ...(input.serviceContract.profileId
        ? { profileId: input.serviceContract.profileId }
        : {}),
      serviceController: input.serviceContract.serviceController,
    },
    {},
    { expectedCurrentContract: input.serviceContract }
  );
}
