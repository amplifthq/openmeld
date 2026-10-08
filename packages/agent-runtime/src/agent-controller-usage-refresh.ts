import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";

// Legacy unavailable observations lack a reason. Account capability and
// sign-in changes explicitly retire old measurements instead of keeping them.
export function isAgentControllerUsageRefreshUnavailable(
  limits: readonly AgentControllerUsageLimit[] | undefined
): boolean {
  const limit = limits?.length === 1 ? limits[0] : undefined;
  return (
    limit?.status === "unavailable" &&
    !isAgentControllerUsageAccountUnavailable(limits)
  );
}

export function isAgentControllerUsageAccountUnavailable(
  limits: readonly AgentControllerUsageLimit[] | undefined
): boolean {
  const limit = limits?.length === 1 ? limits[0] : undefined;
  return (
    limit?.status === "unavailable" &&
    (limit.reason === "not_applicable" || limit.reason === "not_authenticated")
  );
}
