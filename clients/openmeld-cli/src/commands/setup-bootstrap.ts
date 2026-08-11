import type {
  PrepareSetupBootstrapResult,
  PrepareSetupBootstrapStep,
} from "@openmeld/schemas/types";
import { resolveOpenMeldProfile } from "../config/openmeld-profiles-api";
import type { SelectedAgentControllerReportResult } from "../local-service/reporting/selected-agent-controller-reporting";
import { resolveSetupFollowUpCliEntryCommand } from "../runtime/cli-entry-command";
import type { SetupProgressStepHandle } from "../ui/setup-progress";

export type SetupBootstrapStep = PrepareSetupBootstrapStep;
export type SetupBootstrapResult = PrepareSetupBootstrapResult;
type SetupBootstrapLineEmitter = (input: {
  code: string;
  data?: Record<string, unknown>;
  text: string;
}) => void;

function resolveSetupBootstrapRecoveryCommand(
  failedStep: SetupBootstrapStep | "unknown"
): string {
  const cliEntry = resolveSetupFollowUpCliEntryCommand();
  return failedStep === "binding"
    ? `${cliEntry} doctor --view agent`
    : `${cliEntry} setup`;
}

export async function runSetupFirstBootstrap(input: {
  gatewayUrl: string;
  interactive?: boolean;
  line?: SetupBootstrapLineEmitter;
  progress?: SetupProgressStepHandle;
  runtimeReports?: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
}): Promise<SetupBootstrapResult> {
  try {
    return await runSetupFirstBootstrapOrThrow(input);
  } catch (error) {
    const stepError = error instanceof SetupBootstrapStepError ? error : null;
    const cause = stepError?.causeValue ?? error;
    const failedStep = stepError?.step ?? "unknown";
    const message = toErrorMessage(cause);
    console.warn("[openmeld.setup.bootstrap.failed]", {
      event: "cli.setup.bootstrap.failed",
      error: message,
      failedStep,
      selectedAgentIds: [...input.selectedLocalAgentIds],
    });
    return {
      status: "failed",
      diagnostics: {
        errorName: readErrorName(cause),
        selectedAgentIds: [...input.selectedLocalAgentIds],
      },
      failedStep,
      message,
      reason: "bootstrap_failed",
      retryCommand: resolveSetupBootstrapRecoveryCommand(failedStep),
    };
  }
}

async function runSetupFirstBootstrapOrThrow(input: {
  gatewayUrl: string;
  interactive?: boolean;
  line?: SetupBootstrapLineEmitter;
  progress?: SetupProgressStepHandle;
  runtimeReports?: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
}): Promise<Extract<SetupBootstrapResult, { status: "completed" }>> {
  emitSetupBootstrapLine(input.line, {
    code: "setup.bootstrap.stage.profile",
    text: "Preparing your OpenMeld profile...",
  });
  const humanProfile = await runBootstrapStep(
    "human_profile",
    input.progress,
    "Checking your OpenMeld profile",
    async () =>
      await resolveOpenMeldProfile({
        profileKind: "human",
      })
  );
  emitSetupBootstrapLine(input.line, {
    code: "setup.bootstrap.stage.center_agent",
    text: "Center Agent will guide your next setup steps from OpenMeld Home.",
  });

  return {
    status: "completed",
    assistantProfile: null,
    binding: null,
    bindingWarning: null,
    humanProfile: {
      openMeldProfileId: humanProfile.openMeldProfileId,
      profileKind: "human",
      profileName: humanProfile.profileName,
    },
    facts: null,
    membership: null,
    retryCommand: null,
    warnings: [],
    welcomeMessage: null,
    welcomingSpace: null,
  };
}

function emitSetupBootstrapLine(
  line: SetupBootstrapLineEmitter | undefined,
  input: Parameters<SetupBootstrapLineEmitter>[0]
): void {
  line?.(input);
}

function runBootstrapStep<T>(
  step: SetupBootstrapStep,
  progress: SetupProgressStepHandle | undefined,
  progressText: string,
  run: () => Promise<T>
): Promise<T> {
  progress?.detail({
    code: `setup.bootstrap.${step}`,
    text: progressText,
  });
  return run().catch((error: unknown) => {
    throw new SetupBootstrapStepError(step, error);
  });
}

class SetupBootstrapStepError extends Error {
  readonly causeValue: unknown;
  readonly step: SetupBootstrapStep;

  constructor(step: SetupBootstrapStep, causeValue: unknown) {
    super(`${step}: ${toErrorMessage(causeValue)}`);
    this.name = "SetupBootstrapStepError";
    this.step = step;
    this.causeValue = causeValue;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown setup bootstrap error.";
}

function readErrorName(error: unknown): string | null {
  return error instanceof Error && error.name.trim().length > 0
    ? error.name
    : null;
}
