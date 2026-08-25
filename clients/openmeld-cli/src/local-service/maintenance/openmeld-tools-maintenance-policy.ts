import type { OpenMeldToolsMaintenanceProjection } from "@openmeld/schemas/types";
import {
  getConfiguredOpenMeldToolsMaintenance,
  setConfiguredOpenMeldToolsMaintenance,
} from "../../config/runtime-config";

export type OpenMeldToolsMaintenancePolicy = {
  automaticUpdatesEnabled: boolean;
};

export async function readOpenMeldToolsMaintenancePolicy(): Promise<OpenMeldToolsMaintenancePolicy> {
  return await getConfiguredOpenMeldToolsMaintenance();
}

export async function writeOpenMeldToolsMaintenancePolicy(
  policy: OpenMeldToolsMaintenancePolicy
): Promise<void> {
  await setConfiguredOpenMeldToolsMaintenance(policy);
}

export async function resolveOpenMeldToolsMaintenanceProjection(): Promise<OpenMeldToolsMaintenanceProjection> {
  try {
    const policy = await readOpenMeldToolsMaintenancePolicy();
    return {
      automaticUpdatesEnabled: policy.automaticUpdatesEnabled,
      status: "ready",
    };
  } catch {
    return {
      automaticUpdatesEnabled: false,
      status: "needs_help",
    };
  }
}
