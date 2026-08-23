const FALLBACK_ACTOR_NAME = "Agent";
const FALLBACK_TARGET_AGENT_NAME = "This agent";

// Scenario-specific copy variants owned by RuntimeCoordinator publishers.
// "delivery_expired" / "progress_stale" refine terminal_failure;
// "stopped_before_execution" refines wake_stopped. A variant that does not
// match the given noticeType is ignored.
export type SystemNoticeTextVariant =
  | "delivery_expired"
  | "local_runtime_lost"
  | "progress_stale"
  | "stopped_before_execution";

export function buildSystemNoticeText(input: {
  actorName?: string | null;
  noticeType:
    | "policy_blocked"
    | "stay_silent"
    | "terminal_failure"
    | "wake_completed"
    | "wake_stopped";
  reason?: string | null;
  variant?: SystemNoticeTextVariant;
}): string {
  const normalizedActorName = normalizeOptionalText(input.actorName);
  const actorName = normalizedActorName ?? FALLBACK_ACTOR_NAME;
  const reason = normalizeOptionalText(input.reason);

  switch (input.noticeType) {
    case "stay_silent":
      return `${actorName} chose to stay silent.`;
    case "wake_completed":
      return `${actorName} finished this Wake without posting a public reply.`;
    case "policy_blocked":
      return reason
        ? `OpenMeld blocked a public reply from ${actorName}: ${reason}`
        : `OpenMeld blocked a public reply from ${actorName}.`;
    case "terminal_failure": {
      const targetName = normalizedActorName ?? FALLBACK_TARGET_AGENT_NAME;
      if (input.variant === "delivery_expired") {
        return `${targetName} did not receive this Wake before it expired. Wake the agent again when the local OpenMeld Service is online.`;
      }
      if (input.variant === "progress_stale") {
        return `${targetName} stopped making progress on this Wake. Reconnect OpenMeld Service before trying again.`;
      }
      if (input.variant === "local_runtime_lost") {
        return `${targetName} was interrupted when OpenMeld Service restarted.`;
      }
      return reason
        ? `${actorName} couldn't reply: ${reason}`
        : `${actorName} couldn't reply.`;
    }
    case "wake_stopped": {
      if (input.variant === "stopped_before_execution") {
        return normalizedActorName
          ? `Wake was stopped for ${normalizedActorName} before it reached the agent.`
          : "Wake was stopped before it reached the agent.";
      }
      return normalizedActorName
        ? `Wake was stopped for ${normalizedActorName}.`
        : "Wake was stopped.";
    }
    default:
      return assertUnexpectedNoticeType(input.noticeType);
  }
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function assertUnexpectedNoticeType(value: never): never {
  throw new Error(`unsupported system notice type: ${String(value)}`);
}
