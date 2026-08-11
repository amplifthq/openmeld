export const DEFAULT_REMOTE_AGENT_DAILY_ADMISSION_LIMIT = 200;

export const REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE =
  "remote_agent.daily_quota_exceeded";

export const REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_MESSAGE =
  "This Organization has reached its daily Remote Agent request limit. The limit resets at 00:00 UTC.";

export const REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_ROUTINE_REASON =
  "the Organization has reached its daily Remote Agent request limit. The limit resets at 00:00 UTC.";

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

export function resolveRemoteAgentDailyAdmissionLimit(
  configuredLimit: string | undefined
): number {
  const normalized = configuredLimit?.trim();
  if (!(normalized && POSITIVE_INTEGER_PATTERN.test(normalized))) {
    return DEFAULT_REMOTE_AGENT_DAILY_ADMISSION_LIMIT;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REMOTE_AGENT_DAILY_ADMISSION_LIMIT;
}
