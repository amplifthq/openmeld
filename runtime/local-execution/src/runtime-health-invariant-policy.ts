import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import {
  type ExternalHealthState,
  mapRuntimeHealthToExternalHealth,
  type RuntimeHealthState,
  resolveHealthReasonCode,
} from "./heartbeat-policy.js";
import {
  RUNTIME_HEALTH_SEVERITY,
  type RuntimeHealthFinding,
  type RuntimeHealthHumanContext,
} from "./runtime-health-contract.js";
import {
  type RuntimeCompensationTransitionKind,
  resolveInflightTaskTransitionForTracking,
  resolveRuntimeTaskResultDeliverySemantic,
  resolveTaskResultTransitionForPayloadStatus,
} from "./runtime-task-lifecycle-contract.js";

const normalizeHumanContext = (
  humanContext: RuntimeHealthHumanContext | null | undefined
): RuntimeHealthHumanContext | null =>
  humanContext && Object.keys(humanContext).length > 0 ? humanContext : null;

export const buildRuntimeHeartbeatUnhealthyFinding = (input: {
  humanContext?: RuntimeHealthHumanContext | null;
}): RuntimeHealthFinding => ({
  reasonCode: "runtime.heartbeat_unhealthy",
  severity: RUNTIME_HEALTH_SEVERITY.warn,
  summaryKey: "runtime.heartbeat_unhealthy",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const buildRuntimeReplayStuckFinding = (input: {
  humanContext?: RuntimeHealthHumanContext | null;
}): RuntimeHealthFinding => ({
  reasonCode: "runtime.replay_stuck",
  severity: RUNTIME_HEALTH_SEVERITY.warn,
  summaryKey: "runtime.replay_stuck",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const buildRuntimeCompensationStuckFinding = (input: {
  humanContext?: RuntimeHealthHumanContext | null;
}): RuntimeHealthFinding => ({
  reasonCode: "runtime.compensation_stuck",
  severity: RUNTIME_HEALTH_SEVERITY.warn,
  summaryKey: "runtime.compensation_stuck",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const buildRuntimeTransitionContractViolationFinding = (input: {
  humanContext?: RuntimeHealthHumanContext | null;
}): RuntimeHealthFinding => ({
  reasonCode: "runtime.transition_contract_violation",
  severity: RUNTIME_HEALTH_SEVERITY.error,
  summaryKey: "runtime.transition_contract_violation",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const buildRuntimeResultMappingViolationFinding = (input: {
  humanContext?: RuntimeHealthHumanContext | null;
}): RuntimeHealthFinding => ({
  reasonCode: "runtime.result_mapping_violation",
  severity: RUNTIME_HEALTH_SEVERITY.error,
  summaryKey: "runtime.result_mapping_violation",
  humanContext: normalizeHumanContext(input.humanContext),
});

export const resolveRuntimeHeartbeatHealthFinding = (input: {
  externalState: ExternalHealthState;
  humanContext?: RuntimeHealthHumanContext | null;
  runtimeState: RuntimeHealthState;
}): RuntimeHealthFinding | null => {
  const expectedExternalState = mapRuntimeHealthToExternalHealth(
    input.runtimeState
  );
  const expectedReasonCode = resolveHealthReasonCode(input.runtimeState);
  if (
    expectedExternalState === input.externalState &&
    expectedReasonCode === resolveHealthReasonCode(input.runtimeState) &&
    (input.runtimeState === "healthy" || input.runtimeState === "idle")
  ) {
    return null;
  }
  return buildRuntimeHeartbeatUnhealthyFinding({
    humanContext: input.humanContext,
  });
};

export const resolveRuntimeReplayStuckHealthFinding = (input: {
  hasReplayCandidates: boolean;
  humanContext?: RuntimeHealthHumanContext | null;
  oldestReplayAgeMs: number | null;
  staleAfterMs: number;
}): RuntimeHealthFinding | null => {
  if (
    !input.hasReplayCandidates ||
    typeof input.oldestReplayAgeMs !== "number" ||
    input.oldestReplayAgeMs < input.staleAfterMs
  ) {
    return null;
  }
  return buildRuntimeReplayStuckFinding({
    humanContext: input.humanContext,
  });
};

export const resolveRuntimeCompensationStuckHealthFinding = (input: {
  humanContext?: RuntimeHealthHumanContext | null;
  transitionKind: RuntimeCompensationTransitionKind;
}): RuntimeHealthFinding | null => {
  if (input.transitionKind !== "exhaust_failed_compensation") {
    return null;
  }
  return buildRuntimeCompensationStuckFinding({
    humanContext: input.humanContext,
  });
};

export const resolveRuntimeTrackingTransitionContractViolation = (input: {
  hasInflightTask: boolean;
  humanContext?: RuntimeHealthHumanContext | null;
}): RuntimeHealthFinding | null => {
  try {
    resolveInflightTaskTransitionForTracking({
      hasInflightTask: input.hasInflightTask,
    });
    return null;
  } catch {
    return buildRuntimeTransitionContractViolationFinding({
      humanContext: input.humanContext,
    });
  }
};

export const resolveRuntimeTaskResultTransitionContractViolation = (input: {
  humanContext?: RuntimeHealthHumanContext | null;
  payloadStatus: OpenMeldDaemonTaskResultPayload["status"];
}): RuntimeHealthFinding | null => {
  try {
    resolveTaskResultTransitionForPayloadStatus({
      payloadStatus: input.payloadStatus,
    });
    return null;
  } catch {
    return buildRuntimeTransitionContractViolationFinding({
      humanContext: input.humanContext,
    });
  }
};

export const resolveRuntimeResultMappingViolation = (input: {
  expectedSuccessLike: boolean;
  humanContext?: RuntimeHealthHumanContext | null;
  payloadStatus: OpenMeldDaemonTaskResultPayload["status"];
}): RuntimeHealthFinding | null => {
  const runtimeSemantic = resolveRuntimeTaskResultDeliverySemantic({
    payloadStatus: input.payloadStatus,
  });
  if (runtimeSemantic.successLike === input.expectedSuccessLike) {
    return null;
  }
  return buildRuntimeResultMappingViolationFinding({
    humanContext: input.humanContext,
  });
};
