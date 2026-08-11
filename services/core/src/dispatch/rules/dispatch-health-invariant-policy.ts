import type { OpenMeldDaemonOutboxStatus } from "../../space/infrastructure/outbox/dispatch-outbox-repo";
import type {
  ActiveAttemptWatchdogDecision,
  HandedOffOutboxCandidatePolicyDecision,
} from "../../space/rules/policy/dispatch-outbox-redrive-policy";
import {
  resolveOutboxTransitionForCandidateDecision,
  resolveOutboxTransitionForWatchdogDecision,
} from "../../space/rules/policy/dispatch-outbox-transition-contract";
import type { DispatchAttemptClaimDecision } from "./dispatch-attempt-claim-policy";
import {
  CORE_DISPATCH_HEALTH_SEVERITY,
  type CoreDispatchHealthFinding,
  type CoreDispatchHealthHumanContext,
} from "./dispatch-health-contract";
import type {
  CoreDispatchAttemptLifecycleState,
  CoreDispatchLedgerLifecycleState,
} from "./dispatch-state-transition-contract";
import {
  resolveDispatchAttemptTransitionForClaimDecision,
  resolveDispatchLedgerTransitionForClaimDecision,
} from "./dispatch-state-transition-contract";

type CoreTransitionContractViolationOperation =
  | "dispatch.claim"
  | "outbox.candidate"
  | "outbox.watchdog";

const normalizeHumanContext = (
  humanContext: CoreDispatchHealthHumanContext | null | undefined
): CoreDispatchHealthHumanContext | null =>
  humanContext && Object.keys(humanContext).length > 0 ? humanContext : null;

export const buildOutboxReadLedgerStatusFailedFinding = (input: {
  humanContext?: CoreDispatchHealthHumanContext | null;
}): CoreDispatchHealthFinding => ({
  reasonCode: "outbox.read_ledger_status_failed",
  severity: CORE_DISPATCH_HEALTH_SEVERITY.error,
  summaryKey: "core.outbox.read_ledger_status_failed",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const buildOutboxRedriveLoopSuspectedFinding = (input: {
  humanContext?: CoreDispatchHealthHumanContext | null;
}): CoreDispatchHealthFinding => ({
  reasonCode: "outbox.redrive_loop_suspected",
  severity: CORE_DISPATCH_HEALTH_SEVERITY.warn,
  summaryKey: "core.outbox.redrive_loop_suspected",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const buildDispatchTransitionContractViolationFinding = (input: {
  humanContext?: CoreDispatchHealthHumanContext | null;
}): CoreDispatchHealthFinding => ({
  reasonCode: "dispatch.transition_contract_violation",
  severity: CORE_DISPATCH_HEALTH_SEVERITY.error,
  summaryKey: "core.dispatch.transition_contract_violation",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const resolveCoreClaimTransitionContractViolation = (input: {
  decision: DispatchAttemptClaimDecision;
  existingStatus: CoreDispatchLedgerLifecycleState;
  humanContext?: CoreDispatchHealthHumanContext | null;
  latestAttemptStatus: CoreDispatchAttemptLifecycleState;
}): CoreDispatchHealthFinding | null => {
  try {
    resolveDispatchLedgerTransitionForClaimDecision({
      decision: input.decision,
      existingStatus: input.existingStatus,
    });
    resolveDispatchAttemptTransitionForClaimDecision({
      decision: input.decision,
      latestAttemptStatus: input.latestAttemptStatus,
    });
    return null;
  } catch {
    return buildDispatchTransitionContractViolationFinding({
      humanContext: input.humanContext,
    });
  }
};

export const resolveCoreOutboxCandidateTransitionContractViolation = (input: {
  decision: HandedOffOutboxCandidatePolicyDecision;
  humanContext?: CoreDispatchHealthHumanContext | null;
  outboxStatus: OpenMeldDaemonOutboxStatus;
}): CoreDispatchHealthFinding | null =>
  resolveOutboxTransitionContractViolation({
    operation: "outbox.candidate",
    humanContext: input.humanContext,
    resolver: () =>
      resolveOutboxTransitionForCandidateDecision({
        decision: input.decision,
        outboxStatus: input.outboxStatus,
      }),
  });

export const resolveCoreOutboxWatchdogTransitionContractViolation = (input: {
  decision: ActiveAttemptWatchdogDecision;
  humanContext?: CoreDispatchHealthHumanContext | null;
  outboxStatus: OpenMeldDaemonOutboxStatus;
}): CoreDispatchHealthFinding | null =>
  resolveOutboxTransitionContractViolation({
    operation: "outbox.watchdog",
    humanContext: input.humanContext,
    resolver: () =>
      resolveOutboxTransitionForWatchdogDecision({
        decision: input.decision,
        outboxStatus: input.outboxStatus,
      }),
  });

const resolveOutboxTransitionContractViolation = (input: {
  humanContext?: CoreDispatchHealthHumanContext | null;
  operation: Exclude<
    CoreTransitionContractViolationOperation,
    "dispatch.claim"
  >;
  resolver: () => unknown;
}): CoreDispatchHealthFinding | null => {
  try {
    input.resolver();
    return null;
  } catch {
    return buildDispatchTransitionContractViolationFinding({
      humanContext: input.humanContext,
    });
  }
};
