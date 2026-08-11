const SPACE_OUTBOX_LOG_PREFIX = "[core.openmeld.space.outbox." as const;

type SpaceOutboxConsoleFields = Record<string, unknown>;

export type SpaceOutboxConsoleEvent =
  | {
      eventName:
        | "alarm_fired"
        | "alarm_kept"
        | "alarm_rescheduled_stale"
        | "alarm_set"
        | "direct_queue_fallback"
        | "direct_retry_scheduled"
        | "direct_submitted"
        | "queue_sent";
      fields: SpaceOutboxConsoleFields;
    }
  | {
      eventName: "alarm_deleted";
      fields: SpaceOutboxConsoleFields & {
        reason?: unknown;
      };
    }
  | {
      eventName: "flush_completed" | "flush_started";
      fields: SpaceOutboxConsoleFields & {
        candidateCount: number;
      };
    }
  | {
      eventName: "candidate_decision";
      fields: SpaceOutboxConsoleFields & {
        decision?: unknown;
        intakeEvidenceState?: unknown;
        skipReason?: unknown;
      };
    };

export function shouldLogSpaceOutboxConsoleEvent(
  event: SpaceOutboxConsoleEvent
): boolean {
  switch (event.eventName) {
    case "alarm_fired":
    case "alarm_kept":
    case "alarm_set":
      return false;
    case "alarm_deleted":
      return event.fields.reason !== "no_pending_work";
    case "direct_queue_fallback":
    case "direct_retry_scheduled":
    case "direct_submitted":
    case "alarm_rescheduled_stale":
    case "queue_sent":
      return true;
    case "flush_completed":
    case "flush_started":
      return event.fields.candidateCount > 0;
    case "candidate_decision":
      return shouldLogSpaceOutboxCandidateDecision(event.fields);
    default:
      return true;
  }
}

export function logSpaceOutboxConsoleEvent(
  event: SpaceOutboxConsoleEvent
): void {
  if (!shouldLogSpaceOutboxConsoleEvent(event)) {
    return;
  }
  console.info(`${SPACE_OUTBOX_LOG_PREFIX}${event.eventName}]`, event.fields);
}

function shouldLogSpaceOutboxCandidateDecision(
  fields: Extract<
    SpaceOutboxConsoleEvent,
    { eventName: "candidate_decision" }
  >["fields"]
): boolean {
  if (fields.decision !== "skip") {
    return true;
  }
  return !(
    fields.skipReason === "dispatch_intake_evidence_exists" ||
    fields.skipReason === "dispatch_terminal_projection_exists"
  );
}
