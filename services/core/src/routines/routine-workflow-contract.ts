export const ROUTINE_WORKFLOW_ERROR_NAMES = {
  callbackFinalization: "RoutineWorkflowCallbackFinalizationError",
  continuationCallbackFinalization:
    "RoutineWorkflowContinuationCallbackFinalizationError",
  continuationFailureFinalization:
    "RoutineWorkflowContinuationFailureFinalizationError",
  submission: "RoutineWorkflowSubmissionError",
} as const;

export function resolveRoutineWorkflowErrorName(
  error: { name: string; message: string } | undefined
):
  | (typeof ROUTINE_WORKFLOW_ERROR_NAMES)[keyof typeof ROUTINE_WORKFLOW_ERROR_NAMES]
  | null {
  if (!error) {
    return null;
  }
  // Workerd RPC serializes user-defined Error subclasses as Error, prefixing
  // the message with their original name. Recognize only our outer phase
  // envelope, never a nested cause or an arbitrary platform timeout.
  return (
    Object.values(ROUTINE_WORKFLOW_ERROR_NAMES).find(
      (name) =>
        error.name === name ||
        (error.name === "Error" && error.message.startsWith(`${name}: `))
    ) ?? null
  );
}

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
