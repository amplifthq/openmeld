const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_recovery_inbox_projection.v1" as const;
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-work-recovery-inbox-projection:v1:";
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARKED_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-work-recovery-inbox-projection-parked:v1:";
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARKED_POINTER_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-work-recovery-inbox-projection-parked-pointer:v1:";
const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_RETRY_DELAY_MS = 1000;
export const AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARK_RETRY_DELAY_MS = 60_000;
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
  retryAfterMs: number | null;
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
    retryAfterMs: null,
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

function buildParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(
  input: Pick<
    AgentProfileWorkRecoveryInboxProjectionIntent,
    "retryAfterMs" | "targetProfileId"
  >
): string {
  if (input.retryAfterMs === null) {
    throw new Error(
      "runtime_coordinator.agent_profile_work_recovery_inbox_projection_parked_retry_missing"
    );
  }
  return `${AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARKED_STORAGE_KEY_PREFIX}${String(
    input.retryAfterMs
  ).padStart(16, "0")}:${encodeURIComponent(input.targetProfileId)}`;
}

function buildParkedAgentProfileWorkRecoveryInboxProjectionPointerStorageKey(
  targetProfileId: string
): string {
  return `${AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARKED_POINTER_STORAGE_KEY_PREFIX}${encodeURIComponent(
    targetProfileId
  )}`;
}

async function readParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(
  storage: Pick<DurableObjectStorage, "get">,
  targetProfileId: string
): Promise<string | undefined> {
  const parkedStorageKey = await storage.get<unknown>(
    buildParkedAgentProfileWorkRecoveryInboxProjectionPointerStorageKey(
      targetProfileId
    )
  );
  if (parkedStorageKey === undefined) {
    return undefined;
  }
  if (
    typeof parkedStorageKey !== "string" ||
    !parkedStorageKey.startsWith(
      AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARKED_STORAGE_KEY_PREFIX
    ) ||
    !parkedStorageKey.endsWith(`:${encodeURIComponent(targetProfileId)}`)
  ) {
    throw new Error(
      "runtime_coordinator.agent_profile_work_recovery_inbox_projection_parked_pointer_invalid"
    );
  }
  return parkedStorageKey;
}

export function resolveAgentProfileWorkRecoveryInboxProjectionStorageKey(
  intent: AgentProfileWorkRecoveryInboxProjectionIntent
): string {
  return intent.retryAfterMs === null
    ? buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
        intent.targetProfileId
      )
    : buildParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(intent);
}

export async function writeAgentProfileWorkRecoveryInboxProjectionIntent(input: {
  intent: AgentProfileWorkRecoveryInboxProjectionIntent;
  storage: Pick<DurableObjectStorage, "delete" | "get" | "put">;
}): Promise<void> {
  if (input.intent.retryAfterMs !== null) {
    throw new Error(
      "runtime_coordinator.agent_profile_work_recovery_inbox_projection_current_retry_invalid"
    );
  }
  const parkedPointerStorageKey =
    buildParkedAgentProfileWorkRecoveryInboxProjectionPointerStorageKey(
      input.intent.targetProfileId
    );
  const parkedStorageKey =
    await readParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(
      input.storage,
      input.intent.targetProfileId
    );
  const writes: Promise<unknown>[] = [
    input.storage.put(
      buildAgentProfileWorkRecoveryInboxProjectionStorageKey(
        input.intent.targetProfileId
      ),
      input.intent
    ),
    input.storage.delete(parkedPointerStorageKey),
  ];
  if (typeof parkedStorageKey === "string") {
    writes.push(input.storage.delete(parkedStorageKey));
  }
  await Promise.all(writes);
}

export async function deleteAgentProfileWorkRecoveryInboxProjectionIntent(input: {
  intent: AgentProfileWorkRecoveryInboxProjectionIntent;
  storage: Pick<DurableObjectStorage, "delete" | "get">;
}): Promise<void> {
  const storageKey = resolveAgentProfileWorkRecoveryInboxProjectionStorageKey(
    input.intent
  );
  if (input.intent.retryAfterMs === null) {
    await input.storage.delete(storageKey);
    return;
  }
  const pointerStorageKey =
    buildParkedAgentProfileWorkRecoveryInboxProjectionPointerStorageKey(
      input.intent.targetProfileId
    );
  const parkedStorageKey =
    await readParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(
      input.storage,
      input.intent.targetProfileId
    );
  await Promise.all([
    input.storage.delete(storageKey),
    ...(parkedStorageKey === storageKey
      ? [input.storage.delete(pointerStorageKey)]
      : []),
  ]);
}

