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
  /** Present when another app occupying one native conversation opened the gate. */
  cause?: "controller_conversation_occupied";
  continuationClientMessageId: string | null;
  forkInterruptedConversation?: boolean;
  interruptedWork: AgentProfileWorkCoordinatorItem;
  additionalInterruptedWork?: AgentProfileWorkCoordinatorItem[];
  status:
    | "awaiting_occupancy_decision"
    | "awaiting_usage"
    | "continuation_pending"
    | "continuation_authorized"
    | "continuation_running"
    | "continuation_needs_attention"
    | "awaiting_owner_approval";
  updatedAtMs: number;
};

export type AgentProfileWorkCoordinator = {
  admissionMode?: "parallel" | "serial" | "draining";
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

export type AgentProfileWorkHandoffStatus =
  | "already_handed_off"
  | "handed_off"
  | "source_not_occupied"
  | "successor_conflict";

/**
 * Moves one occupied reservation to the work that continues it, in place.
 *
 * The successor takes over the source's slot instead of waiting for its turn,
 * so the reservation is never released: no gap opens for a following legacy
 * item to start ahead of it, and the concurrency ceiling, serial mode, and
 * draining all keep holding because the reserved count does not change. A
 * successor that was already waiting in this queue has that entry consumed,
 * leaving exactly one entry for the work. Callers own the evidence that the
 * source execution has stopped; this transition only requires that Core still
 * sees the source as reserved and occupied, which is what distinguishes a
 * blocked wait from a turn that is already running.
 */
export function handOffOccupiedAgentProfileWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
  sourceTargetWakeLifecycleId: string;
  successor: AgentProfileWorkCoordinatorItem;
}): {
  coordinator: AgentProfileWorkCoordinator;
  status: AgentProfileWorkHandoffStatus;
} {
  const sourceIndex = input.coordinator.workItems.findIndex(
    (item) => item.targetWakeLifecycleId === input.sourceTargetWakeLifecycleId
  );
  const source = input.coordinator.workItems[sourceIndex];
  if (!source) {
    // A repeated request finds the successor already holding the slot.
    return {
      coordinator: input.coordinator,
      status: input.coordinator.workItems.some(
        (item) =>
          item.targetWakeLifecycleId === input.successor.targetWakeLifecycleId
      )
        ? "already_handed_off"
        : "source_not_occupied",
    };
  }
  if (
    source.waitReason !== "controller_conversation_occupied" ||
    !reservedAgentProfileWork(input.coordinator).includes(source)
  ) {
    return { coordinator: input.coordinator, status: "source_not_occupied" };
  }
  // Accepting the successor Wake is what creates it, so it is normally already
  // waiting in this queue. Taking over the source's slot consumes that entry
  // instead of leaving a second entry behind for the same piece of work.
  const queuedSuccessor = input.coordinator.workItems.find(
    (item) =>
      item !== source &&
      item.targetWakeLifecycleId === input.successor.targetWakeLifecycleId
  );
  if (
    queuedSuccessor &&
    (reservedAgentProfileWork(input.coordinator).includes(queuedSuccessor) ||
      queuedSuccessor.executionContextId !== input.successor.executionContextId)
  ) {
    // An already reserved successor is running work of its own, and a context
    // the caller states wrongly must be refused rather than quietly corrected.
    return { coordinator: input.coordinator, status: "successor_conflict" };
  }

  const { waitReason: _waitReason, ...successor } = input.successor;
  const placed: AgentProfileWorkCoordinatorItem = successor.executionContextId
    ? { ...successor, reservationState: "reserved" }
    : successor;
  const workItems = input.coordinator.workItems
    .map((item, index) => (index === sourceIndex ? placed : item))
    .filter((item) => item !== queuedSuccessor);
  const coordinator = {
    ...input.coordinator,
    revision: input.coordinator.revision + 1,
    updatedAtMs: input.nowMs,
    workItems,
  } satisfies AgentProfileWorkCoordinator;

  const reserved = reservedAgentProfileWork(coordinator);
  const sameContextConflict =
    placed.executionContextId !== undefined &&
    reserved.some(
      (item) =>
        item !== placed && item.executionContextId === placed.executionContextId
    );
  // A successor that would not hold the slot, or would break a context's
  // serial guarantee, must leave the source untouched rather than half move.
  if (!reserved.includes(placed) || sameContextConflict) {
    return { coordinator: input.coordinator, status: "successor_conflict" };
  }
  return { coordinator, status: "handed_off" };
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
  const currentGate = input.coordinator.recoveryGate;
  const recoveryGate =
    currentGate?.status === "awaiting_owner_approval" &&
    workItems.every((item) => !recoveryGateHoldsWork(currentGate, item))
      ? nextInterruptedWorkGate(currentGate, input.nowMs)
      : currentGate;
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

/**
 * Drops work whose Wake can no longer reach this queue, then refills.
 *
 * A work item is only a scheduling claim over one Wake head. Once that head is
 * gone or already settled, the entry can never be promoted and can never be
 * settled again, so it holds its reservation permanently and every later Wake
 * waits behind work that will never run. The whole retired set has to leave in
 * one transition: refilling between removals would promote a successor that is
 * itself retired. Callers own the evidence that each named Wake is retired.
 */
export function dropRetiredAgentProfileWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
  retiredTargetWakeLifecycleIds: ReadonlySet<string>;
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItems: AgentProfileWorkCoordinatorItem[];
  removedItems: AgentProfileWorkCoordinatorItem[];
} {
  const removedItems = input.coordinator.workItems.filter((item) =>
    input.retiredTargetWakeLifecycleIds.has(item.targetWakeLifecycleId)
  );
  if (removedItems.length === 0) {
    return { coordinator: input.coordinator, promotedItems: [], removedItems };
  }
  const next = refillAgentProfileWork({
    coordinator: {
      ...input.coordinator,
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
      workItems: input.coordinator.workItems.filter(
        (item) =>
          !input.retiredTargetWakeLifecycleIds.has(item.targetWakeLifecycleId)
      ),
    },
    previouslyReserved: reservedAgentProfileWork(input.coordinator),
  });
  return { ...next, removedItems };
}

