import {
  isTaskResultStatusSuccessLike,
  type TaskResultDeliverySemantic as RuntimeTaskResultDeliverySemantic,
  resolveTaskResultDeliverySemantic,
} from "@openmeld/agent-runtime";
import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import { getCompensationDelayMs } from "./recovery-policy.js";

export type RuntimeInflightTaskLifecycleState = "absent" | "tracked";
export type RuntimeReplayLifecycleState =
  | "idle"
  | "candidate"
  | "committed"
  | "settled";
export type RuntimeTaskResultLifecycleState =
  | "pending_result"
  | OpenMeldDaemonTaskResultPayload["status"];
export type RuntimeCompensationLifecycleState = "active" | "terminal";

export type RuntimeTaskLifecycleTransitionCategory =
  | "track"
  | "recovery"
  | "result"
  | "compensation";

export type RuntimeInflightTaskTransitionKind =
  | "track_new_inflight_task"
  | "refresh_tracked_inflight_task"
  | "settle_tracked_inflight_task";

export type RuntimeReplayTransitionKind =
  | "surface_replay_candidate"
  | "commit_recovery_replay"
  | "settle_committed_replay";

export type RuntimeTaskResultTransitionKind =
  | "emit_success_payload"
  | "emit_partial_success_payload"
  | "emit_failed_payload";

export type RuntimeCompensationTransitionKind =
  | "schedule_next_compensation"
  | "settle_successful_compensation"
  | "exhaust_failed_compensation";

export type RuntimeInflightTaskTransition = {
  kind: RuntimeInflightTaskTransitionKind;
  category: RuntimeTaskLifecycleTransitionCategory;
  allowedFromStates: readonly RuntimeInflightTaskLifecycleState[];
  toState: RuntimeInflightTaskLifecycleState;
};

export type RuntimeReplayTransition = {
  kind: RuntimeReplayTransitionKind;
  category: RuntimeTaskLifecycleTransitionCategory;
  allowedFromStates: readonly RuntimeReplayLifecycleState[];
  toState: RuntimeReplayLifecycleState;
};

export type RuntimeTaskResultTransition = {
  kind: RuntimeTaskResultTransitionKind;
  category: RuntimeTaskLifecycleTransitionCategory;
  allowedFromStates: readonly RuntimeTaskResultLifecycleState[];
  toState: Extract<
    RuntimeTaskResultLifecycleState,
    "success" | "partial_success" | "failed"
  >;
};

export type RuntimeCompensationTransition = {
  kind: RuntimeCompensationTransitionKind;
  category: RuntimeTaskLifecycleTransitionCategory;
  allowedFromStates: readonly RuntimeCompensationLifecycleState[];
  toState: RuntimeCompensationLifecycleState;
  terminal: boolean;
};

export const RUNTIME_INFLIGHT_TASK_TRANSITION_MATRIX = {
  trackNewInflightTask: {
    kind: "track_new_inflight_task",
    category: "track",
    allowedFromStates: ["absent"],
    toState: "tracked",
  },
  refreshTrackedInflightTask: {
    kind: "refresh_tracked_inflight_task",
    category: "track",
    allowedFromStates: ["tracked"],
    toState: "tracked",
  },
  settleTrackedInflightTask: {
    kind: "settle_tracked_inflight_task",
    category: "track",
    allowedFromStates: ["tracked"],
    toState: "absent",
  },
} as const satisfies Record<string, RuntimeInflightTaskTransition>;

export const RUNTIME_REPLAY_TRANSITION_MATRIX = {
  surfaceReplayCandidate: {
    kind: "surface_replay_candidate",
    category: "recovery",
    allowedFromStates: ["idle"],
    toState: "candidate",
  },
  commitRecoveryReplay: {
    kind: "commit_recovery_replay",
    category: "recovery",
    allowedFromStates: ["candidate"],
    toState: "committed",
  },
  settleCommittedReplay: {
    kind: "settle_committed_replay",
    category: "recovery",
    allowedFromStates: ["committed"],
    toState: "settled",
  },
} as const satisfies Record<string, RuntimeReplayTransition>;

export const RUNTIME_TASK_RESULT_TRANSITION_MATRIX = {
  emitSuccessPayload: {
    kind: "emit_success_payload",
    category: "result",
    allowedFromStates: ["pending_result"],
    toState: "success",
  },
  emitPartialSuccessPayload: {
    kind: "emit_partial_success_payload",
    category: "result",
    allowedFromStates: ["pending_result"],
    toState: "partial_success",
  },
  emitFailedPayload: {
    kind: "emit_failed_payload",
    category: "result",
    allowedFromStates: ["pending_result"],
    toState: "failed",
  },
} as const satisfies Record<string, RuntimeTaskResultTransition>;

export const RUNTIME_COMPENSATION_TRANSITION_MATRIX = {
  scheduleNextCompensation: {
    kind: "schedule_next_compensation",
    category: "compensation",
    allowedFromStates: ["active"],
    toState: "active",
    terminal: false,
  },
  settleSuccessfulCompensation: {
    kind: "settle_successful_compensation",
    category: "compensation",
    allowedFromStates: ["active"],
    toState: "terminal",
    terminal: true,
  },
  exhaustFailedCompensation: {
    kind: "exhaust_failed_compensation",
    category: "compensation",
    allowedFromStates: ["active"],
    toState: "terminal",
    terminal: true,
  },
} as const satisfies Record<string, RuntimeCompensationTransition>;

const validateTransition = <
  TState extends string,
  TTransition extends {
    kind: string;
    allowedFromStates: readonly TState[];
  },
