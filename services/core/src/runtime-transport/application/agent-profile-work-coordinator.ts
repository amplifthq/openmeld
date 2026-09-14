import {
  AGENT_PROFILE_WORK_CONCURRENCY_LIMIT,
  AGENT_PROFILE_WORK_MAX_WAITING,
} from "@openmeld/agent-runtime";

// Core owns reservations; the Service can further constrain local admission.
export const AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING =
  AGENT_PROFILE_WORK_MAX_WAITING;

export type AgentProfileWorkCoordinatorItem = {
  dispatchId: string;
  enqueuedAtMs: number;
  targetWakeLifecycleId: string;
  executionContextId?: string;
  reservationState?: "reserved" | "waiting";
  waitReason?: "controller_conversation_occupied";
};

export type AgentProfileWorkRecoveryGate = {
  continuationClientMessageId: string | null;
  interruptedWork: AgentProfileWorkCoordinatorItem;
  additionalInterruptedWork?: AgentProfileWorkCoordinatorItem[];
  status:
    | "awaiting_usage"
    | "continuation_pending"
    | "continuation_authorized"
    | "continuation_running"
    | "continuation_needs_attention"
    | "awaiting_owner_approval";
  updatedAtMs: number;
};

export type AgentProfileWorkCoordinator = {
  recoveryGate: AgentProfileWorkRecoveryGate | null;
  revision: number;
  targetProfileId: string;
  updatedAtMs: number;
  /** Scoped work has explicit reservations; legacy work retains one exclusive slot. */
  workItems: AgentProfileWorkCoordinatorItem[];
};

export type AgentProfileWorkCoordinatorSummary = {
  currentWaitReason?: "controller_conversation_occupied";
  currentWork: AgentProfileWorkCoordinatorItem | null;
  currentWorks: readonly AgentProfileWorkCoordinatorItem[];
  queuedWork: readonly AgentProfileWorkCoordinatorItem[];
  status: "idle" | "paused" | "working";
  waitingCount: number;
};

export function markAgentProfileWorkControllerConversationOccupancy(input: {
  coordinator: AgentProfileWorkCoordinator;
  dispatchId: string;
  nowMs: number;
  state: "available" | "occupied";
}): { coordinator: AgentProfileWorkCoordinator; changed: boolean } {
  const currentWork = reservedAgentProfileWork(input.coordinator).find(
    (item) => item.dispatchId === input.dispatchId
  );
  if (!currentWork) {
    return { coordinator: input.coordinator, changed: false };
  }
  const currentlyOccupied =
    currentWork.waitReason === "controller_conversation_occupied";
  if (currentlyOccupied === (input.state === "occupied")) {
    return { coordinator: input.coordinator, changed: false };
  }
  const { waitReason: _waitReason, ...baseCurrentWork } = currentWork;
  const nextCurrentWork: AgentProfileWorkCoordinatorItem =
    input.state === "occupied"
      ? {
          ...baseCurrentWork,
          waitReason: "controller_conversation_occupied",
        }
      : baseCurrentWork;
  return {
    changed: true,
    coordinator: {
      ...input.coordinator,
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
      workItems: input.coordinator.workItems.map((item) =>
        item === currentWork ? nextCurrentWork : item
      ),
    },
  };
}

type AgentProfileWorkAcceptance = {
  coordinator: AgentProfileWorkCoordinator;
  queuePosition: number | null;
  status: "already_accepted" | "queue_full" | "queued" | "start";
  waitingCount: number;
};

export function createAgentProfileWorkCoordinator(input: {
  nowMs: number;
  targetProfileId: string;
}): AgentProfileWorkCoordinator {
  return {
    recoveryGate: null,
    revision: 0,
    targetProfileId: input.targetProfileId,
    updatedAtMs: input.nowMs,
    workItems: [],
  };
}

