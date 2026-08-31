const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_recovery_inbox_projection.v1" as const;
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-work-recovery-inbox-projection:v1:";
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_RETRY_DELAY_MS = 1000;
export const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MAX_FAILURES = 3;

type AgentProfileWorkRecoveryInboxProjectionReadStorage = Pick<
  DurableObjectStorage,
  "list"
>;

export type AgentProfileWorkRecoveryInboxProjectionIntent = {
  desiredStatus: "open" | "resolved";
  failureCount: number;
  modelVersion: typeof AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION;
  occurredAtMs: number;
  stage: "approve_queued_work" | "review_interrupted_work";
  targetProfileId: string;
  targetWakeLifecycleId: string;
  updatedAtMs: number;
};

export function buildAgentProfileWorkRecoveryInboxProjectionIntent(input: {
  desiredStatus: AgentProfileWorkRecoveryInboxProjectionIntent["desiredStatus"];
  occurredAtMs: number;
  stage: AgentProfileWorkRecoveryInboxProjectionIntent["stage"];
  targetProfileId: string;
  targetWakeLifecycleId: string;
  updatedAtMs: number;
}): AgentProfileWorkRecoveryInboxProjectionIntent {
  return {
    desiredStatus: input.desiredStatus,
    failureCount: 0,
    modelVersion: AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION,
    occurredAtMs: input.occurredAtMs,
    stage: input.stage,
    targetProfileId: input.targetProfileId,
    targetWakeLifecycleId: input.targetWakeLifecycleId,
    updatedAtMs: input.updatedAtMs,
  };
}

export function buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
  targetProfileId: string
): string {
  return `${AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX}${encodeURIComponent(
    targetProfileId
  )}`;
}

export async function readPendingAgentProfileWorkRecoveryInboxProjectionIntents(
  storage: AgentProfileWorkRecoveryInboxProjectionReadStorage,
  limit: number
): Promise<AgentProfileWorkRecoveryInboxProjectionIntent[]> {
  const stored = await storage.list<unknown>({
    limit,
    prefix: AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX,
  });
  const intents: AgentProfileWorkRecoveryInboxProjectionIntent[] = [];
  for (const [storageKey, raw] of stored) {
    const intent = parseAgentProfileWorkRecoveryInboxProjectionIntent(raw);
    if (
      !intent ||
      buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
        intent.targetProfileId
      ) !== storageKey
    ) {
      throw new Error(
        "runtime_coordinator.agent_profile_work_recovery_inbox_projection_invalid"
      );
    }
    intents.push(intent);
  }
  return intents;
}

export async function readNextAgentProfileWorkRecoveryInboxProjectionAlarmAtMs(
  storage: Pick<DurableObjectStorage, "list">,
  nowMs: number
): Promise<number | null> {
  const stored = await storage.list<unknown>({
    limit: 1,
    prefix: AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX,
  });
  return stored.size > 0
    ? nowMs + AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_RETRY_DELAY_MS
    : null;
}

export function parseAgentProfileWorkRecoveryInboxProjectionIntent(
  value: unknown
): AgentProfileWorkRecoveryInboxProjectionIntent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const intent =
    value as Partial<AgentProfileWorkRecoveryInboxProjectionIntent>;
  const failureCount = intent.failureCount ?? 0;
  const stage = intent.stage ?? "approve_queued_work";
  if (
    intent.modelVersion !==
      AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION ||
    (intent.desiredStatus !== "open" && intent.desiredStatus !== "resolved") ||
    typeof intent.targetProfileId !== "string" ||
    intent.targetProfileId.length === 0 ||
    typeof intent.targetWakeLifecycleId !== "string" ||
    intent.targetWakeLifecycleId.length === 0 ||
    (stage !== "approve_queued_work" && stage !== "review_interrupted_work") ||
    !isNonnegativeInteger(failureCount) ||
    !isNonnegativeInteger(intent.occurredAtMs) ||
    !isNonnegativeInteger(intent.updatedAtMs)
  ) {
    return null;
  }
  return {
    desiredStatus: intent.desiredStatus,
    failureCount,
    modelVersion: intent.modelVersion,
    occurredAtMs: intent.occurredAtMs,
    stage,
    targetProfileId: intent.targetProfileId,
    targetWakeLifecycleId: intent.targetWakeLifecycleId,
    updatedAtMs: intent.updatedAtMs,
  } as AgentProfileWorkRecoveryInboxProjectionIntent;
}

export function sameAgentProfileWorkRecoveryInboxProjectionIntent(
  left: AgentProfileWorkRecoveryInboxProjectionIntent,
  right: AgentProfileWorkRecoveryInboxProjectionIntent
): boolean {
  return (
    left.desiredStatus === right.desiredStatus &&
    left.failureCount === right.failureCount &&
    left.occurredAtMs === right.occurredAtMs &&
    left.stage === right.stage &&
    left.targetProfileId === right.targetProfileId &&
    left.targetWakeLifecycleId === right.targetWakeLifecycleId &&
    left.updatedAtMs === right.updatedAtMs
  );
}

export async function recordAgentProfileWorkRecoveryInboxProjectionFailure(input: {
  intent: AgentProfileWorkRecoveryInboxProjectionIntent;
  storage: Pick<DurableObjectStorage, "delete" | "get" | "put" | "transaction">;
}): Promise<"dropped" | "recorded" | "state_changed"> {
  const storageKey = buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
    input.intent.targetProfileId
  );
  return await input.storage.transaction(async (transaction) => {
    const current = parseAgentProfileWorkRecoveryInboxProjectionIntent(
      await transaction.get<unknown>(storageKey)
    );
    if (
      !(
        current &&
        sameAgentProfileWorkRecoveryInboxProjectionIntent(current, input.intent)
      )
    ) {
      return "state_changed" as const;
    }
    const failureCount = current.failureCount + 1;
    if (
      failureCount >= AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MAX_FAILURES
    ) {
      await transaction.delete(storageKey);
      return "dropped" as const;
    }
    await transaction.put(storageKey, { ...current, failureCount });
    return "recorded" as const;
  });
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
