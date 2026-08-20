const AGENT_ACTIVITY_SNAPSHOT_PATH = "/v1/organizations/current/agent-activity";
const AGENT_ACTIVITY_SESSIONS_PATH =
  "/v1/organizations/current/agent-activity/sessions";
const AGENT_ACTIVITY_STATS_PATH =
  "/v1/organizations/current/agent-activity/stats";

export function buildAgentActivitySnapshotPath(
  query: {
    includeProviderMetadata?: boolean;
    memberUserId?: string;
    projectId?: string;
    provider?: string;
    status?: string;
  } = {}
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  return suffix
    ? `${AGENT_ACTIVITY_SNAPSHOT_PATH}?${suffix}`
    : AGENT_ACTIVITY_SNAPSHOT_PATH;
}

export function buildAgentActivitySessionsPath(
  query: {
    cursor?: string;
    limit?: number;
    memberUserId?: string;
    nativeSessionId?: string;
    origin?: string;
    projectId?: string;
    provider?: string;
    query?: string;
    status?: string;
  } = {}
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  return suffix
    ? `${AGENT_ACTIVITY_SESSIONS_PATH}?${suffix}`
    : AGENT_ACTIVITY_SESSIONS_PATH;
}
export function buildAgentActivityStatsPath(
  query: { projectId?: string } = {}
): string {
  const search = new URLSearchParams();
  if (query.projectId !== undefined) {
    search.set("projectId", query.projectId);
  }
  const suffix = search.toString();
  return suffix
    ? `${AGENT_ACTIVITY_STATS_PATH}?${suffix}`
    : AGENT_ACTIVITY_STATS_PATH;
}
