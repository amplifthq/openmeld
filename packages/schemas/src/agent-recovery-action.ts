export const agentRecoveryActionLabels = {
  change_model: "Change model",
  check_status: "Check status",
  choose_local_agent: "Choose local agent",
  connect_openmeld_service: "Connect Computer",
  connect_local_agent: "Connect local agent",
  continue_in_default_folder: "Continue in the default folder",
  manage_local_agent: "Update or change local agent",
  manage_cursor_plan: "Manage Cursor plan",
  reconnect_openmeld_service: "Reconnect Computer",
  reconnect_local_agent: "Reconnect local agent",
  review_agent_permissions: "Review Agent Profile permissions",
  review_agent_settings: "Review agent settings",
  turn_on_local_agent: "Turn on local agent",
  update_openmeld_service: "Update OpenMeld on Computer",
  update_openmeld_skills: "Update OpenMeld skills",
} as const;

export type AgentRecoveryActionId = keyof typeof agentRecoveryActionLabels;

export function formatAgentRecoveryActionLabel(
  actionId: AgentRecoveryActionId
): string {
  return agentRecoveryActionLabels[actionId];
}

export function isAgentRecoveryConnectionAction(
  actionId: AgentRecoveryActionId
): boolean {
  return (
    actionId === "connect_openmeld_service" ||
    actionId === "reconnect_openmeld_service" ||
    actionId === "connect_local_agent" ||
    actionId === "reconnect_local_agent"
  );
}
