export const ROUTINE_WORKFLOW_ERROR_NAMES = {
  callbackFinalization: "RoutineWorkflowCallbackFinalizationError",
  continuationCallbackFinalization:
    "RoutineWorkflowContinuationCallbackFinalizationError",
  continuationFailureFinalization:
    "RoutineWorkflowContinuationFailureFinalizationError",
  submission: "RoutineWorkflowSubmissionError",
} as const;

export const ROUTINE_WORKFLOW_CALLBACK_EVENTS = {
  continuation: "remote-agent-continuation-callback",
  initial: "remote-agent-initial-callback",
} as const;

export const ROUTINE_WORKFLOW_STEPS = {
  ensureSubmission: "ensure Remote Agent submission",
  finalizeCallback: "finalize Remote Agent callback",
  finalizeContinuationCallback: "finalize Center Agent continuation callback",
  finalizeContinuationFailure: "finalize Center Agent continuation failure",
  waitForCallback: "wait for Remote Agent callback",
  waitForContinuationCallback: "wait for Center Agent continuation callback",
} as const;
