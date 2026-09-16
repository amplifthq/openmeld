const FALLBACK_ACTOR_NAME = "Agent";
const FALLBACK_TARGET_AGENT_NAME = "This agent";

// Scenario-specific copy variants owned by RuntimeCoordinator publishers.
// "delivery_expired" / "progress_stale" refine terminal_failure;
// "stopped_before_execution" refines wake_stopped. A variant that does not
// match the given noticeType is ignored.
export type SystemNoticeTextVariant =
  | "agent_profile_deleted"
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
    case "policy_blocked":
      return reason
        ? `OpenMeld blocked a public reply from ${actorName}: ${reason}`
        : `OpenMeld blocked a public reply from ${actorName}.`;
    case "terminal_failure": {
      const targetName = normalizedActorName ?? FALLBACK_TARGET_AGENT_NAME;
      if (input.variant === "delivery_expired") {
        return `${targetName} did not receive this Wake before it expired. Wake the Agent again when its computer is connected.`;
      }
      if (input.variant === "progress_stale") {
        return `${targetName} stopped making progress on this Wake. Reconnect the computer before trying again.`;
      }
      if (input.variant === "local_runtime_lost") {
        return `${targetName} was interrupted when its computer reconnected.`;
      }
      return reason
        ? `${actorName} couldn't reply: ${reason}`
        : `${actorName} couldn't reply.`;
    }
    case "wake_stopped":
      return buildWakeStoppedNoticeText({
        actorName: normalizedActorName,
        variant: input.variant,
      });
    default:
      return assertUnexpectedNoticeType(input.noticeType);
  }
}

function buildWakeStoppedNoticeText(input: {
  actorName: string | null;
  variant?: SystemNoticeTextVariant;
}): string {
  if (input.variant === "agent_profile_deleted") {
    return input.actorName
      ? `Wake cancelled. ${input.actorName} was deleted.`
      : "Wake cancelled. This agent was deleted.";
  }
  if (input.variant === "stopped_before_execution") {
    return input.actorName
      ? `Wake was stopped for ${input.actorName} before it reached the agent.`
      : "Wake was stopped before it reached the agent.";
  }
  return input.actorName
    ? `Wake was stopped for ${input.actorName}.`
    : "Wake was stopped.";
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