export function acceptAgentProfileWork(input: {
  continuationClientMessageId?: string;
  coordinator: AgentProfileWorkCoordinator;
  item: AgentProfileWorkCoordinatorItem;
  nowMs: number;
}): AgentProfileWorkAcceptance {
  const existingIndex = input.coordinator.workItems.findIndex(
    (item) => item.targetWakeLifecycleId === input.item.targetWakeLifecycleId
  );
  if (existingIndex >= 0) {
    return {
      coordinator: input.coordinator,
      queuePosition: queuePositionForWorkIndex(
        input.coordinator,
        existingIndex
      ),
      status: "already_accepted",
      waitingCount: waitingCount(input.coordinator),
    };
  }

  const continuationAuthorized = isAuthorizedContinuation(input);
  const canStart =
    continuationAuthorized ||
    canReserveAgentProfileWork(input.coordinator, input.item);
  if (
    !canStart &&
    waitingCount(input.coordinator) >=
      AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING
  ) {
    return {
      coordinator: input.coordinator,
      queuePosition: null,
      status: "queue_full",
      waitingCount: AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING,
    };
  }

  const item = input.item.executionContextId
    ? {
        ...input.item,
        reservationState: canStart
          ? ("reserved" as const)
          : ("waiting" as const),
      }
    : input.item;
  const queuePosition = canStart ? 0 : waitingCount(input.coordinator) + 1;
  const workItems = continuationAuthorized
    ? [item, ...input.coordinator.workItems]
    : [...input.coordinator.workItems, item];
  const recoveryGate = input.coordinator.recoveryGate;
  const coordinator = {
    ...input.coordinator,
    recoveryGate: continuationAuthorized
      ? {
          ...recoveryGate,
          continuationClientMessageId: null,
          interruptedWork: recoveryGate?.interruptedWork ?? input.item,
          status: "continuation_running" as const,
          updatedAtMs: input.nowMs,
        }
      : input.coordinator.recoveryGate,
    revision: input.coordinator.revision + 1,
    updatedAtMs: input.nowMs,
    workItems,
  } satisfies AgentProfileWorkCoordinator;
  return {
    coordinator,
    queuePosition,
    status: canStart ? "start" : "queued",
    waitingCount: waitingCount(coordinator),
  };
}

export function removeAgentProfileWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
  targetWakeLifecycleId: string;
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItem: AgentProfileWorkCoordinatorItem | null;
  promotedItems: AgentProfileWorkCoordinatorItem[];
  removed: boolean;
} {
  const removedIndex = input.coordinator.workItems.findIndex(
    (item) => item.targetWakeLifecycleId === input.targetWakeLifecycleId
  );
  if (removedIndex < 0) {
    return {
      coordinator: input.coordinator,
      promotedItem: null,
      promotedItems: [],
      removed: false,
    };
  }

  const workItems = input.coordinator.workItems.filter(
    (_item, index) => index !== removedIndex
  );
  const recoveryGate =
    input.coordinator.recoveryGate?.status === "awaiting_owner_approval" &&
    workItems.length === 0
      ? nextInterruptedWorkGate(input.coordinator.recoveryGate, input.nowMs)
      : input.coordinator.recoveryGate;
  const next = refillAgentProfileWork({
    coordinator: {
      ...input.coordinator,
      recoveryGate,
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
      workItems,
    },
    previouslyReserved: reservedAgentProfileWork(input.coordinator),
  });
  return {
    ...next,
    promotedItem: next.promotedItems[0] ?? null,
    removed: true,
  };
}

export function settleAgentProfileWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
  outcome: "failed" | "stopped" | "succeeded" | "usage_exhausted";
  targetWakeLifecycleId: string;
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItem: AgentProfileWorkCoordinatorItem | null;
  promotedItems: AgentProfileWorkCoordinatorItem[];
  removed: boolean;
} {
  const removedIndex = input.coordinator.workItems.findIndex(
    (item) => item.targetWakeLifecycleId === input.targetWakeLifecycleId
  );
  if (
    !reservedAgentProfileWork(input.coordinator).some(
      (item) => item.targetWakeLifecycleId === input.targetWakeLifecycleId
    )
  ) {
    return removeAgentProfileWork({
      coordinator: input.coordinator,
      nowMs: input.nowMs,
      targetWakeLifecycleId: input.targetWakeLifecycleId,
    });
  }

  const interruptedWork = input.coordinator.workItems[removedIndex];
  if (!interruptedWork) {
    return {
      coordinator: input.coordinator,
      promotedItem: null,
      promotedItems: [],
      removed: false,
    };
  }
  const queuedWork = input.coordinator.workItems.filter(
    (_, index) => index !== removedIndex
  );
  const continuationRunning =
    removedIndex === 0 &&
    input.coordinator.recoveryGate?.status === "continuation_running";
  if (continuationRunning) {
    const interruptedContinuationWork =
      input.coordinator.recoveryGate?.interruptedWork ?? interruptedWork;
    const awaitingOwnerApproval =
      input.outcome === "stopped" || input.outcome === "succeeded";
    return {
      coordinator: {
        ...input.coordinator,
        recoveryGate:
          awaitingOwnerApproval && queuedWork.length === 0
            ? nextInterruptedWorkGate(
                input.coordinator.recoveryGate,
                input.nowMs
              )
            : {
                ...input.coordinator.recoveryGate,
                continuationClientMessageId: null,
                interruptedWork: interruptedContinuationWork,
                status: awaitingOwnerApproval
                  ? "awaiting_owner_approval"
                  : "continuation_needs_attention",
                updatedAtMs: input.nowMs,
              },
        revision: input.coordinator.revision + 1,
        updatedAtMs: input.nowMs,
        workItems: queuedWork,
      },
      promotedItem: null,
      promotedItems: [],
      removed: true,
    };
  }

  if (input.outcome === "usage_exhausted") {
    return {
      coordinator: {
        ...input.coordinator,
        recoveryGate: input.coordinator.recoveryGate
          ? {
              ...input.coordinator.recoveryGate,
              additionalInterruptedWork: [
                ...(input.coordinator.recoveryGate.additionalInterruptedWork ??
                  []),
                interruptedWork,
              ],
              updatedAtMs: input.nowMs,
            }
          : {
              continuationClientMessageId: null,
              interruptedWork,
              status: "awaiting_usage",
              updatedAtMs: input.nowMs,
            },
        revision: input.coordinator.revision + 1,
        updatedAtMs: input.nowMs,
        workItems: queuedWork,
      },
      promotedItem: null,
      promotedItems: [],
      removed: true,
    };
  }

  return removeAgentProfileWork({
    coordinator: input.coordinator,
    nowMs: input.nowMs,
    targetWakeLifecycleId: input.targetWakeLifecycleId,
  });
}

