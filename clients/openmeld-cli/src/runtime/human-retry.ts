export type HumanRetryDecision = "cancel" | "stay" | "switch";

export function resolveHumanRetryDecision(input: {
  action: unknown;
  isCancelled: boolean;
}): HumanRetryDecision {
  const action = typeof input.action === "string" ? input.action : undefined;
  if (input.isCancelled || action === "cancel") {
    return "cancel";
  }
  if (action === "stay") {
    return "stay";
  }
  return "switch";
}