export async function readPendingAgentProfileWorkRecoveryInboxProjectionIntents(
  storage: AgentProfileWorkRecoveryInboxProjectionReadStorage,
  limit: number,
  nowMs: number
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
      intent.retryAfterMs !== null ||
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
  if (intents.length >= limit) {
    return intents;
  }
  const parked = await storage.list<unknown>({
    limit: limit - intents.length,
    prefix:
      AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARKED_STORAGE_KEY_PREFIX,
  });
  const readyParkedIntents: AgentProfileWorkRecoveryInboxProjectionIntent[] =
    [];
  for (const [storageKey, raw] of parked) {
    const intent = parseAgentProfileWorkRecoveryInboxProjectionIntent(raw);
    if (
      !intent ||
      intent.retryAfterMs === null ||
      buildParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(intent) !==
        storageKey
    ) {
      throw new Error(
        "runtime_coordinator.agent_profile_work_recovery_inbox_projection_parked_invalid"
      );
    }
    if (intent.retryAfterMs <= nowMs) {
      readyParkedIntents.push(intent);
    }
  }
  return intents.concat(readyParkedIntents);
}

export async function readNextAgentProfileWorkRecoveryInboxProjectionAlarmAtMs(
  storage: Pick<DurableObjectStorage, "list">,
  nowMs: number
): Promise<number | null> {
  const stored = await storage.list<unknown>({
    limit: 1,
    prefix: AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_STORAGE_KEY_PREFIX,
  });
  if (stored.size > 0) {
    return nowMs + AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_RETRY_DELAY_MS;
  }
  const parked = await storage.list<unknown>({
    limit: 1,
    prefix:
      AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARKED_STORAGE_KEY_PREFIX,
  });
  for (const [storageKey, raw] of parked) {
    const intent = parseAgentProfileWorkRecoveryInboxProjectionIntent(raw);
    if (
      !intent ||
      intent.retryAfterMs === null ||
      buildParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(intent) !==
        storageKey
    ) {
      throw new Error(
        "runtime_coordinator.agent_profile_work_recovery_inbox_projection_parked_invalid"
      );
    }
    return Math.max(
      nowMs + AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_RETRY_DELAY_MS,
      intent.retryAfterMs
    );
  }
  return null;
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
  const retryAfterMs = intent.retryAfterMs ?? null;
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
    !(retryAfterMs === null || isNonnegativeInteger(retryAfterMs)) ||
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
    retryAfterMs,
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
    left.retryAfterMs === right.retryAfterMs &&
    left.stage === right.stage &&
    left.targetProfileId === right.targetProfileId &&
    left.targetWakeLifecycleId === right.targetWakeLifecycleId &&
    left.updatedAtMs === right.updatedAtMs
  );
}

export async function recordAgentProfileWorkRecoveryInboxProjectionFailure(input: {
  intent: AgentProfileWorkRecoveryInboxProjectionIntent;
  nowMs: number;
  storage: Pick<DurableObjectStorage, "delete" | "get" | "put" | "transaction">;
}): Promise<"parked" | "recorded" | "state_changed"> {
  const storageKey = resolveAgentProfileWorkRecoveryInboxProjectionStorageKey(
    input.intent
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
    const failureCount = Math.min(
      current.failureCount + 1,
      AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MAX_FAILURES
    );
    if (
      current.retryAfterMs !== null ||
      failureCount >= AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_MAX_FAILURES
    ) {
      const parkedIntent = {
        ...current,
        failureCount,
        retryAfterMs:
          input.nowMs +
          AGENT_PROFILE_WORK_RECOVERY_INBOX_PROJECTION_PARK_RETRY_DELAY_MS,
      } satisfies AgentProfileWorkRecoveryInboxProjectionIntent;
      const parkedStorageKey =
        buildParkedAgentProfileWorkRecoveryInboxProjectionStorageKey(
          parkedIntent
        );
      await Promise.all([
        transaction.delete(storageKey),
        transaction.put(parkedStorageKey, parkedIntent),
        transaction.put(
          buildParkedAgentProfileWorkRecoveryInboxProjectionPointerStorageKey(
            current.targetProfileId
          ),
          parkedStorageKey
        ),
      ]);
      return "parked" as const;
    }
    await transaction.put(storageKey, { ...current, failureCount });
    return "recorded" as const;
  });
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
