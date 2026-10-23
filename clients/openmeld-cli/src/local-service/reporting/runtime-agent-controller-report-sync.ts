import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import type { AgentControllerInterfaceProbePolicy } from "../inventory/agent-controller-interface";
import {
  collectLocalAgentControllerInventory,
  resolveLocalAgentControllerReportDecision,
} from "../inventory/agent-controller-inventory";
import {
  notifyRuntimeReportingAttemptObserver,
  type RuntimeAgentControllerReportSubmission,
  type RuntimeReportingAttempt,
  type RuntimeReportingAttemptObserver,
  submitRuntimeAgentControllerReports,
} from "./runtime-agent-controller-reporting-submission";

// Controllers checked at once in one report pass. Each check carries its own
// timeout, so with a small pool one slow controller cannot hold back the
// renewal of every other controller's report, while cold starts still do not
// compete for the whole machine at once.
const LOCAL_AGENT_CONTROLLER_CHECK_CONCURRENCY = 3;

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
  const submissions: RuntimeAgentControllerReportSubmission[] = [];
  let failedAttempt: RuntimeReportingAttempt | undefined;
  const onAttempt: RuntimeReportingAttemptObserver = async (attempt) => {
    if (attempt.status === "failed") {
      failedAttempt ??= attempt;
    }
    // A later controller's success must not hide a failure in this scan.
    await notifyRuntimeReportingAttemptObserver(
      input.onAttempt,
      failedAttempt ?? attempt
    );
  };
  try {
    await collectLocalAgentControllerInventory({
      concurrency: LOCAL_AGENT_CONTROLLER_CHECK_CONCURRENCY,
      reconcileNewRegistrations: true,
      includeControllerInterface: true,
      localAdapterContainer: input.localAdapterContainer,
      probePolicy: input.probePolicy,
      onCapability: async (capability) => {
        if (!(capability.registered && capability.agentControllerRef)) {
          return;
        }
        const decision = resolveLocalAgentControllerReportDecision(capability, {
          requireEnabled: true,
        });
        // Publish each completed check; an unrelated controller must not hold
        // back evidence that is already available. Core still owns readiness.
        submissions.push(
          ...(await submitRuntimeAgentControllerReports({
            ...(input.onAttempt ? { onAttempt } : {}),
            reports: [
              {
                agentControllerRef: capability.agentControllerRef,
                ...(capability.agentControllerInterface
                  ? {
                      agentControllerInterface:
                        capability.agentControllerInterface,
                    }
                  : {}),
                enabled: capability.enabled,
                localParticipationState: decision.localParticipationState,
                reasonCodes: decision.reasonCodes,
              },
            ],
          }))
        );
      },
    });
  } catch (error) {
    await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "Local agent inventory collection failed.",
      reasonCode: "runtime.reporting.inventory_failed",
      status: "failed",
    });
    throw error;
  }
  if (submissions.length === 0) {
    await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
      authenticationRejected: false,
      family: "runtime_agent_controller",
      message: "No local controllers are installed on this computer.",
      reasonCode: "runtime.agent_controller_report.no_local_controllers",
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
