import {
  resolveMappedPublicAgentFailureReason,
  shouldPreferMappedPublicAgentFailureReason,
} from "@openmeld/schemas";

type PublicAgentFailureReasonInput = {
  defaultReason?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  targetLabel?: string | null;
};

export function resolvePublicAgentFailureReason(
  input: PublicAgentFailureReasonInput
): string | null {
  const errorCode = normalizeOptionalText(input.errorCode)?.toLowerCase();
  const mappedReason = resolveMappedPublicAgentFailureReason(
    input.errorCode,
    input.targetLabel
  );
  if (
    shouldPreferMappedPublicAgentFailureReason(errorCode, input.errorMessage)
  ) {
    return mappedReason ?? normalizeOptionalText(input.defaultReason);
  }

  if (!errorCode) {
    return normalizeOptionalText(input.defaultReason);
  }
  return mappedReason ?? normalizeOptionalText(input.defaultReason);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
