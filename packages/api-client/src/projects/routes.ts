const PROJECTS_PATH = "/v1/organizations/current/projects";

export function buildProjectsPath(): string {
  return PROJECTS_PATH;
}

export function buildProjectPath(projectId: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(projectId)}`;
}
