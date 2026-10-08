import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { createCoreRpcHttpError } from "../rpc/errors";
import { resolveCoreLocalComponentsReleaseManifest } from "./update-projection";

declare const OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON:
  | string
  | undefined;

const PRE_PERMISSION_MODE_EXECUTION_EPOCH =
  "runtime-transport-epoch-2026-09-image-geometry";
const PRE_PROJECT_WORK_EXECUTION_EPOCH =
  "runtime-transport-epoch-2026-09-space-files-1gib";

// The guarded receiver-first deployment already supplies the immutable
// published manifest. Use that same authority for protocol admission and
// writers; changing the update banner alone cannot make a rollout safe.
export function resolveCoreRuntimeContractRollout(): {
  expectedEpoch: string;
  acceptsPreviousEpoch: boolean;
  permissionWritesEnabled: boolean;
} {
  if (typeof OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON === "undefined") {
    return {
      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      acceptsPreviousEpoch: false,
      permissionWritesEnabled: true,
    };
  }
  const publishedEpoch =
    resolveCoreLocalComponentsReleaseManifest()?.components.service
      .runtimeContractEpoch;
  const acceptsPreviousEpoch =
    publishedEpoch === PRE_PERMISSION_MODE_EXECUTION_EPOCH ||
    publishedEpoch === PRE_PROJECT_WORK_EXECUTION_EPOCH;
  return {
    expectedEpoch: acceptsPreviousEpoch
      ? publishedEpoch
      : CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    acceptsPreviousEpoch,
    permissionWritesEnabled:
      publishedEpoch === CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH ||
      publishedEpoch === PRE_PROJECT_WORK_EXECUTION_EPOCH,
  };
}

export function assertAgentControllerPermissionModeReleased(
  mode: string | null | undefined
): void {
  if (
    mode?.startsWith("antigravity:") &&
    !resolveCoreRuntimeContractRollout().permissionWritesEnabled
  ) {
    throw createCoreRpcHttpError({
      code: "agent_controller_permission_mode_unavailable",
      reason:
        "Antigravity permission settings are not available yet. Try again after the OpenMeld update is released.",
      status: 409,
    });
  }
}
