import { Button } from "@openmeld/ui/components/button";
import {
  SetupTimeline,
  SetupTimelineStep,
} from "@openmeld/ui/components/setup-timeline";
import type { CliProblem, ServiceView } from "../../shared/view-types";

export type DesktopSetupProgressMode = "first_run" | "reconnect";

export function DesktopSetupProgress({
  canRetry,
  mode,
  onRetry,
  service,
  setupInProgress,
}: {
  canRetry: boolean;
  mode: DesktopSetupProgressMode;
  onRetry: () => void;
  service: ServiceView;
  setupInProgress: boolean;
}) {
  const setupProblem = setupInProgress ? null : setupProblemMessage(service);
  const copy = setupProgressCopy(mode);
  const setupSummary = setupInProgress
    ? copy.activeSummary
    : (setupProblem ?? copy.blockedSummary);

  return (
    <div className="space-y-4">
      <SetupTimeline>
        <SetupTimelineStep
          state="complete"
          summary="OpenMeld Desktop is ready to run setup from this app."
          title="Check requirements"
        />
        <SetupTimelineStep
          action={
            canRetry ? (
              <Button onClick={onRetry} size="sm" variant="outline">
                Try Again
              </Button>
            ) : null
          }
          state={setupInProgress ? "active" : "blocked"}
          summary={setupSummary}
          title={copy.actionTitle}
        />
        <SetupTimelineStep
          state="pending"
          summary="OpenMeld Service must finish setup before Spaces can wake local agents on this Mac."
          title="Ready for Spaces"
        />
      </SetupTimeline>
      {setupInProgress ? (
        <p className="text-muted-foreground text-xs">
          Keep OpenMeld Desktop open while setup runs. No terminal commands are
          needed.
        </p>
      ) : null}
    </div>
  );
}

export function shouldShowDesktopSetupProgress({
  service,
  setupInProgress,
}: {
  service: ServiceView;
  setupInProgress: boolean;
}): boolean {
  return setupInProgress || isDesktopSetupProblem(service.problem);
}

function setupProblemMessage(service: ServiceView): string | null {
  const problem = service.problem;
  return isDesktopSetupProblem(problem) ? problem.message : null;
}

function isDesktopSetupProblem(
  problem: CliProblem | null
): problem is CliProblem {
  return problem?.code === "desktop.setup_incomplete";
}

function setupProgressCopy(mode: DesktopSetupProgressMode): {
  actionTitle: string;
  activeSummary: string;
  blockedSummary: string;
} {
  if (mode === "reconnect") {
    return {
      actionTitle: "Reconnect this Mac",
      activeSummary:
        "OpenMeld Desktop is refreshing OpenMeld CLI, OpenMeld Service, and local agent connections.",
      blockedSummary:
        "Reconnect did not finish yet. Try again when you are ready.",
    };
  }
  return {
    actionTitle: "Set up this Mac",
    activeSummary:
      "OpenMeld Desktop is installing or updating OpenMeld CLI, preparing OpenMeld Service, and connecting local agents.",
    blockedSummary: "Setup did not finish yet. Try again when you are ready.",
  };
}
