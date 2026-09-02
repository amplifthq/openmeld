import { parseAgentControllerRef } from "./agent-controller-ref";

export const AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION = 2;

export type AgentControllerUsageLimitSupport =
  | "native"
  | "not_evaluated"
  | "passive"
  | "provider_scoped"
  | "unsupported";

const AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX = {
  "claude-code": "passive",
  codex: "native",
  cursor: "unsupported",
  "grok-build": "native",
  opencode: "provider_scoped",
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

export function resolveAgentControllerProviderUsageLimitSupport(input: {
  agentControllerRef: string;
  providerId: string;
}): AgentControllerUsageLimitSupport {
  const parsedRef = parseAgentControllerRef(input.agentControllerRef);
  if (parsedRef?.kind !== "builtin" || parsedRef.id !== "opencode") {
    return "not_evaluated";
  }
  return input.providerId === "opencode-go" ? "native" : "unsupported";
}

export function resolveAgentControllerUsageProviderId(input: {
  agentControllerRef: string;
  modelId?: string | null;
}): string | null {
  if (
    resolveAgentControllerUsageLimitSupport(input.agentControllerRef) !==
    "provider_scoped"
  ) {
    return null;
  }
  const separatorIndex = input.modelId?.indexOf("/") ?? -1;
  if (separatorIndex <= 0) {
    return null;
  }
  return input.modelId?.slice(0, separatorIndex).trim() || null;
}
