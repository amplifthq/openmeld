export function buildAgentProfileWorkRecoveryRoute(
  agentProfileId: string
): string {
  return `/v1/agent-profiles/${encodeURIComponent(agentProfileId)}/work-recovery`;
}
