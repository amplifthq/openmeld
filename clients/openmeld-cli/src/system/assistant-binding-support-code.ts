// Success-class reason codes describe a healthy sub-fact, not a failure.
// Agent execution readiness assembles reason codes in the fixed order
// profile -> binding -> localService -> service -> runtime -> claim ..., so a
// clean profile plus a healthy Binding surfaces the success code
// `agent_profile_binding.command_eligible` as element [0] while the real
// blockers (route.*/service.* codes) come later. Showing a success code as the
// support code for a failed or unavailable Binding is error swallowing, so
// filter these out before choosing what to show a user.
const SUCCESS_CLASS_REASON_CODES: ReadonlySet<string> = new Set([
  "agent_profile_binding.command_eligible",
  "claim.not_checked",
]);

// Prefixes for reason codes that name an actual execution blocker. When a
// blocking code is present it is preferred over any remaining non-blocking
// code so the user sees the code that explains why the Binding is not runnable.
const BLOCKING_REASON_CODE_PREFIXES: readonly string[] = [
  "route.",
  "service.",
  "agent_execution.",
  "local_service.",
];

const FALLBACK_SUPPORT_CODE = "agent_profile_binding.unavailable";

/**
 * Choose the truthful support/reason code to show for a failed or unavailable
 * Assistant Binding.
 *
 * - Drops success-class codes (a success code must never be presented as the
 *   reason a Binding failed).
 * - Prefers an actual blocking code (route.*, service.*, agent_execution.*,
 *   local_service.*) when one survives filtering.
 * - Falls back to the first remaining code, then to the `reason` field
 *   (e.g. `local_execution_evidence_unavailable`), then to a stable default.
 */
export function selectAssistantBindingSupportCode(input: {
  reason?: string | null;
  reasonCodes: readonly string[];
}): string {
  const meaningfulCodes = input.reasonCodes
    .map((code) => code.trim())
    .filter((code) => code.length > 0 && !SUCCESS_CLASS_REASON_CODES.has(code));

  const blockingCode = meaningfulCodes.find((code) =>
    isBlockingReasonCode(code)
  );
  if (blockingCode) {
    return blockingCode;
  }

  const firstMeaningfulCode = meaningfulCodes[0];
  if (firstMeaningfulCode) {
    return firstMeaningfulCode;
  }

  const reason = input.reason?.trim();
  if (reason) {
    return reason;
  }

  return FALLBACK_SUPPORT_CODE;
}

function isBlockingReasonCode(code: string): boolean {
  return BLOCKING_REASON_CODE_PREFIXES.some((prefix) =>
    code.startsWith(prefix)
  );
}
