import { spinner as createSpinner } from "@clack/prompts";
import type { DaemonServiceAlignmentProgressStep } from "../local-service/lifecycle/daemon-service-alignment-executor";

const DEFAULT_SPINNER_DELAY_MS = 250;

export type DaemonServiceAlignmentProgressUi = {
  onProgress: (step: DaemonServiceAlignmentProgressStep) => void;
  complete: (message?: string) => void;
  fail: () => void;
};

export function createDaemonServiceAlignmentProgressUi(input: {
  view: "human" | "agent";
  delayMs?: number;
  isTTY?: boolean;
}): DaemonServiceAlignmentProgressUi {
  const shouldRender =
    input.view === "human" && (input.isTTY ?? process.stdout.isTTY) === true;
  if (!shouldRender) {
    return {
      onProgress: () => undefined,
      complete: () => undefined,
      fail: () => undefined,
    };
  }

  const progressSpinner = createSpinner();
  const delayMs = input.delayMs ?? DEFAULT_SPINNER_DELAY_MS;
  let pendingTimer: NodeJS.Timeout | null = null;
  let spinnerVisible = false;
  let latestMessage = resolveAlignmentProgressMessage(
    "inspecting_local_service"
  );

  const clearPendingTimer = (): void => {
    if (!pendingTimer) {
      return;
    }
    clearTimeout(pendingTimer);
    pendingTimer = null;
  };

  const ensureSpinnerStarted = (): void => {
    if (spinnerVisible || pendingTimer) {
      return;
    }
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      spinnerVisible = true;
      progressSpinner.start(latestMessage);
    }, delayMs);
  };

  return {
    onProgress: (step) => {
      latestMessage = resolveAlignmentProgressMessage(step);
      if (spinnerVisible) {
        progressSpinner.message(latestMessage);
        return;
      }
      ensureSpinnerStarted();
    },
    complete: (message) => {
      clearPendingTimer();
      if (!spinnerVisible) {
        return;
      }
      spinnerVisible = false;
      if (message) {
        progressSpinner.stop(message);
        return;
      }
      progressSpinner.clear();
    },
    fail: () => {
      clearPendingTimer();
      if (!spinnerVisible) {
        return;
      }
      spinnerVisible = false;
      progressSpinner.clear();
    },
  };
}

function resolveAlignmentProgressMessage(
  step: DaemonServiceAlignmentProgressStep
): string {
  switch (step) {
    case "inspecting_local_service":
      return "Inspecting local OpenMeld service...";
    case "backing_up_runtime_data":
      return "Backing up OpenMeld service data...";
    case "stopping_old_service_processes":
      return "Stopping old OpenMeld service processes...";
    case "removing_system_service_registration":
      return "Removing old OpenMeld service registration...";
    case "cleaning_old_service_files":
      return "Cleaning old OpenMeld service files...";
    case "preparing_latest_service_bundle":
      return "Checking the replacement OpenMeld Service...";
    case "installing_latest_service_bundle":
      return "Updating OpenMeld Service files...";
    case "installing_system_service_registration":
      return "Registering OpenMeld background service...";
    case "restoring_runtime_data":
      return "Restoring local OpenMeld service data...";
    case "starting_background_service":
      return "Starting OpenMeld background service...";
    case "verifying_service_health":
      return "Verifying OpenMeld service health...";
    case "cleaning_stale_backups":
      return "Cleaning temporary OpenMeld service backups...";
    default:
      return "Aligning OpenMeld background service...";
  }
}
