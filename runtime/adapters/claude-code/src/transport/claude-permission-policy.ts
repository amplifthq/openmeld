import type {
  AdapterDispatchExecutionMode,
  AgentControllerPermissionMode,
} from "@openmeld/adapter-core";

export const OPENMELD_CLAUDE_ALLOWED_TOOLS = [
  "Bash(openmeld)",
  "Bash(openmeld *)",
  "Bash(openmeld-dev)",
  "Bash(openmeld-dev *)",
  "Bash(openmeld-canary)",
  "Bash(openmeld-canary *)",
] as const;

export type ClaudeCodeAgentControllerPermissionMode = Extract<
  AgentControllerPermissionMode,
  `claude-code:${string}`
>;

export type ClaudePermissionModeValue =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan";

const CLAUDE_PERMISSION_MODE_BY_POLICY = {
  "claude-code:default": "default",
  "claude-code:acceptEdits": "acceptEdits",
  "claude-code:plan": "plan",
  "claude-code:auto": "auto",
  "claude-code:dontAsk": "dontAsk",
  "claude-code:bypassPermissions": "bypassPermissions",
} as const satisfies Partial<
  Record<AgentControllerPermissionMode, ClaudePermissionModeValue>
>;

export function resolveClaudeAgentControllerPermissionMode(
  value: unknown
): ClaudeCodeAgentControllerPermissionMode {
  switch (value) {
    case "claude-code:acceptEdits":
    case "claude-code:plan":
    case "claude-code:auto":
    case "claude-code:dontAsk":
    case "claude-code:bypassPermissions":
      return value;
    default:
      return "claude-code:default";
  }
}

export function resolveClaudePermissionMode(input: {
  deliveryOnly?: boolean;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  executionMode?: AdapterDispatchExecutionMode;
}): ClaudePermissionModeValue {
  // Non-delivery repair keeps its isolated policy. Missing-action correction
  // and concurrent reply review enforce the existing delivery-only toolset.
  if (input.executionMode === "repair" && !input.deliveryOnly) {
    return "plan";
  }

  return CLAUDE_PERMISSION_MODE_BY_POLICY[
    resolveClaudeAgentControllerPermissionMode(
      input.agentControllerPermissionMode
    )
  ];
}
