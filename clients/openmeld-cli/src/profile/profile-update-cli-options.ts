export type ProfileUpdateCliOptions = {
  agentController?: string;
  agentControllerConversationId?: string;
  agentControllerPermissionMode?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  model?: string;
  name?: string;
  reasoningEffort?: string;
  workspaceMode?: string;
  workspacePath?: string;
};

export function hasExplicitProfileUpdateField(
  input: ProfileUpdateCliOptions
): boolean {
  return (
    typeof input.name === "string" ||
    typeof input.agentController === "string" ||
    typeof input.agentControllerConversationId === "string" ||
    typeof input.agentControllerPermissionMode === "string" ||
    typeof input.model === "string" ||
    typeof input.reasoningEffort === "string" ||
    typeof input.workspaceMode === "string" ||
    typeof input.workspacePath === "string"
  );
}
