import { runDaemonBackgroundStartForDecision } from "../commands/service";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import { runDaemonStartupPreflight } from "../local-service/lifecycle/daemon-startup-preflight";
import {
  type DaemonServiceParticipationStatus,
  resolveDaemonServiceParticipationStatus,
} from "../local-service/status/service-participation-status";
import { createDaemonServiceAlignmentProgressUi } from "../system/local-service-alignment-progress-ui";
import { runDaemonStartDecisionPrompt } from "../system/local-service-start-decision";
import { resolveServiceReadinessFromServiceStatus } from "../system/service-readiness-resolver";
import { buildAgentCheckResult } from "./build-agent-check-result";
import { showHumanCheckCard } from "./show-human-check-card";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
  CommandEntryResult,
} from "./types";

type ServiceStatus =
  | Extract<DaemonServiceParticipationStatus, { kind: "ready" }>
  | Extract<DaemonServiceParticipationStatus, { kind: "missing" }>
  | Extract<DaemonServiceParticipationStatus, { kind: "outdated" }>
  | Extract<DaemonServiceParticipationStatus, { kind: "not_running" }>
  | Extract<DaemonServiceParticipationStatus, { kind: "needs_repair" }>
  | {
      kind: "inspection_failed";
      detail: string;
    }
  | {
      kind: "repair_blocked";
      detail: string;
    }
  | {
      kind: "repair_failed";
      detail: string;
    };

export async function runServiceCheck(input: {
  context: CommandEntryContext;
  requirement: CommandCheckRequirement;
}): Promise<CommandEntryResult> {
  if (input.requirement.mode === "skip") {
    return {
      status: "continue",
    };
  }
  if (input.context.entryName === "service.run") {
    return {
      status: "continue",
    };
  }

  const serviceStatus = await resolveServiceStatus({
    view: input.context.runtime.resolvedView,
  });
  if (
    serviceStatus.kind === "ready" &&
    (serviceStatus.advisoryAnomalyCodes?.length ?? 0) === 0
  ) {
    return {
      status: "continue",
    };
  }

  if (shouldPromptHumanOptionalServiceStart(input, serviceStatus)) {
    emitServiceStatus({
      context: input.context,
      serviceStatus,
      blocking: false,
    });
    await maybePromptHumanOptionalServiceStart({
      context: input.context,
    });
    return {
      status: "continue",
    };
  }

  emitServiceStatus({
    context: input.context,
    serviceStatus,
    blocking: false,
  });
  return {
    status: "continue",
  };
}

function shouldPromptHumanOptionalServiceStart(
  input: {
    context: CommandEntryContext;
    requirement: CommandCheckRequirement;
  },
  serviceStatus: ServiceStatus
): boolean {
  return (
    input.context.runtime.resolvedView === "human" &&
    input.context.allowPrompt &&
    input.requirement.mode === "optional" &&
    serviceStatus.kind === "not_running"
  );
}

async function maybePromptHumanOptionalServiceStart(input: {
  context: CommandEntryContext;
}): Promise<void> {
  const expectedVersion = await resolveCurrentDaemonExpectedVersion();
  const preflight = await runDaemonStartupPreflight({
    expectedVersion,
    progress: createDaemonServiceAlignmentProgressUi({
      view: "human",
    }),
    view: "human",
  });
  if (preflight.status === "blocked" || preflight.status === "failed") {
    return;
  }

  await runDaemonStartDecisionPrompt({
    startService: async () =>
      await runDaemonBackgroundStartForDecision({
        ...(input.context.gatewayUrl
          ? { gatewayUrl: input.context.gatewayUrl }
          : {}),
        view: "human",
      }),
  });
}

async function resolveServiceStatus(input: {
  view: "human" | "agent";
}): Promise<ServiceStatus> {
  const expectedVersion = await resolveCurrentDaemonExpectedVersion();
  try {
    return await resolveDaemonServiceParticipationStatus({
      expectedVersion,
    });
  } catch (error) {
    warnServiceCheckIssue("resolveDaemonServiceParticipationStatus failed", {
      error,
      expectedVersion,
      view: input.view,
    });
    return {
      kind: "inspection_failed",
      detail:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "OpenMeld could not inspect OpenMeld Service on this device.",
    };
  }
}

function warnServiceCheckIssue(
  message: string,
  details: Record<string, unknown>
): void {
  console.warn("[openmeld.command_entry.service_check.warning]", {
    message,
    ...details,
  });
}

function emitServiceStatus(input: {
  context: CommandEntryContext;
  serviceStatus: ServiceStatus;
  blocking: boolean;
}): void {
  const serviceReadiness = resolveServiceReadinessFromServiceStatus(
    input.serviceStatus
  );
  if (input.context.runtime.resolvedView === "human") {
    showHumanCheckCard({
      presenter: input.context.presenter,
      codePrefix: "command.entry.service.status.card",
      title: "OpenMeld Service",
      status: serviceReadiness.detailText,
      why: "OpenMeld Service connects this computer for local Wake work.",
      next:
        serviceReadiness.nextStepSummary ?? "Run `openmeld service status`.",
    });
    return;
  }

  input.context.presenter.data({
    code: "command.entry.service.status",
    payload: buildAgentCheckResult({
      code: "service.recommended",
      status: input.blocking ? "blocked" : "needs_attention",
      reason: serviceReadiness.detailText,
      nextSteps: serviceReadiness.nextSteps,
      humanActionRequired: false,
      canContinueAfterFix: true,
      details: buildServiceStatusAgentDetails({
        serviceReadiness,
        serviceStatus: input.serviceStatus,
      }),
    }),
  });
}

function buildServiceStatusAgentDetails(input: {
  serviceReadiness: ReturnType<typeof resolveServiceReadinessFromServiceStatus>;
  serviceStatus: ServiceStatus;
}): Record<string, unknown> {
  const details: Record<string, unknown> = {
    runtimeHeadline: input.serviceReadiness.runtimeHeadline,
    serviceReadinessState: input.serviceReadiness.state,
    serviceStatusKind: input.serviceStatus.kind,
  };
  if ("detail" in input.serviceStatus) {
    details.diagnosticDetail = input.serviceStatus.detail;
  }
  if ("expectedVersion" in input.serviceStatus) {
    details.expectedVersion = input.serviceStatus.expectedVersion;
  }
  if ("installedVersion" in input.serviceStatus) {
    details.installedVersion = input.serviceStatus.installedVersion;
  }
  if ("runtimeStatus" in input.serviceStatus) {
    details.runtimeStatus = input.serviceStatus.runtimeStatus;
  }
  if (
    "advisoryAnomalyCodes" in input.serviceStatus &&
    input.serviceStatus.advisoryAnomalyCodes &&
    input.serviceStatus.advisoryAnomalyCodes.length > 0
  ) {
    details.advisoryAnomalyCodes = input.serviceStatus.advisoryAnomalyCodes;
  }
  if (input.serviceReadiness.anomalyCodes.length > 0) {
    details.anomalyCodes = input.serviceReadiness.anomalyCodes;
  }
  if (input.serviceReadiness.reasonCodes.length > 0) {
    details.reasonCodes = input.serviceReadiness.reasonCodes;
  }
  return details;
}
