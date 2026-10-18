import type {
  OpenMeldDaemonServiceUpdateReadinessPayload,
  OpenMeldToolsUpdateOperation,
} from "@openmeld/schemas/types";
import type { Presenter } from "../runtime/presenter";

export function createSetupUpdateObserver(presenter: Presenter) {
  let reportedProgress: string | null = null;
  return (
    operation: OpenMeldToolsUpdateOperation,
    readiness: OpenMeldDaemonServiceUpdateReadinessPayload | null
  ) => {
    const waitingForWork =
      readiness !== null && readiness.acceptedWakeCount > 0;
    const phase = waitingForWork ? "waiting_for_current_work" : "installing";
    const progressKey = `${operation.operationId}:${operation.phase}:${phase}`;
    if (reportedProgress === progressKey) {
      return;
    }
    reportedProgress = progressKey;
    presenter.line({
      code: "setup.openmeld_tools_update.waiting",
      text: waitingForWork
        ? "Current tasks are still running. Setup will continue automatically after they finish. You can stop them in their Spaces to continue sooner."
        : "OpenMeld is finishing an update already in progress. Setup will continue automatically when the update finishes.",
      data: {
        operationId: operation.operationId,
        phase,
        state: "active",
        updatePhase: operation.phase,
        targetVersion: operation.targetVersion,
      },
    });
  };
}
