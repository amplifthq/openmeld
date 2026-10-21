import { AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE } from "@openmeld/agent-runtime";
import type { PublicWakeabilityReason } from "@openmeld/schemas";
import type {
  AgentControllerUsageLimits,
  GetAgentExecutionReadinessResponse,
} from "@openmeld/schemas/types";

type WakeAvailability = Pick<
  GetAgentExecutionReadinessResponse["agentWakeAvailability"],
  "category" | "reasonCode"
>;

// Exact owner-side Wakeability reasons that may be named to other
// Organization members. Anything else stays the generic public state.
const UNAVAILABLE_REASON_MAP: Readonly<
  Record<
    string,
    | "harness_turned_off"
    | "no_subscription"
    | "no_working_folder"
    | "not_signed_in"
    | "org_disabled"
  >
> = {
  "controller.auth.unauthenticated": "not_signed_in",
  "controller.registry.disabled": "harness_turned_off",
  "profile.workspace.missing": "no_working_folder",
  "provider_account.organization_access_disabled": "org_disabled",
  "provider_account.subscription_access_unavailable": "no_subscription",
};

/**
 * Project the one public blocking reason from the owner's current
 * Wakeability verdict. The mapping only renames an exact owner reason; it
 * never infers one. `version_too_old` has no current Wakeability evidence
 * (the controller-version model check runs only at Profile creation), so it
 * is never produced here.
 */
export function resolvePublicWakeabilityReason(input: {
  availability: WakeAvailability;
  usageResetAt?: string | null;
}): PublicWakeabilityReason | null {
  const { category, reasonCode } = input.availability;
  if (category === "offline") {
    return { code: "computer_offline" };
  }
  if (category !== "unavailable" || !reasonCode) {
    return null;
  }
  if (reasonCode === AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE) {
    return { code: "usage_exhausted", resetAt: input.usageResetAt ?? null };
  }
  const code = UNAVAILABLE_REASON_MAP[reasonCode];
  return code ? { code } : null;
}

/** The earliest future reset among current exhausted Usage Limits. */
export function resolveUsageExhaustedResetAt(input: {
  nowMs: number;
  usageLimits: AgentControllerUsageLimits;
}): string | null {
  let earliest: number | null = null;
  for (const limit of input.usageLimits) {
    if (limit.status !== "exhausted" || !limit.resetsAt) {
      continue;
    }
    const resetsAtMs = Date.parse(limit.resetsAt);
    if (
      Number.isFinite(resetsAtMs) &&
      resetsAtMs > input.nowMs &&
      (earliest === null || resetsAtMs < earliest)
    ) {
      earliest = resetsAtMs;
    }
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}
