import type { ListCenterAgentTasksQuery } from "@openmeld/schemas/types";

const CENTER_AGENT_TASKS_PATH = "/v1/organizations/current/center-agent/tasks";

export function buildCenterAgentTasksPath(
  query: ListCenterAgentTasksQuery = {}
): string {
  const search = new URLSearchParams();
  if (query.cursor !== undefined) {
    search.set("cursor", query.cursor);
  }
  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }
  if (query.status !== undefined) {
    search.set("status", query.status);
  }
  const encodedQuery = search.toString();
  return encodedQuery.length > 0
    ? `${CENTER_AGENT_TASKS_PATH}?${encodedQuery}`
    : CENTER_AGENT_TASKS_PATH;
}

export function buildCenterAgentTaskPath(taskId: string): string {
  return `${CENTER_AGENT_TASKS_PATH}/${encodeURIComponent(taskId)}`;
}

export function buildCenterAgentTaskMessagesPath(taskId: string): string {
  return `${buildCenterAgentTaskPath(taskId)}/messages`;
}

export function buildCenterAgentTaskStopPath(taskId: string): string {
  return `${buildCenterAgentTaskPath(taskId)}/stop`;
}

export function buildCenterAgentTaskRetryPath(taskId: string): string {
  return `${buildCenterAgentTaskPath(taskId)}/retry`;
}
