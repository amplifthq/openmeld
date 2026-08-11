export type SchedulerPriority = "P0" | "P1" | "P2" | "P3";

export type SchedulerTask = {
  taskId: string;
  bindingKey: string;
  sequence: number;
  priority: SchedulerPriority;
  enqueuedAtMs: number;
};

export type SchedulerState = {
  fairnessCursor: number;
  consecutiveP1Dispatches: number;
};

export type ScheduledDispatch = {
  task: SchedulerTask;
  effectivePriority: SchedulerPriority;
  nextState: SchedulerState;
};

export const SCHEDULER_POLICY_DEFAULTS = {
  antiStarvationWaitMs: 30_000,
  maxConsecutiveP1Dispatches: 3,
  fairnessCycle: ["P1", "P1", "P2", "P3"] as const,
} as const;

export const INITIAL_SCHEDULER_STATE: SchedulerState = {
  fairnessCursor: 0,
  consecutiveP1Dispatches: 0,
};

type CandidateTask = {
  task: SchedulerTask;
  effectivePriority: SchedulerPriority;
};

const PRIORITY_RANK: Record<SchedulerPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const normalizePriority = (
  task: SchedulerTask,
  nowMs: number
): SchedulerPriority => {
  if (task.priority === "P0") {
    return "P0";
  }

  const waitedMs = nowMs - task.enqueuedAtMs;
  if (waitedMs > SCHEDULER_POLICY_DEFAULTS.antiStarvationWaitMs) {
    return "P1";
  }

  return task.priority;
};

const pickBindingHeads = (
  pendingTasks: SchedulerTask[],
  nowMs: number
): CandidateTask[] => {
  const headsByBinding = new Map<string, CandidateTask>();

  for (const task of pendingTasks) {
    const current = headsByBinding.get(task.bindingKey);
    const candidate: CandidateTask = {
      task,
      effectivePriority: normalizePriority(task, nowMs),
    };

    if (!current) {
      headsByBinding.set(task.bindingKey, candidate);
      continue;
    }

    if (candidate.task.sequence < current.task.sequence) {
      headsByBinding.set(task.bindingKey, candidate);
      continue;
    }

    if (
      candidate.task.sequence === current.task.sequence &&
      candidate.task.enqueuedAtMs < current.task.enqueuedAtMs
    ) {
      headsByBinding.set(task.bindingKey, candidate);
      continue;
    }

    if (
      candidate.task.sequence === current.task.sequence &&
      candidate.task.enqueuedAtMs === current.task.enqueuedAtMs &&
      candidate.task.taskId < current.task.taskId
    ) {
      headsByBinding.set(task.bindingKey, candidate);
    }
  }

  return [...headsByBinding.values()];
};

const sortCandidates = (left: CandidateTask, right: CandidateTask): number => {
  const leftRank = PRIORITY_RANK[left.effectivePriority];
  const rightRank = PRIORITY_RANK[right.effectivePriority];

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (left.task.enqueuedAtMs !== right.task.enqueuedAtMs) {
    return left.task.enqueuedAtMs - right.task.enqueuedAtMs;
  }

  if (left.task.sequence !== right.task.sequence) {
    return left.task.sequence - right.task.sequence;
  }

  if (left.task.bindingKey !== right.task.bindingKey) {
    return left.task.bindingKey.localeCompare(right.task.bindingKey);
  }

  return left.task.taskId.localeCompare(right.task.taskId);
};

