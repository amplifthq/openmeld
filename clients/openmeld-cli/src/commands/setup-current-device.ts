import { createCurrentDeviceApi } from "@openmeld/api-client";
import {
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../config/daemon-service-contract";
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
  if (!(serviceContract && deviceId && runtimeLane)) {
    throw new Error(
      `OpenMeld could not reconnect this computer because OpenMeld Service has not finished starting. Keep OpenMeld Service running, then run \`${formatOpenMeldCliCommand(
        "openmeld setup --view agent"
      )}\` again. You can also run \`${formatOpenMeldCliCommand(
        "openmeld service status --view agent"
      )}\` to inspect the local service.`
    );
  }

  const currentDeviceApi = createCurrentDeviceApi(
    createCliApiClientFoundation(input.gatewayUrl)
  );

  const enrollment = await currentDeviceApi.enrollLocalRuntime({
    ...(input.connectedComputerId
      ? { connectedComputerId: input.connectedComputerId }
      : {}),
    deviceId,
    runtimeLane,
  });
  await writeConnectedComputerEnrollmentToServiceContract({
    connectedComputerId: enrollment.connectedComputerId,
    serviceContract,
  });

  await currentDeviceApi.writeObservedMetadata({
    deviceId,
    metadata: await collectObservedDeviceMetadata(),
  });

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
  await upsertDaemonServiceContract({
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
  });
}
