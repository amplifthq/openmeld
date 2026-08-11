export type DispatchContinuityStatus =
  | "explicit_heal"
  | "fresh_context"
  | "implicit_rotation"
  | "stable_resume";

export type DispatchContinuityObservation = {
  existingContextId: string | null;
  resolvedContextId: string | null;
  shouldWarn: boolean;
  status: DispatchContinuityStatus;
};

export function resolveDispatchContinuityObservation(input: {
  contextHealed: boolean;
  existingContextId: string | null;
  resolvedContextId: string | null;
}): DispatchContinuityObservation | null {
  const existingContextId = normalizeOptionalContextId(input.existingContextId);
  const resolvedContextId = normalizeOptionalContextId(input.resolvedContextId);
  if (!resolvedContextId) {
    return null;
  }
  if (!existingContextId) {
    return {
      existingContextId,
      resolvedContextId,
      shouldWarn: false,
      status: "fresh_context",
    };
  }
  if (existingContextId === resolvedContextId) {
    return {
      existingContextId,
      resolvedContextId,
      shouldWarn: false,
      status: "stable_resume",
    };
  }
  if (input.contextHealed) {
    return {
      existingContextId,
      resolvedContextId,
      shouldWarn: false,
      status: "explicit_heal",
    };
  }
  return {
    existingContextId,
    resolvedContextId,
    shouldWarn: true,
    status: "implicit_rotation",
  };
}

function normalizeOptionalContextId(
  contextId: string | null | undefined
): string | null {
  const normalized = contextId?.trim();
  return normalized ? normalized : null;
}
