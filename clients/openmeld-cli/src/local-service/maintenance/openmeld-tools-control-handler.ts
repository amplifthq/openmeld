import type {
  OpenMeldToolsControlRequest,
  OpenMeldToolsControlResult,
} from "@openmeld/schemas/types";
import {
  readOpenMeldToolsMaintenancePolicy,
  writeOpenMeldToolsMaintenancePolicy,
} from "./openmeld-tools-maintenance-policy";
import type { OpenMeldToolsUpdateCoordinator } from "./openmeld-tools-update-coordinator";

export async function handleOpenMeldToolsControlRequest(input: {
  coordinator?: OpenMeldToolsUpdateCoordinator;
  request: OpenMeldToolsControlRequest;
}): Promise<OpenMeldToolsControlResult> {
  if (input.request.operation === "request_update") {
    return {
      operation: "request_update",
      result: input.coordinator
        ? await input.coordinator.requestUpdate({
            requestSource: input.request.requestSource,
          })
        : { status: "unavailable" },
    };
  }

  const current = await readOpenMeldToolsMaintenancePolicy();
  if (
    current.automaticUpdatesEnabled === input.request.automaticUpdatesEnabled
  ) {
    return {
      operation: "set_automatic_updates",
      result: {
        automaticUpdatesEnabled: current.automaticUpdatesEnabled,
        status: "unchanged",
      },
    };
  }
  await writeOpenMeldToolsMaintenancePolicy({
    automaticUpdatesEnabled: input.request.automaticUpdatesEnabled,
  });
  return {
    operation: "set_automatic_updates",
    result: {
      automaticUpdatesEnabled: input.request.automaticUpdatesEnabled,
      status: "updated",
    },
  };
}
