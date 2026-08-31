export const AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING = 50;

export type AgentProfileWorkCoordinatorItem = {
  dispatchId: string;
  enqueuedAtMs: number;
  targetWakeLifecycleId: string;
  waitReason?: "controller_conversation_occupied";
};

export type AgentProfileWorkRecoveryGate = {
  continuationClientMessageId: string | null;
  interruptedWork: AgentProfileWorkCoordinatorItem;
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
  /** Index zero owns the execution slot. Every later item waits in FIFO order. */
  workItems: AgentProfileWorkCoordinatorItem[];
};

export type AgentProfileWorkCoordinatorSummary = {
  currentWaitReason?: "controller_conversation_occupied";
  currentWork: AgentProfileWorkCoordinatorItem | null;
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
  const currentWork = input.coordinator.workItems[0];
  if (!currentWork || currentWork.dispatchId !== input.dispatchId) {
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
      workItems: [nextCurrentWork, ...input.coordinator.workItems.slice(1)],
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
  const maxWorkItems =
    input.coordinator.recoveryGate && !continuationAuthorized
      ? AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING
      : AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING + 1;
  if (input.coordinator.workItems.length >= maxWorkItems) {
    return {
      coordinator: input.coordinator,
      queuePosition: null,
      status: "queue_full",
      waitingCount: AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING,
    };
  }

  const queuePosition = continuationAuthorized
    ? 0
    : input.coordinator.workItems.length +
      (isAgentProfileWorkPaused(input.coordinator) ? 1 : 0);
  const workItems = continuationAuthorized
    ? [input.item, ...input.coordinator.workItems]
    : [...input.coordinator.workItems, input.item];
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
    status: continuationAuthorized || queuePosition === 0 ? "start" : "queued",
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
  removed: boolean;
} {
  const removedIndex = input.coordinator.workItems.findIndex(
    (item) => item.targetWakeLifecycleId === input.targetWakeLifecycleId
  );
  if (removedIndex < 0) {
    return {
      coordinator: input.coordinator,
      promotedItem: null,
      removed: false,
    };
  }

  const workItems = input.coordinator.workItems.filter(
    (_item, index) => index !== removedIndex
  );
  const recoveryGate =
    input.coordinator.recoveryGate?.status === "awaiting_owner_approval" &&
    workItems.length === 0
      ? null
      : input.coordinator.recoveryGate;
  return {
    coordinator: {
      ...input.coordinator,
      recoveryGate,
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
      workItems,
    },
    promotedItem:
      removedIndex === 0 && !isAgentProfileWorkPaused(input.coordinator)
        ? (workItems[0] ?? null)
        : null,
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
  removed: boolean;
} {
  const removedIndex = input.coordinator.workItems.findIndex(
    (item) => item.targetWakeLifecycleId === input.targetWakeLifecycleId
  );
  if (removedIndex !== 0) {
    return removeAgentProfileWork({
      coordinator: input.coordinator,
      nowMs: input.nowMs,
      targetWakeLifecycleId: input.targetWakeLifecycleId,
    });
  }

  const interruptedWork = input.coordinator.workItems[0];
  if (!interruptedWork) {
    return {
      coordinator: input.coordinator,
      promotedItem: null,
      removed: false,
    };
  }
  const queuedWork = input.coordinator.workItems.slice(1);
  const continuationRunning =
    input.coordinator.recoveryGate?.status === "continuation_running";
  if (input.outcome === "usage_exhausted") {
    const recoveryInterruptedWork = continuationRunning
      ? (input.coordinator.recoveryGate?.interruptedWork ?? interruptedWork)
      : interruptedWork;
    return {
      coordinator: {
        ...input.coordinator,
        recoveryGate: {
          continuationClientMessageId: null,
          interruptedWork: recoveryInterruptedWork,
          status: "awaiting_usage",
          updatedAtMs: input.nowMs,
        },
        revision: input.coordinator.revision + 1,
        updatedAtMs: input.nowMs,
        workItems: queuedWork,
      },
      promotedItem: null,
      removed: true,
    };
  }

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
            ? null
            : {
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
        continuationClientMessageId: null,
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
} {
  if (input.coordinator.recoveryGate?.status !== "awaiting_owner_approval") {
    return { coordinator: input.coordinator, promotedItem: null };
  }
  return {
    coordinator: {
      ...input.coordinator,
      recoveryGate: null,
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
    },
    promotedItem: input.coordinator.workItems[0] ?? null,
  };
}

export function skipAgentProfileInterruptedWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItem: AgentProfileWorkCoordinatorItem | null;
} {
  if (
    input.coordinator.recoveryGate?.status !== "continuation_needs_attention"
  ) {
    return { coordinator: input.coordinator, promotedItem: null };
  }
  return {
    coordinator: {
      ...input.coordinator,
      recoveryGate: null,
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
    },
    promotedItem: input.coordinator.workItems[0] ?? null,
  };
}

export function summarizeAgentProfileWorkCoordinator(
  coordinator: AgentProfileWorkCoordinator
): AgentProfileWorkCoordinatorSummary {
  if (isAgentProfileWorkPaused(coordinator)) {
    return {
      currentWork: null,
      queuedWork: coordinator.workItems,
      status: "paused",
      waitingCount: coordinator.workItems.length,
    };
  }
  const [currentWork = null, ...queuedWork] = coordinator.workItems;
  return {
    ...(currentWork?.waitReason
      ? { currentWaitReason: currentWork.waitReason }
      : {}),
    currentWork,
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
  return workIndex + (isAgentProfileWorkPaused(coordinator) ? 1 : 0);
}
