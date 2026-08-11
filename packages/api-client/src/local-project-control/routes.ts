const CURRENT_PROJECTS_PATH = "/v1/local-runtimes/current/projects";

export type LocalProjectControlRoute =
  | "connect-candidate"
  | "connect-declared-path"
  | "connections/remove"
  | "connections/remove-missing"
  | "connections/set-default"
  | "discover";

export function buildLocalProjectControlPath(
  route: LocalProjectControlRoute
): string {
  return `${CURRENT_PROJECTS_PATH}/${route}`;
}
