import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  DaemonExecutionCompatibility,
  DaemonRuntimeContract,
} from "@openmeld/schemas/types";

export const resolveDaemonExecutionCompatibility = (
  runtimeContract: DaemonRuntimeContract | null | undefined
): DaemonExecutionCompatibility => {
  if (!runtimeContract) {
    return createMissingDaemonExecutionCompatibility();
  }

  if (runtimeContract.epoch !== CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH) {
    return {
      status: "update_required",
      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      observedEpoch: runtimeContract.epoch,
      reasonCode: "daemon.runtime_contract.mismatch",
    };
  }

  return {
    status: "compatible",
    expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    observedEpoch: runtimeContract.epoch,
    reasonCode: "daemon.runtime_contract.compatible",
  };
};

export const createMissingDaemonExecutionCompatibility =
  (): DaemonExecutionCompatibility => ({
    status: "update_required",
    expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    observedEpoch: null,
    reasonCode: "daemon.runtime_contract.missing",
  });

export const isDaemonExecutionCompatible = (
  compatibility: DaemonExecutionCompatibility
): boolean => compatibility.status === "compatible";
