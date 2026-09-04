const AGENT_PROFILE_WORK_PROMOTION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_promotion.v1" as const;
const AGENT_PROFILE_WORK_PROMOTION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-work-promotion:v1:";
const AGENT_PROFILE_WORK_PROMOTION_RETRY_DELAYS_MS = [
  1000, 5000, 30_000, 120_000, 300_000,
] as const;

type AgentProfileWorkPromotionStorage = Pick<
  DurableObjectStorage,
  "delete" | "get" | "list" | "put" | "transaction"
>;

export type PendingAgentProfileWorkPromotion = {
  attemptCount: number;
  createdAtMs: number;
  dispatchId: string;
  modelVersion: typeof AGENT_PROFILE_WORK_PROMOTION_MODEL_VERSION;
  nextAttemptAtMs: number;
  targetProfileId: string;
  targetWakeLifecycleId: string;
};

export function buildPendingAgentProfileWorkPromotion(input: {
  dispatchId: string;
  nowMs: number;
  targetProfileId: string;
  targetWakeLifecycleId: string;
}): PendingAgentProfileWorkPromotion {
  return {
    attemptCount: 0,
    createdAtMs: input.nowMs,
    dispatchId: input.dispatchId,
    modelVersion: AGENT_PROFILE_WORK_PROMOTION_MODEL_VERSION,
    nextAttemptAtMs: input.nowMs,
    targetProfileId: input.targetProfileId,
    targetWakeLifecycleId: input.targetWakeLifecycleId,
  };
}

export function buildPendingAgentProfileWorkPromotionStorageKey(
  targetProfileId: string
): string {
  return `${AGENT_PROFILE_WORK_PROMOTION_STORAGE_KEY_PREFIX}${encodeURIComponent(
    targetProfileId
  )}`;
}

export async function readPendingAgentProfileWorkPromotions(
  storage: AgentProfileWorkPromotionStorage
): Promise<PendingAgentProfileWorkPromotion[]> {
  const records = await storage.list<unknown>({
    prefix: AGENT_PROFILE_WORK_PROMOTION_STORAGE_KEY_PREFIX,
  });
  return [...records.values()].map((value) => {
    const parsed = parsePendingAgentProfileWorkPromotion(value);
    if (!parsed) {
      throw new Error(
        "runtime_coordinator.agent_profile_work_promotion_invalid"
      );
    }
    return parsed;
  });
}

export async function readPendingAgentProfileWorkPromotion(
  storage: AgentProfileWorkPromotionStorage,
  targetProfileId: string
): Promise<PendingAgentProfileWorkPromotion | null> {
  const value = await storage.get<unknown>(
    buildPendingAgentProfileWorkPromotionStorageKey(targetProfileId)
  );
  if (value === undefined) {
    return null;
  }
  const parsed = parsePendingAgentProfileWorkPromotion(value);
  if (!parsed) {
    throw new Error("runtime_coordinator.agent_profile_work_promotion_invalid");
  }
  return parsed;
}

export async function clearPendingAgentProfileWorkPromotion(
  storage: AgentProfileWorkPromotionStorage,
  expected: PendingAgentProfileWorkPromotion
): Promise<boolean> {
  const storageKey = buildPendingAgentProfileWorkPromotionStorageKey(
    expected.targetProfileId
  );
  return await storage.transaction(async (transaction) => {
    const current = parsePendingAgentProfileWorkPromotion(
      await transaction.get<unknown>(storageKey)
    );
    if (!samePendingAgentProfileWorkPromotion(current, expected)) {
      return false;
    }
    await transaction.delete(storageKey);
    return true;
  });
}

export async function deferPendingAgentProfileWorkPromotion(input: {
  expected: PendingAgentProfileWorkPromotion;
  nowMs: number;
  storage: AgentProfileWorkPromotionStorage;
}): Promise<PendingAgentProfileWorkPromotion | null> {
  const storageKey = buildPendingAgentProfileWorkPromotionStorageKey(
    input.expected.targetProfileId
  );
  return await input.storage.transaction(async (transaction) => {
    const current = parsePendingAgentProfileWorkPromotion(
      await transaction.get<unknown>(storageKey)
    );
    if (
      !(
        current && samePendingAgentProfileWorkPromotion(current, input.expected)
      )
    ) {
      return null;
    }
    const attemptCount = current.attemptCount + 1;
    const delayIndex = Math.min(
      attemptCount - 1,
      AGENT_PROFILE_WORK_PROMOTION_RETRY_DELAYS_MS.length - 1
    );
    const retryDelayMs =
      AGENT_PROFILE_WORK_PROMOTION_RETRY_DELAYS_MS[delayIndex] ??
      AGENT_PROFILE_WORK_PROMOTION_RETRY_DELAYS_MS.at(-1);
    if (retryDelayMs === undefined) {
      throw new Error(
        "runtime_coordinator.agent_profile_work_promotion_retry_policy_invalid"
      );
    }
    const next = {
      ...current,
      attemptCount,
      nextAttemptAtMs: input.nowMs + retryDelayMs,
    } satisfies PendingAgentProfileWorkPromotion;
    await transaction.put(storageKey, next);
    return next;
  });
}

export async function readNextPendingAgentProfileWorkPromotionAlarmAtMs(
  storage: AgentProfileWorkPromotionStorage
): Promise<number | null> {
  const records = await readPendingAgentProfileWorkPromotions(storage);
  return records.reduce<number | null>(
    (earliest, record) =>
      earliest === null
        ? record.nextAttemptAtMs
        : Math.min(earliest, record.nextAttemptAtMs),
    null
  );
}

/**
 * Single explicit seam for a future structured usage-recovery eligibility
 * decision. Promotion is currently open because usage recovery has no durable
 * coordinator-owned contract yet.
 */
export function resolveAgentProfileWorkPromotionGate():
  | "open"
  | "wait_for_usage_recovery" {
  return "open";
}

export function parsePendingAgentProfileWorkPromotion(
  value: unknown
): PendingAgentProfileWorkPromotion | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<PendingAgentProfileWorkPromotion>;
  if (
    record.modelVersion !== AGENT_PROFILE_WORK_PROMOTION_MODEL_VERSION ||
    !isNonnegativeInteger(record.attemptCount) ||
    !isNonnegativeInteger(record.createdAtMs) ||
    typeof record.dispatchId !== "string" ||
    record.dispatchId.length === 0 ||
    !isNonnegativeInteger(record.nextAttemptAtMs) ||
    typeof record.targetProfileId !== "string" ||
    record.targetProfileId.length === 0 ||
    typeof record.targetWakeLifecycleId !== "string" ||
    record.targetWakeLifecycleId.length === 0
  ) {
    return null;
  }
  return record as PendingAgentProfileWorkPromotion;
}

function samePendingAgentProfileWorkPromotion(
  left: PendingAgentProfileWorkPromotion | null,
  right: PendingAgentProfileWorkPromotion
): boolean {
  return (
    left?.dispatchId === right.dispatchId &&
    left.targetProfileId === right.targetProfileId &&
    left.targetWakeLifecycleId === right.targetWakeLifecycleId
  );
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
