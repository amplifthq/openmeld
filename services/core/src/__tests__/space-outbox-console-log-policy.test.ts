import { describe, expect, it } from "vitest";
import { shouldLogSpaceOutboxConsoleEvent } from "../space/transport/do/space-outbox-console-log-policy";

describe("space outbox console log policy", () => {
  it("suppresses normal outbox alarm maintenance", () => {
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "alarm_fired",
        fields: { spaceId: "space-1" },
      })
    ).toBe(false);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "alarm_kept",
        fields: { spaceId: "space-1" },
      })
    ).toBe(false);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "alarm_set",
        fields: { spaceId: "space-1" },
      })
    ).toBe(false);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "alarm_deleted",
        fields: { reason: "no_pending_work", spaceId: "space-1" },
      })
    ).toBe(false);
  });

  it("keeps abnormal alarm state changes visible", () => {
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "alarm_rescheduled_stale",
        fields: { spaceId: "space-1" },
      })
    ).toBe(true);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "alarm_deleted",
        fields: { reason: "unexpected", spaceId: "space-1" },
      })
    ).toBe(true);
  });

  it("suppresses empty flush cycles", () => {
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "flush_started",
        fields: { candidateCount: 0, spaceId: "space-1" },
      })
    ).toBe(false);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "flush_completed",
        fields: { candidateCount: 0, spaceId: "space-1" },
      })
    ).toBe(false);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "flush_started",
        fields: { candidateCount: 1, spaceId: "space-1" },
      })
    ).toBe(true);
  });

  it("suppresses normal duplicate candidate skips but keeps handoff evidence gaps", () => {
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "candidate_decision",
        fields: {
          decision: "skip",
          intakeEvidenceState: "found",
          skipReason: "dispatch_intake_evidence_exists",
          spaceId: "space-1",
        },
      })
    ).toBe(false);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "candidate_decision",
        fields: {
          decision: "skip",
          intakeEvidenceState: "found",
          skipReason: "dispatch_terminal_projection_exists",
          spaceId: "space-1",
        },
      })
    ).toBe(false);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "candidate_decision",
        fields: {
          decision: "skip",
          intakeEvidenceState: "missing",
          skipReason: "dispatch_intake_evidence_missing",
          spaceId: "space-1",
        },
      })
    ).toBe(true);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "candidate_decision",
        fields: {
          decision: "skip",
          intakeEvidenceState: "unavailable",
          skipReason: "dispatch_ledger_read_failed",
          spaceId: "space-1",
        },
      })
    ).toBe(true);
  });

  it("keeps real send and non-skip decisions visible", () => {
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "queue_sent",
        fields: { dispatchId: "dispatch-1", spaceId: "space-1" },
      })
    ).toBe(true);
    expect(
      shouldLogSpaceOutboxConsoleEvent({
        eventName: "candidate_decision",
        fields: { decision: "enqueue", spaceId: "space-1" },
      })
    ).toBe(true);
  });
});
