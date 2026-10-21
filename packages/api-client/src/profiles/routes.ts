export function buildProfileRoute(profileId: string): string {
  return `/v1/profiles/${encodeURIComponent(profileId)}`;
}

export function buildAgentProfileDefaultProjectRoute(
  profileId: string
): string {
  return `/v1/agent-profiles/${encodeURIComponent(profileId)}/default-project`;
}

export function buildAgentProfileFoldersRoute(profileId: string): string {
  return `/v1/agent-profiles/${encodeURIComponent(profileId)}/folders`;
}
