import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import { reconcileNewRunnableBuiltinAgentRegistrations } from "../../agents/registry";
import type { AgentControllerInterfaceProbePolicy } from "../inventory/agent-controller-interface";
import {
  collectLocalAgentControllerInventory,
  resolveLocalAgentControllerReportDecision,
} from "../inventory/agent-controller-inventory";
import {
  notifyRuntimeReportingAttemptObserver,
  type RuntimeAgentControllerReportSubmission,
  type RuntimeReportingAttemptObserver,
  submitRuntimeAgentControllerReports,
} from "./runtime-agent-controller-reporting-submission";

export type LocalServiceRuntimeAgentControllerReportSyncResult =
  | {
      status: "skipped";
      reasonCodes: readonly string[];
      reportCount: 0;
      submittedCount: 0;
      failedCount: 0;
    }
  | {
      status: "submitted";
      reasonCodes: readonly string[];
      reportCount: number;
      submittedCount: number;
      failedCount: number;
    };

export async function syncLocalServiceRuntimeAgentControllerReports(input: {
  localAdapterContainer: LocalDaemonAdapterContainer;
  onAttempt?: RuntimeReportingAttemptObserver;
  probePolicy?: AgentControllerInterfaceProbePolicy;
}): Promise<LocalServiceRuntimeAgentControllerReportSyncResult> {
  // OPENMELD_SERVICE_THIN_CORE: runtime Agent Controller report evidence.
  // This reports detected local controller capabilities for the current
  // service identity. It must remain evidence, not Binding truth or final Ready.
  let inventory: Awaited<
    ReturnType<typeof collectLocalAgentControllerInventory>
  >;
  try {
    // Discovery belongs to the existing background inventory pass, not route
    // registration. Slow unrelated install probes must not strand new Wakes.
    // Newly registered controllers notify the carrier through the normal
    // lane-local catalog-change signal; explicit disabled choices stay intact.
    await reconcileNewRunnableBuiltinAgentRegistrations();
    inventory = await collectLocalAgentControllerInventory({
      includeControllerInterface: true,
      localAdapterContainer: input.localAdapterContainer,
      probePolicy: input.probePolicy,
    });
  } catch (error) {
    await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "Local agent inventory collection failed.",
      reasonCode: "runtime.reporting.inventory_failed",
      requiresCarrierHandshake: false,
      status: "failed",
    });
    throw error;
  }
  const reports = inventory.capabilities
    .filter((capability) => capability.registered)
    .map((capability) => {
      if (!capability.agentControllerRef) {
        return null;
      }
      const reportDecision = resolveLocalAgentControllerReportDecision(
        capability,
        { requireEnabled: true }
      );
      return {
        agentControllerRef: capability.agentControllerRef,
        ...(capability.agentControllerInterface
          ? { agentControllerInterface: capability.agentControllerInterface }
          : {}),
        enabled: capability.enabled,
        localParticipationState: reportDecision.localParticipationState,
        reasonCodes: reportDecision.reasonCodes,
      };
    })
    .filter((report): report is NonNullable<typeof report> => report !== null);

  if (reports.length === 0) {
    await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "No local controllers are installed on this computer.",
      reasonCode: "runtime.agent_controller_report.no_local_controllers",
      requiresCarrierHandshake: false,
      status: "not_applicable",
    });
    return {
      status: "skipped",
      reasonCodes: ["runtime.agent_controller_report.no_local_controllers"],
      reportCount: 0,
      submittedCount: 0,
      failedCount: 0,
    };
  }

  const submissions = await submitRuntimeAgentControllerReports({
    ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
    reports,
  });
  return summarizeSubmissions(submissions);
}

function summarizeSubmissions(
  submissions: readonly RuntimeAgentControllerReportSubmission[]
): LocalServiceRuntimeAgentControllerReportSyncResult {
  const submittedCount = submissions.filter(
    (submission) =>
      submission.status === "submitted" &&
      submission.agentControllerReportStatus === "accepted"
  ).length;
  const failedCount = submissions.length - submittedCount;
  return {
    status: "submitted",
    reasonCodes: [
      ...new Set(
        submissions
          .flatMap((submission) => submission.reasonCodes)
          .filter((reasonCode) => reasonCode.trim())
      ),
    ],
    reportCount: submissions.length,
    submittedCount,
    failedCount,
  };
}