/**
 * The context a recovery gate is limited to, or null when it holds the Profile.
 *
 * Another app occupying one native conversation blocks only that conversation's
 * context. Usage exhaustion is a shared capability fact, so any usage-interrupted
 * work recorded on the gate keeps it Profile-wide, as does legacy work that has
 * no context of its own.
 */
function recoveryGateContextScope(
  gate: AgentProfileWorkRecoveryGate
): string | null {
  return gate.cause === "controller_conversation_occupied" &&
    !gate.additionalInterruptedWork?.length &&
    gate.interruptedWork.executionContextId
    ? gate.interruptedWork.executionContextId
    : null;
}

export function isAgentProfileWorkRecoveryGateProfileWide(
  gate: AgentProfileWorkRecoveryGate | null
): boolean {
  return Boolean(gate && recoveryGateContextScope(gate) === null);
}

function recoveryGateHoldsWork(
  gate: AgentProfileWorkRecoveryGate | null,
  item: AgentProfileWorkCoordinatorItem
): boolean {
  if (!gate) {
    return false;
  }
  const contextScope = recoveryGateContextScope(gate);
  return (
    contextScope === null ||
    !item.executionContextId ||
    item.executionContextId === contextScope
  );
}

function canResumeReplacementFollowUps(input: {
  continuation: AgentProfileWorkCoordinatorItem;
  gate: AgentProfileWorkRecoveryGate | null;
  continuationRunning: boolean;
  outcome: string;
  queuedWork: AgentProfileWorkCoordinatorItem[];
}): boolean {
  const gate = input.gate;
  return Boolean(
    input.continuationRunning &&
      input.outcome === "succeeded" &&
      gate?.forkInterruptedConversation &&
      input.continuation.executionContextId &&
      input.continuation.executionContextId !==
        gate.interruptedWork.executionContextId &&
      input.queuedWork.every(
        (item) =>
          item.executionContextId === input.continuation.executionContextId ||
          !recoveryGateHoldsWork(gate, item)
      )
  );
}

function settleRunningContinuation(input: {
  coordinator: AgentProfileWorkCoordinator;
  gate: AgentProfileWorkRecoveryGate;
  nowMs: number;
  outcome: AgentProfileWorkSettleOutcome;
  queuedWork: AgentProfileWorkCoordinatorItem[];
}): {
  coordinator: AgentProfileWorkCoordinator;
  promotedItem: AgentProfileWorkCoordinatorItem | null;
  promotedItems: AgentProfileWorkCoordinatorItem[];
  removed: boolean;
} {
  const awaitingOwnerApproval =
    input.outcome === "stopped" || input.outcome === "succeeded";
  const heldWork = input.queuedWork.filter((item) =>
    recoveryGateHoldsWork(input.gate, item)
  );
  // A continuation that exhausts usage turns the gate into a shared hold.
  const { cause: _cause, ...gateWithoutCause } = input.gate;
  const nextGate =
    awaitingOwnerApproval && heldWork.length === 0
      ? nextInterruptedWorkGate(input.gate, input.nowMs)
      : {
          ...(input.outcome === "usage_exhausted"
            ? gateWithoutCause
            : input.gate),
          continuationClientMessageId: null,
          status: awaitingOwnerApproval
            ? ("awaiting_owner_approval" as const)
            : ("continuation_needs_attention" as const),
          updatedAtMs: input.nowMs,
        };
  const next = refillAgentProfileWork({
    coordinator: {
      ...input.coordinator,
      recoveryGate: nextGate,
      revision: input.coordinator.revision + 1,
      updatedAtMs: input.nowMs,
      workItems: input.queuedWork,
    },
    previouslyReserved: reservedAgentProfileWork(input.coordinator),
  });
  return {
    coordinator: next.coordinator,
    promotedItem: next.promotedItems[0] ?? null,
    promotedItems: next.promotedItems,
    removed: true,
  };
}

