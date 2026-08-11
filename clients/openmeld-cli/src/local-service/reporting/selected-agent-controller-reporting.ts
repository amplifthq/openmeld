import { buildAgentControllerRef } from "@openmeld/agent-runtime";
import { formatOpenMeldCliCommand } from "../../runtime/cli-entry-command";
import type { StartReadinessSnapshot } from "../../start-local/readiness-types";
import type { LocalParticipationState } from "../../system/action-participation-planner";
import {
  collectLocalAgentControllerInventory,
  type LocalAgentControllerInventoryItem,
  resolveLocalAgentControllerBlockerReasonCodes,
  resolveLocalAgentControllerLaunchability,
  resolveLocalAgentControllerReportDecision,
} from "../inventory/agent-controller-inventory";
import {
  type RuntimeAgentControllerReportSubmission,
  submitRuntimeAgentControllerReports,
} from "./runtime-agent-controller-reporting-submission";

export type SelectedAgentControllerReportResult = {
  agentId: string;
  agentControllerRef: string;
  agentControllerInterface?: LocalAgentControllerInventoryItem["agentControllerInterface"];
  localParticipationState: LocalParticipationState;
  reasonCodes: readonly string[];
  runtimeReportSubmission: RuntimeAgentControllerReportSubmission;
};

export type SelectedAgentControllerReadinessDecision = {
  agentId: string;
  agentControllerRef: string;
  agentControllerInterface?: LocalAgentControllerInventoryItem["agentControllerInterface"];
  localParticipationState: LocalParticipationState;
  reasonCodes: readonly string[];
};

export function resolveSelectedAgentControllerReadiness(input: {
  controllerInventory?: readonly LocalAgentControllerInventoryItem[];
  localAgentIds: readonly string[];
  readiness: StartReadinessSnapshot;
}): SelectedAgentControllerReadinessDecision[] {
  const uniqueAgentIds = [...new Set(input.localAgentIds.map(normalizeId))]
    .filter(Boolean)
    .sort();
  const decisions: SelectedAgentControllerReadinessDecision[] = [];

  for (const agentId of uniqueAgentIds) {
    const agentControllerRef = buildAgentControllerRef({
      kind: "builtin",
      id: agentId,
    });
    const candidate =
      input.readiness.agents.candidates.find(
        (currentCandidate) => currentCandidate.agentId === agentId
      ) ?? null;
    const inventoryItem =
      input.controllerInventory?.find(
        (currentCapability) => currentCapability.agentId === agentId
      ) ?? null;
    const readinessDecision = resolveSelectedAgentControllerParticipation({
      candidate,
      inventoryItem,
      readiness: input.readiness,
    });
    decisions.push({
      ...(inventoryItem?.agentControllerInterface
        ? { agentControllerInterface: inventoryItem.agentControllerInterface }
        : {}),
      agentId,
      agentControllerRef,
      localParticipationState: readinessDecision.localParticipationState,
      reasonCodes: readinessDecision.reasonCodes,
    });
  }

  return decisions;
}

export async function submitSelectedAgentControllerReports(input: {
  localAgentIds: readonly string[];
  readiness: StartReadinessSnapshot;
}): Promise<SelectedAgentControllerReportResult[]> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT runtime-agent-controller-report
  // This is the highlighted local execution target handoff from CLI/Service
  // evidence into Core. Phase 2 should make this an explicit inventory fact,
  // not a side effect of Prepare wording.
  const controllerInventory = (
    await collectLocalAgentControllerInventory({
      includeControllerInterface: true,
    })
  ).capabilities;
  const decisions = resolveSelectedAgentControllerReadiness({
    ...input,
    controllerInventory,
  });
  const submissions = await submitRuntimeAgentControllerReports({
    reports: decisions.map((decision) => ({
      agentControllerRef: decision.agentControllerRef,
      ...(decision.agentControllerInterface
        ? { agentControllerInterface: decision.agentControllerInterface }
        : {}),
      localParticipationState: decision.localParticipationState,
      reasonCodes: decision.reasonCodes,
    })),
  });

  return decisions.map((decision, index) => {
    const runtimeReportSubmission = submissions[index];
    if (!runtimeReportSubmission) {
      throw new Error(
        `OpenMeld Agent Controller reporting did not return a submission result for ${decision.agentId}.`
      );
    }
    return {
      ...decision,
      runtimeReportSubmission,
    };
  });
}

