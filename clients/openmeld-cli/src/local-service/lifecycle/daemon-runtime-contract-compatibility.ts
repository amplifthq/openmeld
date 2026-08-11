import type { StartDeviceProjection } from "@openmeld/schemas/types";
import type { DaemonServiceRuntimeStatus } from "../../config/daemon-state";
import { DAEMON_RUNTIME_CONTRACT_EPOCH } from "../core/constants";
import { toErrorMessage } from "../core/logger";
import type { DaemonRuntimeContractMeta } from "../core/types";
import { readDaemonRuntimeContractMeta } from "../state/runtime-contract-guard";

export type DaemonRuntimeContractCompatibilityStatus =
  | "compatible"
  | "missing"
  | "mismatch"
  | "unavailable"
  | "not_observed";

export type DaemonRuntimeContractCompatibilityReasonCode =
  | "daemon.runtime_contract.compatible"
  | "daemon.runtime_contract.missing"
  | "daemon.runtime_contract.mismatch"
  | "daemon.runtime_contract.unavailable"
  | "daemon.runtime_contract.not_observed";

export type DaemonRuntimeContractCompatibility = {
  errorMessage?: string;
  expectedEpoch: string;
  observedEpoch: string | null;
  reasonCode: DaemonRuntimeContractCompatibilityReasonCode;
  status: DaemonRuntimeContractCompatibilityStatus;
  updatedAt: string | null;
};

export type StartBackgroundHelperExecutionCompatibility = NonNullable<
  StartDeviceProjection["backgroundHelper"]["executionCompatibility"]
>;

type RuntimeStatusInput =
  | DaemonServiceRuntimeStatus["status"]
  | Pick<DaemonServiceRuntimeStatus, "status">;

export async function resolveDaemonRuntimeContractCompatibility(input: {
  expectedEpoch?: string;
  readMeta?: () => Promise<DaemonRuntimeContractMeta | null>;
  runtimeStatus: RuntimeStatusInput;
}): Promise<DaemonRuntimeContractCompatibility> {
  const expectedEpoch = input.expectedEpoch ?? DAEMON_RUNTIME_CONTRACT_EPOCH;
  const runtimeStatus =
    typeof input.runtimeStatus === "string"
      ? input.runtimeStatus
      : input.runtimeStatus.status;

  if (runtimeStatus !== "running" && runtimeStatus !== "stale") {
    return {
      status: "not_observed",
      expectedEpoch,
      observedEpoch: null,
      updatedAt: null,
      reasonCode: "daemon.runtime_contract.not_observed",
    };
  }

  const readMeta = input.readMeta ?? readDaemonRuntimeContractMeta;
  let meta: DaemonRuntimeContractMeta | null;
  try {
    meta = await readMeta();
  } catch (error) {
    return {
      status: "unavailable",
      expectedEpoch,
      observedEpoch: null,
      updatedAt: null,
      reasonCode: "daemon.runtime_contract.unavailable",
      errorMessage: toErrorMessage(error),
    };
  }

  if (!meta) {
    return {
      status: "missing",
      expectedEpoch,
      observedEpoch: null,
      updatedAt: null,
      reasonCode: "daemon.runtime_contract.missing",
    };
  }

  if (meta.contractEpoch !== expectedEpoch) {
    return {
      status: "mismatch",
      expectedEpoch,
      observedEpoch: meta.contractEpoch,
      updatedAt: meta.updatedAt,
      reasonCode: "daemon.runtime_contract.mismatch",
    };
  }

  return {
    status: "compatible",
    expectedEpoch,
    observedEpoch: meta.contractEpoch,
    updatedAt: meta.updatedAt,
    reasonCode: "daemon.runtime_contract.compatible",
  };
}

export function toStartBackgroundHelperExecutionCompatibility(
  input: DaemonRuntimeContractCompatibility
): StartBackgroundHelperExecutionCompatibility {
  return {
    status: input.status === "mismatch" ? "update_required" : "compatible",
    reasonCode: input.reasonCode,
    expectedEpoch: input.expectedEpoch,
    observedEpoch: input.observedEpoch,
    updatedAt: input.updatedAt,
  };
}
