import { parseAgentControllerRef } from "./agent-controller-ref";

export const AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION = 1;

export type AgentControllerUsageLimitSupport =
  | "native"
  | "not_evaluated"
  | "passive"
  | "unsupported";

const AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX = {
  "claude-code": "passive",
  codex: "native",
  cursor: "unsupported",
  "grok-build": "native",
  opencode: "unsupported",
  openclaw: "not_evaluated",
} as const satisfies Record<string, AgentControllerUsageLimitSupport>;

export function resolveAgentControllerUsageLimitSupport(
  agentControllerRef: string
): AgentControllerUsageLimitSupport {
  const parsedRef = parseAgentControllerRef(agentControllerRef);
  if (parsedRef?.kind !== "builtin") {
    return "not_evaluated";
  }
  return (
    AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX[
      parsedRef.id as keyof typeof AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX
    ] ?? "not_evaluated"
  );
}
