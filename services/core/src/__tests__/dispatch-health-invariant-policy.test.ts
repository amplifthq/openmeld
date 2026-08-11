import { describe, expect, it } from "vitest";
import {
  buildOutboxReadLedgerStatusFailedFinding,
  buildOutboxRedriveLoopSuspectedFinding,
  resolveCoreClaimTransitionContractViolation,
  resolveCoreOutboxCandidateTransitionContractViolation,
  resolveCoreOutboxWatchdogTransitionContractViolation,
} from "../dispatch/rules/dispatch-health-invariant-policy";
import {
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
} from "../dispatch/rules/dispatch-lifecycle-contract";
import { OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF } from "../space/infrastructure/outbox/dispatch-outbox-repo";

describe("dispatch health invariant policy", () => {
  it("builds high-signal findings with stable metadata", () => {
    expect(
      buildOutboxReadLedgerStatusFailedFinding({
        humanContext: {
          spaceName: "test-space",
        },
      })
    ).toEqual({
      humanContext: {
        spaceName: "test-space",
      },
      reasonCode: "outbox.read_ledger_status_failed",
      severity: "error",
      summaryKey: "core.outbox.read_ledger_status_failed",
    });

    expect(
      buildOutboxRedriveLoopSuspectedFinding({
        humanContext: {
          queuedAgeMs: 30_000,
        },
      })
    ).toEqual({
      humanContext: {
        queuedAgeMs: 30_000,
      },
      reasonCode: "outbox.redrive_loop_suspected",
      severity: "warn",
      summaryKey: "core.outbox.redrive_loop_suspected",
    });
  });

  it("does not report a finding for valid claim and outbox transitions", () => {
    expect(
      resolveCoreClaimTransitionContractViolation({
        decision: {
          kind: "claim_new",
        },
        existingStatus: null,
        latestAttemptStatus: null,
      })
    ).toBeNull();

    expect(
      resolveCoreOutboxCandidateTransitionContractViolation({
        decision: {
          kind: "submit",
        },
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
      })
    ).toBeNull();

    expect(
      resolveCoreOutboxWatchdogTransitionContractViolation({
        decision: {
          kind: "submit",
          reason: "route_lost",
        },
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
      })
    ).toBeNull();
  });

  it("reports transition contract violations when facts contradict the explicit matrix", () => {
    expect(
      resolveCoreClaimTransitionContractViolation({
        decision: {
          kind: "continue_existing",
          attemptId: "attempt-1",
          attemptNo: 1,
          connectionGeneration: 1,
          daemonSessionId: "daemon-1",
          leaseEpoch: 1,
        },
        existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.queued,
        latestAttemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      })
    ).toMatchObject({
      reasonCode: "dispatch.transition_contract_violation",
      severity: "error",
      summaryKey: "core.dispatch.transition_contract_violation",
    });

    expect(
      resolveCoreOutboxWatchdogTransitionContractViolation({
        decision: {
          kind: "skip",
          reason: "still_owned",
        },
        outboxStatus: "pending",
      })
    ).toMatchObject({
      reasonCode: "dispatch.transition_contract_violation",
      severity: "error",
      summaryKey: "core.dispatch.transition_contract_violation",
    });
  });
});
