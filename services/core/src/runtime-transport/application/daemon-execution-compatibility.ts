import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  DaemonExecutionCompatibility,
  DaemonRuntimeContract,
  LocalComponentsReleaseManifest,
} from "@openmeld/schemas/types";
import { resolveCoreRuntimeContractRollout } from "../../local-components/runtime-contract-rollout";

export const resolveDaemonExecutionCompatibility = (
  runtimeContract: DaemonRuntimeContract | null | undefined,
  localComponentsManifest: LocalComponentsReleaseManifest | null
): DaemonExecutionCompatibility => {
  if (!runtimeContract) {
    return createMissingDaemonExecutionCompatibility(localComponentsManifest);
  }

  const rollout = resolveCoreRuntimeContractRollout(localComponentsManifest);
  if (
    runtimeContract.epoch !== CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH &&
    !(
      rollout.acceptsPreviousEpoch &&
      runtimeContract.epoch === rollout.expectedEpoch
    )
  ) {
    return {
      status: "update_required",
      expectedEpoch: rollout.expectedEpoch,
      observedEpoch: runtimeContract.epoch,
      reasonCode: "daemon.runtime_contract.mismatch",
    };
  }

  return {
    status: "compatible",
    expectedEpoch: rollout.expectedEpoch,
    observedEpoch: runtimeContract.epoch,
    reasonCode: "daemon.runtime_contract.compatible",
  };
};

export const createMissingDaemonExecutionCompatibility = (
  localComponentsManifest: LocalComponentsReleaseManifest | null
): DaemonExecutionCompatibility => ({
  status: "update_required",
  expectedEpoch: resolveCoreRuntimeContractRollout(localComponentsManifest)
    .expectedEpoch,
  observedEpoch: null,
  reasonCode: "daemon.runtime_contract.missing",
});

export const isDaemonExecutionCompatible = (
  compatibility: DaemonExecutionCompatibility
): boolean => compatibility.status === "compatible";