export type AgentProfileWorkSettleOutcome =
  | "controller_conversation_occupied"
  | "failed"
  | "stopped"
  | "succeeded"
  | "usage_exhausted";

export function settleAgentProfileWork(input: {
  coordinator: AgentProfileWorkCoordinator;
  nowMs: number;
  outcome: AgentProfileWorkSettleOutcome;
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
  if (
    canResumeReplacementFollowUps({
      continuation: interruptedWork,
      continuationRunning,
      gate: input.coordinator.recoveryGate,
      outcome: input.outcome,
      queuedWork,
    })
  ) {
    // Follow-ups on the successful replacement are already addressed to that
    // context. Unrelated held work still requires the existing owner approval.
    return removeAgentProfileWork({
      ...input,
      coordinator: {
        ...input.coordinator,
        recoveryGate: nextInterruptedWorkGate(
          input.coordinator.recoveryGate,
          input.nowMs
        ),
      },
    });
  }
  const runningGate = input.coordinator.recoveryGate;
  if (continuationRunning && runningGate) {
    return settleRunningContinuation({
      coordinator: input.coordinator,
      gate: runningGate,
      nowMs: input.nowMs,
      outcome: input.outcome,
      queuedWork,
    });
  }

  if (input.outcome === "controller_conversation_occupied") {
    // The work stopped because another app owns the native conversation, so the
    // only honest continuation is a new branch off its verified history. That is
    // a decision the owner has to make, and it cannot be queued behind an
    // existing gate: a second interrupted item would come back as an
    // `awaiting_usage` resume, which would land in the same occupied thread.
    // With a gate already open this settles plainly and the notice carries the
    // cause instead.
    if (!input.coordinator.recoveryGate) {
      const next = refillAgentProfileWork({
        coordinator: {
          ...input.coordinator,
          recoveryGate: {
            cause: "controller_conversation_occupied",
            continuationClientMessageId: null,
            interruptedWork,
            status: "awaiting_occupancy_decision",
            updatedAtMs: input.nowMs,
          },
          revision: input.coordinator.revision + 1,
          updatedAtMs: input.nowMs,
          workItems: queuedWork,
        },
        previouslyReserved: reservedAgentProfileWork(input.coordinator),
      });
      return {
        coordinator: next.coordinator,
        promotedItem: next.promotedItems[0] ?? null,
        promotedItems: next.promotedItems,
        removed: true,
      };
    }
    return removeAgentProfileWork({
      coordinator: input.coordinator,
      nowMs: input.nowMs,
      targetWakeLifecycleId: input.targetWakeLifecycleId,
    });
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
      recoveryGate.status !== "continuation_authorized" &&
      // An occupancy decision is still a decision the owner has to make, so a
      // moved execution target has to hand it to them as attention rather than
      // answer that nothing is pending: the fork would otherwise be branched
      // from a conversation the current controller does not own.
      recoveryGate.status !== "awaiting_occupancy_decision")
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
  forkInterruptedConversation?: boolean;
  nowMs: number;
}): { coordinator: AgentProfileWorkCoordinator; changed: boolean } {
  const continuationClientMessageId = input.continuationClientMessageId.trim();
  const recoveryGate = input.coordinator.recoveryGate;
  const authorizable =
    recoveryGate?.status === "continuation_pending" ||
    recoveryGate?.status === "awaiting_occupancy_decision";
  if (!(continuationClientMessageId && recoveryGate && authorizable)) {
    return { coordinator: input.coordinator, changed: false };
  }
  const forkInterruptedConversation =
    input.forkInterruptedConversation ??
    recoveryGate.forkInterruptedConversation ??
    (recoveryGate.status === "awaiting_occupancy_decision" ? true : undefined);
  return {
    changed: true,
    coordinator: {
      ...input.coordinator,
      recoveryGate: {
        ...recoveryGate,
        continuationClientMessageId,
        ...(forkInterruptedConversation !== undefined
          ? { forkInterruptedConversation }
          : {}),
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
    input.coordinator.recoveryGate?.status !== "continuation_needs_attention" &&
    input.coordinator.recoveryGate?.status !== "awaiting_occupancy_decision"
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
  if (recoveryGateHoldsWork(coordinator.recoveryGate, item)) {
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
    coordinator.admissionMode === "draining" ||
    reserved.length >=
      (coordinator.admissionMode === "serial"
        ? 1
        : AGENT_PROFILE_WORK_CONCURRENCY_LIMIT) ||
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

export function refillAgentProfileWork(input: {
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