export function assertSelectedAgentControllerReportsAccepted(
  results: readonly SelectedAgentControllerReportResult[]
): void {
  const failed = results.find(
    (result) =>
      result.localParticipationState !== "ready" ||
      !isSelectedAgentControllerReportSubmissionAccepted(result)
  );
  if (!failed) {
    return;
  }

  const reasonCode =
    failed.reasonCodes[0] ??
    failed.runtimeReportSubmission.reasonCodes[0] ??
    failed.runtimeReportSubmission.reason ??
    "runtime.reporting.unavailable";
  throw new Error(
    formatSelectedAgentControllerReportFailure(failed.agentId, reasonCode)
  );
}

export function assertSelectedAgentControllerReportSubmissionsAccepted(
  results: readonly SelectedAgentControllerReportResult[]
): void {
  const failedSubmission = results.find(
    (result) => !isSelectedAgentControllerReportSubmissionAccepted(result)
  );
  if (failedSubmission) {
    const reasonCode =
      failedSubmission.runtimeReportSubmission.reasonCodes[0] ??
      failedSubmission.runtimeReportSubmission.reason ??
      failedSubmission.reasonCodes[0] ??
      "runtime.reporting.unavailable";
    throw new Error(
      formatSelectedAgentControllerReportFailure(
        failedSubmission.agentId,
        reasonCode
      )
    );
  }

  const setupWideFailure = results.find((result) =>
    result.reasonCodes.some((reasonCode) => reasonCode.startsWith("service."))
  );
  if (!setupWideFailure) {
    return;
  }
  const reasonCode =
    setupWideFailure.reasonCodes.find((currentReasonCode) =>
      currentReasonCode.startsWith("service.")
    ) ?? "runtime.reporting.unavailable";
  throw new Error(
    formatSelectedAgentControllerReportFailure(
      setupWideFailure.agentId,
      reasonCode
    )
  );
}

function isSelectedAgentControllerReportSubmissionAccepted(
  result: SelectedAgentControllerReportResult
): boolean {
  return (
    result.runtimeReportSubmission.status === "submitted" &&
    result.runtimeReportSubmission.agentControllerReportStatus === "accepted" &&
    Boolean(result.runtimeReportSubmission.openMeldServiceRuntimeId)
  );
}

export function assertSelectedAgentControllerReadinessReady(
  decisions: readonly SelectedAgentControllerReadinessDecision[]
): void {
  const failed = decisions.find(
    (decision) => decision.localParticipationState !== "ready"
  );
  if (!failed) {
    return;
  }
  throw new Error(
    formatSelectedAgentControllerReportFailure(
      failed.agentId,
      failed.reasonCodes[0] ?? "runtime.reporting.unavailable"
    )
  );
}