>(
  transition: TTransition,
  fromState: TState,
  label: string
): TTransition => {
  if (!transition.allowedFromStates.includes(fromState)) {
    throw new Error(
      `${label} ${transition.kind} does not allow ${String(fromState)}`
    );
  }
  return transition;
};

export const resolveInflightTaskLifecycleState = (input: {
  hasInflightTask: boolean;
}): RuntimeInflightTaskLifecycleState =>
  input.hasInflightTask ? "tracked" : "absent";

export const resolveReplayLifecycleState = (input: {
  hasInflightTask: boolean;
  replayCommitted: boolean;
}): RuntimeReplayLifecycleState => {
  if (input.hasInflightTask && input.replayCommitted) {
    return "committed";
  }
  if (input.hasInflightTask) {
    return "candidate";
  }
  if (input.replayCommitted) {
    return "settled";
  }
  return "idle";
};

export const resolveInflightTaskTransitionForTracking = (input: {
  hasInflightTask: boolean;
}): RuntimeInflightTaskTransition =>
  validateTransition(
    input.hasInflightTask
      ? RUNTIME_INFLIGHT_TASK_TRANSITION_MATRIX.refreshTrackedInflightTask
      : RUNTIME_INFLIGHT_TASK_TRANSITION_MATRIX.trackNewInflightTask,
    resolveInflightTaskLifecycleState({
      hasInflightTask: input.hasInflightTask,
    }),
    "runtime inflight transition"
  );

export const resolveInflightTaskTransitionForSettle = (input: {
  hasInflightTask: boolean;
}): RuntimeInflightTaskTransition =>
  validateTransition(
    RUNTIME_INFLIGHT_TASK_TRANSITION_MATRIX.settleTrackedInflightTask,
    resolveInflightTaskLifecycleState({
      hasInflightTask: input.hasInflightTask,
    }),
    "runtime inflight transition"
  );

export const resolveReplayTransitionForPlan = (input: {
  hasReplayCandidates: boolean;
}): RuntimeReplayTransition | null => {
  if (!input.hasReplayCandidates) {
    return null;
  }
  return validateTransition(
    RUNTIME_REPLAY_TRANSITION_MATRIX.surfaceReplayCandidate,
    "idle",
    "runtime replay transition"
  );
};

export const resolveReplayTransitionForCommit = (input: {
  hasInflightTask: boolean;
  replayCommitted: boolean;
}): RuntimeReplayTransition =>
  validateTransition(
    RUNTIME_REPLAY_TRANSITION_MATRIX.commitRecoveryReplay,
    resolveReplayLifecycleState(input),
    "runtime replay transition"
  );

export const resolveReplayTransitionForSettle = (input: {
  hasInflightTask: boolean;
  replayCommitted: boolean;
}): RuntimeReplayTransition =>
  validateTransition(
    RUNTIME_REPLAY_TRANSITION_MATRIX.settleCommittedReplay,
    resolveReplayLifecycleState(input),
    "runtime replay transition"
  );

export const resolveTaskResultTransitionForPayloadStatus = (input: {
  payloadStatus: Extract<
    OpenMeldDaemonTaskResultPayload["status"],
    "success" | "partial_success" | "failed"
  >;
}): RuntimeTaskResultTransition => {
  switch (input.payloadStatus) {
    case "success":
      return validateTransition(
        RUNTIME_TASK_RESULT_TRANSITION_MATRIX.emitSuccessPayload,
        "pending_result",
        "runtime task result transition"
      );
    case "partial_success":
      return validateTransition(
        RUNTIME_TASK_RESULT_TRANSITION_MATRIX.emitPartialSuccessPayload,
        "pending_result",
        "runtime task result transition"
      );
    case "failed":
      return validateTransition(
        RUNTIME_TASK_RESULT_TRANSITION_MATRIX.emitFailedPayload,
        "pending_result",
        "runtime task result transition"
      );
    default: {
      const neverStatus: never = input.payloadStatus;
      throw new Error(
        `unsupported runtime task result payload status: ${neverStatus}`
      );
    }
  }
};

export const isRuntimeTaskResultStatusSuccessLike = (
  status: OpenMeldDaemonTaskResultPayload["status"]
): status is Extract<
  OpenMeldDaemonTaskResultPayload["status"],
  "success" | "partial_success"
> => isTaskResultStatusSuccessLike(status);

export const resolveRuntimeTaskResultDeliverySemantic = (input: {
  payloadStatus: OpenMeldDaemonTaskResultPayload["status"];
}): RuntimeTaskResultDeliverySemantic =>
  resolveTaskResultDeliverySemantic({
    payloadStatus: input.payloadStatus,
  });

export const resolveCompensationTransition = (input: {
  attemptsCompleted: number;
  lastAttemptSucceeded: boolean;
}): RuntimeCompensationTransition => {
  if (input.lastAttemptSucceeded) {
    return validateTransition(
      RUNTIME_COMPENSATION_TRANSITION_MATRIX.settleSuccessfulCompensation,
      "active",
      "runtime compensation transition"
    );
  }

  const nextDelayMs = getCompensationDelayMs(input.attemptsCompleted + 1);
  if (nextDelayMs !== null) {
    return validateTransition(
      RUNTIME_COMPENSATION_TRANSITION_MATRIX.scheduleNextCompensation,
      "active",
      "runtime compensation transition"
    );
  }

  return validateTransition(
    RUNTIME_COMPENSATION_TRANSITION_MATRIX.exhaustFailedCompensation,
    "active",
    "runtime compensation transition"
  );
};
