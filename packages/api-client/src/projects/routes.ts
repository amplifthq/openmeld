const PROJECTS_PATH = "/v1/organizations/current/projects";

export function buildProjectsPath(): string {
  return PROJECTS_PATH;
}

export function buildProjectPath(projectId: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(projectId)}`;
}

export function buildProjectIssueRoutingPath(projectId: string): string {
  return `${buildProjectPath(projectId)}/issue-routing`;
}

export function buildProjectRepositoriesPath(projectId: string): string {
  return `${buildProjectPath(projectId)}/repositories`;
}

export function buildProjectCommonAgentsPath(projectId: string): string {
  return `${buildProjectPath(projectId)}/common-agents`;
}
