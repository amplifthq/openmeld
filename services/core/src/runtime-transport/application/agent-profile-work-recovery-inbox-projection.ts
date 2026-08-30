const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_recovery_inbox_projection.v1" as const;
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-work-recovery-inbox-projection:v1:";

type AgentProfileWorkRecoveryInboxProjectionStorage = Pick<
  DurableObjectStorage,
  "get" | "transaction"
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

export async function readAgentProfileWorkRecoveryInboxProjectionIntent(
  storage: Pick<DurableObjectStorage, "get">,
  targetProfileId: string
): Promise<AgentProfileWorkRecoveryInboxProjectionIntent | null> {
  const raw = await storage.get<unknown>(
    buildAgentProfileWorkRecoveryInboxProjectionStorageKey(targetProfileId)
  );
  if (raw === undefined) {
    return null;
  }
  const parsed = parseAgentProfileWorkRecoveryInboxProjectionIntent(raw);
  if (!parsed || parsed.targetProfileId !== targetProfileId) {
    throw new Error(
      "runtime_coordinator.agent_profile_work_recovery_inbox_projection_invalid"
    );
  }
  return parsed;
}

export async function clearAgentProfileWorkRecoveryInboxProjectionIntent(
  storage: AgentProfileWorkRecoveryInboxProjectionStorage,
  expected: AgentProfileWorkRecoveryInboxProjectionIntent
): Promise<boolean> {
  const storageKey = buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
    expected.targetProfileId
  );
  return await storage.transaction(async (transaction) => {
    const current = parseAgentProfileWorkRecoveryInboxProjectionIntent(
      await transaction.get<unknown>(storageKey)
    );
    if (!(current && sameProjectionIntent(current, expected))) {
      return false;
    }
    await transaction.delete(storageKey);
    return true;
  });
}

function parseAgentProfileWorkRecoveryInboxProjectionIntent(
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

function sameProjectionIntent(
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