export function markAgentProfileWorkUsageAvailable(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
}): { coordinator: AgentProfileWorkCoordinator; changed: boolean } {
  if (input.coordinator.recoveryGate?.status !== "awaiting_usage") {
    return { coordinator: input.coordinator, changed: false };
  }
  return {
    changed: true,
    coordinator: {
      ...input.coordinator,
      recoveryGate: {
        ...input.coordinator.recoveryGate,
        status: "continuation_pending",
        updatedAtMs: input.nowMs,
      },
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
    },
  };
}

export function markAgentProfileWorkContinuationNeedsAttention(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
}): { coordinator: AgentProfileWorkCoordinator; changed: boolean } {
  const recoveryGate = input.coordinator.recoveryGate;
  if (
    !recoveryGate ||
    (recoveryGate.status !== "continuation_pending" &&
      recoveryGate.status !== "continuation_authorized")
  ) {
    return { coordinator: input.coordinator, changed: false };
  }
  return {
    changed: true,
    coordinator: {
      ...input.coordinator,
      recoveryGate: {
        ...recoveryGate,
        status: "continuation_needs_attention",
        updatedAtMs: input.nowMs,
      },
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
    },
  };
}

export function authorizeAgentProfileWorkContinuation(input: {
  continuationClientMessageId: string;
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
}): { coordinator: AgentProfileWorkCoordinator; changed: boolean } {
  const continuationClientMessageId = input.continuationClientMessageId.trim();
  if (
    !continuationClientMessageId ||
    input.coordinator.recoveryGate?.status !== "continuation_pending"
  ) {
    return { coordinator: input.coordinator, changed: false };
  }
  return {
    changed: true,
    coordinator: {
      ...input.coordinator,
      recoveryGate: {
        ...input.coordinator.recoveryGate,
        continuationClientMessageId,
        status: "continuation_authorized",
        updatedAtMs: input.nowMs,
      },
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
    },
  };
}

export function approveAgentProfileWorkQueue(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItem: AgentProfileWorkCoordinatorItem | null;
  promotedItems: AgentProfileWorkCoordinatorItem[];
} {
  if (input.coordinator.recoveryGate?.status !== "awaiting_owner_approval") {
    return {
      coordinator: input.coordinator,
      promotedItem: null,
      promotedItems: [],
    };
  }
  const next = refillAgentProfileWork({
    coordinator: {
      ...input.coordinator,
      recoveryGate: nextInterruptedWorkGate(
        input.coordinator.recoveryGate,
        input.nowMs
      ),
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
    },
    previouslyReserved: reservedAgentProfileWork(input.coordinator),
  });
  return { ...next, promotedItem: next.promotedItems[0] ?? null };
}

export function skipAgentProfileInterruptedWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItem: AgentProfileWorkCoordinatorItem | null;
  promotedItems: AgentProfileWorkCoordinatorItem[];
} {
  if (
    input.coordinator.recoveryGate?.status !== "continuation_needs_attention"
  ) {
    return {
      coordinator: input.coordinator,
      promotedItem: null,
      promotedItems: [],
    };
  }
  const next = refillAgentProfileWork({
    coordinator: {
      ...input.coordinator,
      recoveryGate: nextInterruptedWorkGate(
        input.coordinator.recoveryGate,
        input.nowMs
      ),
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
    },
    previouslyReserved: reservedAgentProfileWork(input.coordinator),
  });
  return { ...next, promotedItem: next.promotedItems[0] ?? null };
}

