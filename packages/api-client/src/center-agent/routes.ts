export function buildCenterAgentDesignationPath(): string {
  return "/v1/organizations/current/center-agent/designation";
}

export function buildCenterAgentModelPath(): string {
  return "/v1/organizations/current/center-agent/model";
}

export function buildCenterAgentOperatingStatePath(): string {
  return "/v1/organizations/current/center-agent/operating-state";
}

export function buildCenterAgentProfilePath(): string {
  return "/v1/organizations/current/center-agent/profile";
}

export function buildCenterAgentAuditJournalPath(): string {
  return "/v1/organizations/current/center-agent/audit-journal";
}

export function buildCenterAgentDirectMessageSpacePath(): string {
  return "/v1/organizations/current/center-agent/dm-space";
}

export function buildCenterAgentSessionsPath(): string {
  return "/v1/organizations/current/center-agent/sessions";
}

export function buildCenterAgentSessionPath(spaceId: string): string {
  return `${buildCenterAgentSessionsPath()}/${encodeURIComponent(spaceId)}`;
}

export function buildCenterAgentContextManifestPath(): string {
  return "/v1/organizations/current/center-agent/context-manifests";
}

export function buildCenterAgentContextLoadReceiptPath(
  manifestId: string
): string {
  return `${buildCenterAgentContextManifestPath()}/${encodeURIComponent(manifestId)}/load-receipt`;
}

export function buildCenterAgentSlackWorkspaceConnectionPath(): string {
  return "/v1/organizations/current/center-agent/slack-connection";
}

export function buildSlackIdentityLinkPreviewPath(): string {
  return "/v1/slack/identity-link/preview";
}

export function buildSlackIdentityLinkConsumePath(): string {
  return "/v1/slack/identity-link/consume";
}
