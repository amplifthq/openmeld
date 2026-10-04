import { REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE } from "@openmeld/schemas";

export const REMOTE_AGENT_TOOL_RESULT_MAX_BYTES = 128 * 1024;
// Model presentation is cheaper than passing every transport-sized result back
// on every turn. Code Mode's internal computation keeps the transport budget.
export const REMOTE_AGENT_TOOL_RESULT_PRESENTATION_MAX_BYTES = 32 * 1024;

const REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_MESSAGE =
  "This tool returned more data than Center Agent can safely process at once. Narrow the request with search, filters, pagination, or segmented file reads, then continue.";

export class RemoteAgentToolResultTooLargeError extends Error {
  readonly limitBytes = REMOTE_AGENT_TOOL_RESULT_MAX_BYTES;
  readonly reasonCode = REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE;
  readonly toolName: string;

  constructor(toolName: string) {
    super(
      `${REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE}: ${REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_MESSAGE} Tool: ${toolName}. Limit: ${REMOTE_AGENT_TOOL_RESULT_MAX_BYTES} UTF-8 bytes.`
    );
    this.name = "RemoteAgentToolResultTooLargeError";
    this.toolName = toolName;
  }
}

export function isRemoteAgentToolResultWithinBudget(
  value: unknown,
  maxBytes = REMOTE_AGENT_TOOL_RESULT_MAX_BYTES
): boolean {
  const serializedValue = JSON.stringify(value);
  return (
    serializedValue === undefined ||
    new TextEncoder().encode(serializedValue).byteLength <= maxBytes
  );
}

export function isRemoteAgentToolResultWithinLimit(value: unknown): boolean {
  return isRemoteAgentToolResultWithinBudget(value);
}