export function summarizeAgentProfileWorkCoordinator(
  coordinator: AgentProfileWorkCoordinator
): AgentProfileWorkCoordinatorSummary {
  const currentWorks = reservedAgentProfileWork(coordinator);
  if (isAgentProfileWorkPaused(coordinator) && currentWorks.length === 0) {
    return {
      currentWork: null,
      currentWorks,
      queuedWork: coordinator.workItems,
      status: "paused",
      waitingCount: coordinator.workItems.length,
    };
  }
  const currentWork = currentWorks[0] ?? null;
  const queuedWork = coordinator.workItems.filter(
    (item) => !currentWorks.includes(item)
  );
  return {
    ...(currentWork?.waitReason
      ? { currentWaitReason: currentWork.waitReason }
      : {}),
    currentWork,
    currentWorks,
    queuedWork,
    status: currentWork ? "working" : "idle",
    waitingCount: queuedWork.length,
  };
}

function waitingCount(coordinator: AgentProfileWorkCoordinator): number {
  return summarizeAgentProfileWorkCoordinator(coordinator).waitingCount;
}

function isAgentProfileWorkPaused(
  coordinator: AgentProfileWorkCoordinator
): boolean {
  return Boolean(
    coordinator.recoveryGate &&
      coordinator.recoveryGate.status !== "continuation_running"
  );
}

function isAuthorizedContinuation(input: {
  continuationClientMessageId?: string;
  coordinator: AgentProfileWorkCoordinator;
}): boolean {
  const gate = input.coordinator.recoveryGate;
  return Boolean(
    gate?.status === "continuation_authorized" &&
      input.continuationClientMessageId &&
      input.continuationClientMessageId === gate.continuationClientMessageId
  );
}

function queuePositionForWorkIndex(
  coordinator: AgentProfileWorkCoordinator,
  workIndex: number
): number {
  const summary = summarizeAgentProfileWorkCoordinator(coordinator);
  const item = coordinator.workItems[workIndex];
  if (!item) {
    return 0;
  }
  return summary.currentWorks.includes(item)
    ? 0
    : summary.queuedWork.indexOf(item) + 1;
}

export function reservedAgentProfileWork(
  coordinator: AgentProfileWorkCoordinator
): AgentProfileWorkCoordinatorItem[] {
  return coordinator.workItems.filter((item, index) =>
    item.executionContextId
      ? item.reservationState === "reserved"
      : index === 0 && !isAgentProfileWorkPaused(coordinator)
  );
}

function canReserveAgentProfileWork(
  coordinator: AgentProfileWorkCoordinator,
  item: AgentProfileWorkCoordinatorItem
): boolean {
  if (coordinator.recoveryGate) {
    return false;
  }
  const reserved = reservedAgentProfileWork(coordinator);
  if (!item.executionContextId) {
    return (
      reserved.length === 0 &&
      (coordinator.workItems[0] === item || coordinator.workItems.length === 0)
    );
  }
  if (
    reserved.length >= AGENT_PROFILE_WORK_CONCURRENCY_LIMIT ||
    reserved.some(
      (active) =>
        !active.executionContextId ||
        active.executionContextId === item.executionContextId
    )
  ) {
    return false;
  }
  const index = coordinator.workItems.indexOf(item);
  return !coordinator.workItems
    .slice(0, index < 0 ? undefined : index)
    .some((waiter) => !waiter.executionContextId);
}

function refillAgentProfileWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  previouslyReserved: readonly AgentProfileWorkCoordinatorItem[];
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItems: AgentProfileWorkCoordinatorItem[];
} {
  const coordinator = {
    ...input.coordinator,
    workItems: [...input.coordinator.workItems],
  };
  for (let index = 0; index < coordinator.workItems.length; index += 1) {
    const item = coordinator.workItems[index];
    if (
      item?.executionContextId &&
      item.reservationState !== "reserved" &&
      canReserveAgentProfileWork(coordinator, item)
    ) {
      coordinator.workItems[index] = { ...item, reservationState: "reserved" };
    }
  }
  const priorIds = new Set(
    input.previouslyReserved.map((item) => item.targetWakeLifecycleId)
  );
  return {
    coordinator,
    promotedItems: reservedAgentProfileWork(coordinator).filter(
      (item) => !priorIds.has(item.targetWakeLifecycleId)
    ),
  };
}

function nextInterruptedWorkGate(
  gate: AgentProfileWorkRecoveryGate | null,
  nowMs: number
): AgentProfileWorkRecoveryGate | null {
  const [interruptedWork, ...additionalInterruptedWork] =
    gate?.additionalInterruptedWork ?? [];
  return interruptedWork
    ? {
        interruptedWork,
        additionalInterruptedWork,
        continuationClientMessageId: null,
        status: "awaiting_usage",
        updatedAtMs: nowMs,
      }
    : null;
}
