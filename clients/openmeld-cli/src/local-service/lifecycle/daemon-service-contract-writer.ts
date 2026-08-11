import type { DaemonServiceContract } from "@openmeld/schemas/types";
import {
  type DaemonServiceContractStateInput,
  upsertDaemonServiceContract,
} from "../../config/daemon-service-contract";
import { normalizeHeartbeatIntervalMs } from "../core/logger";
import { emitDaemonLifecycleEvent } from "./daemon-lifecycle-journal";

export type DaemonServiceContractMissingField =
  | "daemonVersion"
  | "bundleId"
  | "deviceId"
  | "gatewayUrl"
  | "serviceController";

export type DaemonServiceContractWriteResult =
  | {
      contract: DaemonServiceContract;
      status: "written";
    }
  | {
      missingFields: DaemonServiceContractMissingField[];
      status: "skipped_missing_fields";
    };

export async function writeDaemonServiceContract(input: {
  autoStart: boolean;
  bundleId?: string | null;
  daemonVersion?: string | null;
  desiredState: DaemonServiceContractStateInput["desiredState"];
  deviceId?: string | null;
  connectedComputerId?: string | null;
  gatewayUrl?: string | null;
  heartbeatMs?: number | null;
  lane?: DaemonServiceContractStateInput["lane"];
  ownerUserId?: string | null;
  profileId?: string | null;
  serviceController?:
    | DaemonServiceContractStateInput["serviceController"]
    | null;
}): Promise<DaemonServiceContractWriteResult> {
  const missingFields = resolveMissingContractFields(input);
  if (missingFields.length > 0) {
    await emitDaemonLifecycleEvent({
      type: "service_contract.write",
      result: "skipped",
      metadata: {
        autoStart: input.autoStart,
        desiredState: input.desiredState,
        missingFields,
        reason: "missing_required_contract_fields",
      },
    });
    return {
      status: "skipped_missing_fields",
      missingFields,
    };
  }
  const completeInput = requireCompleteContractInput(input);

  const contract = await upsertDaemonServiceContract(completeInput);
  await emitDaemonLifecycleEvent({
    type: "service_contract.write",
    result: "completed",
    metadata: {
      autoStart: input.autoStart,
      desiredState: input.desiredState,
      deviceId: contract.deviceId,
      ...(contract.ownerUserId ? { ownerUserId: contract.ownerUserId } : {}),
      ...(contract.profileId ? { profileId: contract.profileId } : {}),
      serviceController: contract.serviceController,
    },
  });
  return {
    status: "written",
    contract,
  };
}

function requireCompleteContractInput(input: {
  autoStart: boolean;
  bundleId?: string | null;
  daemonVersion?: string | null;
  desiredState: DaemonServiceContractStateInput["desiredState"];
  deviceId?: string | null;
  connectedComputerId?: string | null;
  gatewayUrl?: string | null;
  heartbeatMs?: number | null;
  lane?: DaemonServiceContractStateInput["lane"];
  ownerUserId?: string | null;
  profileId?: string | null;
  serviceController?:
    | DaemonServiceContractStateInput["serviceController"]
    | null;
}): DaemonServiceContractStateInput {
  if (
    !(
      input.daemonVersion &&
      input.bundleId &&
      input.serviceController &&
      input.gatewayUrl &&
      input.deviceId
    )
  ) {
    throw new Error(
      "OpenMeld Service contract writer received incomplete input."
    );
  }
  return {
    daemonVersion: input.daemonVersion,
    bundleId: input.bundleId,
    desiredState: input.desiredState,
    serviceController: input.serviceController,
    autoStart: input.autoStart,
    gatewayUrl: input.gatewayUrl,
    ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    ...(input.profileId ? { profileId: input.profileId } : {}),
    deviceId: input.deviceId,
    ...(input.connectedComputerId
      ? { connectedComputerId: input.connectedComputerId }
      : {}),
    heartbeatMs: normalizeHeartbeatIntervalMs(input.heartbeatMs ?? undefined),
    ...(input.lane ? { lane: input.lane } : {}),
  };
}

function resolveMissingContractFields(input: {
  bundleId?: string | null;
  daemonVersion?: string | null;
  deviceId?: string | null;
  gatewayUrl?: string | null;
  profileId?: string | null;
  serviceController?:
    | DaemonServiceContractStateInput["serviceController"]
    | null;
}): DaemonServiceContractMissingField[] {
  const missingFields: DaemonServiceContractMissingField[] = [];
  if (!input.daemonVersion) {
    missingFields.push("daemonVersion");
  }
  if (!input.bundleId) {
    missingFields.push("bundleId");
  }
  if (!input.serviceController) {
    missingFields.push("serviceController");
  }
  if (!input.gatewayUrl) {
    missingFields.push("gatewayUrl");
  }
  if (!input.deviceId) {
    missingFields.push("deviceId");
  }
  return missingFields;
}