function formatSelectedAgentControllerReportFailure(
  agentId: string,
  reasonCode: string
): string {
  if (reasonCode === "service.not_running") {
    const statusCommand = formatOpenMeldCliCommand("openmeld service status");
    const runCommand = formatOpenMeldCliCommand("openmeld service start");
    return `OpenMeld could not connect selected agents to OpenMeld for ${agentId} because OpenMeld Service is not running. Run \`${statusCommand}\` to inspect it, then \`${runCommand}\` to start it and retry this Web setup command.`;
  }

  if (reasonCode === "service.not_installed") {
    const installCommand = formatOpenMeldCliCommand("openmeld service install");
    const runCommand = formatOpenMeldCliCommand("openmeld service start");
    return `OpenMeld could not connect selected agents to OpenMeld for ${agentId} because OpenMeld Service is not installed. Run \`${installCommand}\`, then \`${runCommand}\`, and retry this Web setup command.`;
  }

  if (reasonCode === "runtime.registration.device_forgotten") {
    return `OpenMeld could not reconnect this computer for ${agentId} because this computer was previously removed from your OpenMeld account. Support code: ${reasonCode}.`;
  }

  if (reasonCode === "controller.launch.choice_required") {
    return `OpenMeld found more than one ${agentId} install on this computer. Run \`${formatOpenMeldCliCommand(
      `openmeld agents enable --agent ${agentId}`
    )}\` in an interactive Terminal and choose one install. If this Terminal cannot prompt, run \`${formatOpenMeldCliCommand(
      `openmeld agents enable --agent ${agentId} --install <install-id>`
    )}\` with one of the install IDs shown by that enable command, then return to OpenMeld Web setup.`;
  }

  if (reasonCode === "controller.launch.needs_repair") {
    return `OpenMeld could not start ${agentId} on this computer. Run \`${formatOpenMeldCliCommand(
      `openmeld agents repair --agent ${agentId}`
    )}\`, then return to OpenMeld Web setup.`;
  }

  if (
    reasonCode === "provider_account.access_required" ||
    reasonCode === "controller.auth.unauthenticated"
  ) {
    return `OpenMeld could not connect selected agents to OpenMeld for ${agentId} because this local controller is not signed in on this computer. Sign in to ${agentId}, then retry this Web setup command. Support code: ${reasonCode}.`;
  }

  return `OpenMeld could not connect selected agents to OpenMeld for ${agentId}. Support code: ${reasonCode}.`;
}

function resolveSelectedAgentControllerParticipation(input: {
  candidate: StartReadinessSnapshot["agents"]["candidates"][number] | null;
  inventoryItem: LocalAgentControllerInventoryItem | null;
  readiness: StartReadinessSnapshot;
}): {
  localParticipationState: LocalParticipationState;
  reasonCodes: readonly string[];
} {
  if (!input.candidate) {
    return {
      localParticipationState: "needs_agent_prepare",
      reasonCodes: ["local_agent_preparation.not_found"],
    };
  }

  const launchability = resolveLocalAgentControllerLaunchability({
    detected: input.candidate.detected,
    launchStatus: input.candidate.launchStatus,
    runtimeSupported: input.candidate.selectableReason !== "not_supported_yet",
    selectable: input.candidate.selectable,
    selectableReason: input.candidate.selectableReason,
  });
  const runtimeDecision = resolveLocalAgentControllerReportDecision(
    {
      blockerReasonCodes:
        launchability === "blocked" && input.candidate.launchStatus !== "ready"
          ? [resolveLaunchStatusReasonCode(input.candidate)]
          : resolveLocalAgentControllerBlockerReasonCodes({
              launchability,
              selectableReason: input.candidate.selectableReason,
            }),
      enabled: input.candidate.enabled,
      agentControllerInterface: input.inventoryItem?.agentControllerInterface,
      launchability,
      selectable: input.candidate.selectable,
      selectableReason: input.candidate.selectableReason,
    },
    { requireEnabled: false }
  );
  if (runtimeDecision.localParticipationState !== "ready") {
    return runtimeDecision;
  }

  if (input.readiness.service.runtime?.status !== "running") {
    return {
      localParticipationState: "needs_openmeld_service",
      reasonCodes: ["service.not_running"],
    };
  }

  return {
    localParticipationState: "ready",
    reasonCodes: [],
  };
}

function resolveLaunchStatusReasonCode(
  candidate: StartReadinessSnapshot["agents"]["candidates"][number]
): string {
  if (candidate.launchStatus === "needs_choice") {
    return "controller.launch.choice_required";
  }
  if (candidate.launchStatus === "needs_repair") {
    return "controller.launch.needs_repair";
  }
  return "local_agent_preparation.not_enabled";
}

function normalizeId(value: string): string {
  return value.trim();
}