const chooseFairnessPriority = (input: {
  availablePriorities: Set<Exclude<SchedulerPriority, "P0">>;
  state: SchedulerState;
}): {
  priority: Exclude<SchedulerPriority, "P0">;
  nextCursor: number;
} | null => {
  const cycle = SCHEDULER_POLICY_DEFAULTS.fairnessCycle;

  const hasLowerPriorityTraffic =
    input.availablePriorities.has("P2") || input.availablePriorities.has("P3");
  const p1Allowed = !(
    input.state.consecutiveP1Dispatches >=
      SCHEDULER_POLICY_DEFAULTS.maxConsecutiveP1Dispatches &&
    hasLowerPriorityTraffic
  );

  for (let offset = 0; offset < cycle.length; offset += 1) {
    const index = (input.state.fairnessCursor + offset) % cycle.length;
    const priority = cycle[index];
    if (!priority) {
      continue;
    }

    if (priority === "P1" && !p1Allowed) {
      continue;
    }

    if (input.availablePriorities.has(priority)) {
      return {
        priority,
        nextCursor: (index + 1) % cycle.length,
      };
    }
  }

  // Fallback: if cycle scan missed because of suppression, pick available highest.
  if (p1Allowed && input.availablePriorities.has("P1")) {
    return {
      priority: "P1",
      nextCursor: 1,
    };
  }

  if (input.availablePriorities.has("P2")) {
    return {
      priority: "P2",
      nextCursor: 3,
    };
  }

  if (input.availablePriorities.has("P3")) {
    return {
      priority: "P3",
      nextCursor: 0,
    };
  }

  return null;
};

export const selectNextTask = (input: {
  pendingTasks: SchedulerTask[];
  nowMs: number;
  state: SchedulerState;
}): ScheduledDispatch | null => {
  if (input.pendingTasks.length === 0) {
    return null;
  }

  const candidates = pickBindingHeads(input.pendingTasks, input.nowMs).sort(
    sortCandidates
  );
  if (candidates.length === 0) {
    return null;
  }

  const systemCandidates = candidates.filter(
    (candidate) => candidate.effectivePriority === "P0"
  );
  if (systemCandidates.length > 0) {
    const selected = systemCandidates[0];
    if (!selected) {
      return null;
    }
    return {
      task: selected.task,
      effectivePriority: selected.effectivePriority,
      nextState: {
        fairnessCursor: input.state.fairnessCursor,
        consecutiveP1Dispatches: 0,
      },
    };
  }

  const availablePriorities = new Set<Exclude<SchedulerPriority, "P0">>(
    candidates
      .map((candidate) => candidate.effectivePriority)
      .filter(
        (priority): priority is Exclude<SchedulerPriority, "P0"> =>
          priority !== "P0"
      )
  );

  const fairPriority = chooseFairnessPriority({
    availablePriorities,
    state: input.state,
  });

  if (!fairPriority) {
    return null;
  }

  const selected = candidates.find(
    (candidate) => candidate.effectivePriority === fairPriority.priority
  );
  if (!selected) {
    return null;
  }

  return {
    task: selected.task,
    effectivePriority: selected.effectivePriority,
    nextState: {
      fairnessCursor: fairPriority.nextCursor,
      consecutiveP1Dispatches:
        selected.effectivePriority === "P1"
          ? input.state.consecutiveP1Dispatches + 1
          : 0,
    },
  };
};

export const simulateSchedulerDispatch = (input: {
  pendingTasks: SchedulerTask[];
  nowMs: number;
  initialState?: SchedulerState;
}): {
  dispatches: Pick<ScheduledDispatch, "task" | "effectivePriority">[];
  finalState: SchedulerState;
} => {
  const remaining = [...input.pendingTasks];
  const dispatches: Pick<ScheduledDispatch, "task" | "effectivePriority">[] =
    [];

  let state = input.initialState ?? INITIAL_SCHEDULER_STATE;
  while (remaining.length > 0) {
    const selected = selectNextTask({
      pendingTasks: remaining,
      nowMs: input.nowMs,
      state,
    });

    if (!selected) {
      break;
    }

    dispatches.push({
      task: selected.task,
      effectivePriority: selected.effectivePriority,
    });

    const removeIndex = remaining.findIndex(
      (task) => task.taskId === selected.task.taskId
    );
    if (removeIndex < 0) {
      throw new Error("selected task not found in pending queue");
    }
    remaining.splice(removeIndex, 1);
    state = selected.nextState;
  }

  return {
    dispatches,
    finalState: state,
  };
};
