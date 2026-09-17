import type {
  ComputerConnectionProgressObservation,
  ComputerConnectionProgressPhase,
} from "@openmeld/schemas";

export type ComputerConnectionProgressPresentation = {
  description: string;
  determinate: boolean;
  percentage: number | null;
  stage: string;
};

const PHASE_COPY: Record<
  ComputerConnectionProgressPhase,
  Pick<ComputerConnectionProgressPresentation, "description" | "stage">
> = {
  checking: {
    stage: "Checking this Mac",
    description: "Reviewing the current connection and OpenMeld Tools.",
  },
  downloading: {
    stage: "Downloading OpenMeld Tools",
    description: "Downloading the verified tools for this Mac.",
  },
  verifying: {
    stage: "Verifying OpenMeld Tools",
    description: "Checking the downloaded tools before installation.",
  },
  installing: {
    stage: "Installing OpenMeld Tools",
    description: "Installing the verified tools for this Mac.",
  },
  waiting_for_confirmation: {
    stage: "Waiting for confirmation",
    description: "Confirm the account switch to continue.",
  },
  switching_account: {
    stage: "Safely switching accounts",
    description: "Moving this Mac to the signed-in account.",
  },
  waiting_for_current_work: {
    stage: "Waiting for current work",
    description:
      "OpenMeld is waiting for accepted local work to finish safely.",
  },
  connecting_service: {
    stage: "Connecting OpenMeld Service",
    description: "Starting the local service for the signed-in account.",
  },
  confirming: {
    stage: "Confirming the connection",
    description: "Checking that this Mac is ready for the signed-in account.",
  },
  connected: {
    stage: "Connected",
    description: "This Mac is connected to the signed-in account.",
  },
  restoring: {
    stage: "Restoring the previous connection",
    description:
      "The account switch did not finish. Restoring the earlier connection.",
  },
  needs_attention: {
    stage: "Connection needs attention",
    description: "Review the connection details and try again.",
  },
};

export function presentComputerConnectionProgress(
  progress: ComputerConnectionProgressObservation
): ComputerConnectionProgressPresentation {
  const copy = PHASE_COPY[progress.phase];
  const measurement = progress.measurement;
  if (!measurement) {
    return { ...copy, determinate: false, percentage: null };
  }
  return {
    ...copy,
    determinate: true,
    percentage: Math.min(
      100,
      Math.max(0, Math.round((measurement.value / measurement.total) * 100))
    ),
  };
}

export function isNewerComputerConnectionProgress(
  current: ComputerConnectionProgressObservation | null,
  candidate: ComputerConnectionProgressObservation
): boolean {
  return (
    current === null ||
    (current.operationId === candidate.operationId &&
    current.attemptId === candidate.attemptId
      ? candidate.sequence > current.sequence
      : Date.parse(candidate.observedAt) > Date.parse(current.observedAt))
  );
}

export function formatComputerConnectionElapsed(
  startedAt: string,
  nowMs: number
): string | null {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - Date.parse(startedAt)) / 1000)
  );
  if (elapsedSeconds < 5) {
    return null;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}
