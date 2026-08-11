export function buildAgentCheckResult(input: {
  code: string;
  status: "ok" | "needs_attention" | "blocked";
  reason: string;
  nextSteps: string[];
  humanActionRequired: boolean;
  canContinueAfterFix: boolean;
  details?: Record<string, unknown>;
}): {
  code: string;
  status: "ok" | "needs_attention" | "blocked";
  reason: string;
  nextSteps: string[];
  humanActionRequired: boolean;
  canContinueAfterFix: boolean;
  details?: Record<string, unknown>;
} {
  return {
    code: input.code,
    status: input.status,
    reason: input.reason,
    nextSteps: input.nextSteps,
    humanActionRequired: input.humanActionRequired,
    canContinueAfterFix: input.canContinueAfterFix,
    ...(input.details ? { details: input.details } : {}),
  };
}
