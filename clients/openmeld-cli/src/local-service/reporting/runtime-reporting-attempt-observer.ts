import type { RuntimeReportingServiceIdentity } from "@openmeld/schemas/types";
import { toErrorMessage, warnDaemonEvent } from "../core/logger";
import {
  recordRuntimeReportingFailure,
  recordRuntimeReportingNotApplicable,
  recordRuntimeReportingSuccess,
} from "../state/runtime-reporting-health-state";
import type {
  RuntimeReportingAttempt,
  RuntimeReportingAttemptObserver,
} from "./runtime-agent-controller-reporting-submission";
import type { RuntimeReportingAuthenticationFailure } from "./runtime-reporting-auth-recovery";

export function createRuntimeReportingAttemptObserver(input: {
  serviceIdentity: RuntimeReportingServiceIdentity;
  onAuthenticationFailure?: (
    failure: RuntimeReportingAuthenticationFailure
  ) => Promise<void> | void;
}): RuntimeReportingAttemptObserver {
  return async (attempt) => {
    await persistRuntimeReportingAttempt(attempt, input.serviceIdentity);
    if (
      attempt.status === "failed" &&
      (attempt.authenticationRejected || attempt.requiresCarrierHandshake) &&
      attempt.reasonCode &&
      attempt.message
    ) {
      await input.onAuthenticationFailure?.({
        message: attempt.message,
        reasonCode: attempt.reasonCode,
      });
    }
  };
}

async function persistRuntimeReportingAttempt(
  attempt: RuntimeReportingAttempt,
  serviceIdentity: RuntimeReportingServiceIdentity
): Promise<void> {
  const channel =
    attempt.family === "runtime_agent_controller"
      ? "runtimeAgentController"
      : "providerConversationProof";
  try {
    if (attempt.status === "succeeded") {
      await recordRuntimeReportingSuccess({ channel, serviceIdentity });
      return;
    }
    if (attempt.status === "not_applicable") {
      await recordRuntimeReportingNotApplicable({ channel, serviceIdentity });
      return;
    }
    await recordRuntimeReportingFailure({
      channel,
      message: attempt.message ?? "Runtime reporting failed.",
      reasonCode: attempt.reasonCode ?? "runtime.reporting.failed",
      serviceIdentity,
    });
  } catch (error) {
    warnDaemonEvent("[openmeld.runtime_reporting.health_write_failed]", {
      error: toErrorMessage(error),
      event: "cli.runtime_reporting.health_write_failed",
      family: attempt.family,
      reasonCode: attempt.reasonCode,
      status: attempt.status,
    });
  }
}
