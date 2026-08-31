const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_recovery_inbox_projection.v1" as const;
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-work-recovery-inbox-projection:v1:";
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_RETRY_DELAY_MS = 1000;

type AgentProfileWorkRecoveryInboxProjectionReadStorage = Pick<
  DurableObjectStorage,
  "list"
>;

export type AgentProfileWorkRecoveryInboxProjectionIntent = {
  desiredStatus: "open" | "resolved";
  modelVersion: typeof AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION;
  occurredAtMs: number;
  targetProfileId: string;
  targetWakeLifecycleId: string;
  updatedAtMs: number;
};

export function buildAgentProfileWorkRecoveryInboxProjectionIntent(input: {
  desiredStatus: AgentProfileWorkRecoveryInboxProjectionIntent["desiredStatus"];
  occurredAtMs: number;
  targetProfileId: string;
  targetWakeLifecycleId: string;
  updatedAtMs: number;
}): AgentProfileWorkRecoveryInboxProjectionIntent {
  return {
    desiredStatus: input.desiredStatus,
    modelVersion: AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION,
    occurredAtMs: input.occurredAtMs,
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
  if (
    intent.modelVersion !==
      AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION ||
    (intent.desiredStatus !== "open" && intent.desiredStatus !== "resolved") ||
    typeof intent.targetProfileId !== "string" ||
    intent.targetProfileId.length === 0 ||
    typeof intent.targetWakeLifecycleId !== "string" ||
    intent.targetWakeLifecycleId.length === 0 ||
    !isNonnegativeInteger(intent.occurredAtMs) ||
    !isNonnegativeInteger(intent.updatedAtMs)
  ) {
    return null;
  }
  return intent as AgentProfileWorkRecoveryInboxProjectionIntent;
}

export function sameAgentProfileWorkRecoveryInboxProjectionIntent(
  left: AgentProfileWorkRecoveryInboxProjectionIntent,
  right: AgentProfileWorkRecoveryInboxProjectionIntent
): boolean {
  return (
    left.desiredStatus === right.desiredStatus &&
    left.occurredAtMs === right.occurredAtMs &&
    left.targetProfileId === right.targetProfileId &&
    left.targetWakeLifecycleId === right.targetWakeLifecycleId &&
    left.updatedAtMs === right.updatedAtMs
  );
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
