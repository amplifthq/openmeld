import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type { LocalComponentsReleaseManifest } from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";

const PRE_PERMISSION_MODE_EXECUTION_EPOCH =
  "runtime-transport-epoch-2026-09-image-geometry";
const PRE_PROJECT_WORK_EXECUTION_EPOCH =
  "runtime-transport-epoch-2026-09-space-files-1gib";

// Protocol admission and writers follow the published Service epoch, not the
// epoch this Core build was compiled with. A Core released before its Service
// keeps accepting the previous epoch until the Service is published. Without a
// readable published manifest nothing new is enabled.
export function resolveCoreRuntimeContractRollout(
  manifest: LocalComponentsReleaseManifest | null
): {
  expectedEpoch: string;
  acceptsPreviousEpoch: boolean;
  permissionWritesEnabled: boolean;
} {
  const publishedEpoch = manifest?.components.service.runtimeContractEpoch;
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
  mode: string | null | undefined,
  manifest: LocalComponentsReleaseManifest | null
): void {
  if (
    mode?.startsWith("antigravity:") &&
    !resolveCoreRuntimeContractRollout(manifest).permissionWritesEnabled
  ) {
    throw createCoreRpcHttpError({
      code: "agent_controller_permission_mode_unavailable",
      reason:
        "Antigravity permission settings are not available yet. Try again after the OpenMeld update is released.",
      status: 409,
    });
  }
}
