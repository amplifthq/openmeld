import {
  AGENT_REPLY_FINAL_PURPOSE,
  REMOTE_AGENT_FAILURE_PURPOSE,
} from "@openmeld/schemas";

export function isFinalOutcomeTextPurpose(
  value: unknown
): value is
  | typeof AGENT_REPLY_FINAL_PURPOSE
  | typeof REMOTE_AGENT_FAILURE_PURPOSE {
  return (
    value === AGENT_REPLY_FINAL_PURPOSE ||
    value === REMOTE_AGENT_FAILURE_PURPOSE
  );
}
