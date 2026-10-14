// Local Computer configuration remains Web-only. Forget uses cloud account
// authorization, not the local Service proxy. Working-folder operations use
// exact native account/device/lane admission; Start/Stop use protected IPC.
const LOCAL_CONTROL_ROUTES = [
  ["POST", "/v1/devices/current/forget"],
  ["PUT", "/v1/devices/:deviceId/observed-metadata"],
  ["POST", "/v1/local-runtimes/:deviceId/enrollment"],
  ["PUT", "/v1/local-runtimes/:deviceId/display-name"],
  ["PUT", "/v1/local-runtimes/current/observed-metadata"],
  ["PUT", "/v1/local-runtimes/current/file-access"],
  ["POST", "/v1/local-runtimes/current/folder-picker"],
  ["PUT", "/v1/local-runtimes/current/agent-profiles/:profileId/workspace"],
  ...[
    "discover",
    "connect-candidate",
    "connect-declared-path",
    "connections/set-default",
    "connections/remove",
    "connections/remove-missing",
  ].map((action) => ["POST", `/v1/local-runtimes/current/projects/${action}`]),
  ...[
    "/v1/local-runtimes/current",
    "/v1/people-computers/:deviceId/lanes/:runtimeLane",
  ].flatMap((base) => [
    ["PUT", `${base}/local-agents/:agentId/enabled`],
    ["PUT", `${base}/local-agents/:agentId/installations`],
    ["POST", `${base}/local-agents/refresh-catalog`],
    ["POST", `${base}/openmeld-tools/update`],
    ["PUT", `${base}/openmeld-tools/maintenance`],
  ]),
  ["PUT", "/v1/people-computers/:deviceId/lanes/:runtimeLane/file-access"],
  ["POST", "/v1/prepare/sessions"],
  ["POST", "/v1/prepare/sessions/:sessionId/token"],
  ["POST", "/v1/prepare/sessions/resolve-token"],
  ["PUT", "/v1/prepare/sessions/:sessionId/agent-selection"],
  ["PATCH", "/v1/prepare/sessions/:sessionId/setup-bootstrap"],
  ["PUT", "/v1/prepare/sessions/:sessionId/terminal-step"],
] as const;

export function desktopComputerOperationTarget(url: URL, method: string) {
  const segments = url.pathname.split("/").map(decodeURIComponent);
  if (
    segments.length < 7 ||
    segments[1] !== "v1" ||
    segments[2] !== "people-computers" ||
    segments[4] !== "lanes"
  ) {
    return null;
  }
  const action = segments.slice(6).join("/");
  const permitted =
    method === "POST" &&
    [
      "folders/select",
      "projects/discover",
      "projects/connect-candidate",
      "projects/connect-declared-path",
      "projects/connections/set-default",
    ].includes(action);
  const workspace =
    method === "PUT" &&
    segments.length === 9 &&
    segments[6] === "agent-profiles" &&
    Boolean(segments[7]) &&
    segments[8] === "workspace";
  const installationUpdate =
    segments.length === 9 &&
    segments[6] === "local-agents" &&
    Boolean(segments[7]) &&
    ["GET", "POST"].includes(method) &&
    segments[8] === "installation-update";
  return permitted || workspace || installationUpdate
    ? { deviceId: segments[3], runtimeLane: segments[5] }
    : null;
}

export function isPilotLocalControlRequest(url: URL, method: string): boolean {
  // Match decoded segments individually so encoded static route names cannot
  // evade the policy, without turning an encoded slash in a parameter into a path.
  const segments = url.pathname.split("/").map(decodeURIComponent);
  if (
    (method === "GET" || method === "HEAD") &&
    segments.join("/") === "/v1/local-runtimes" &&
    url.searchParams.has("connectionIdentityAdoption")
  ) {
    return true;
  }
  return LOCAL_CONTROL_ROUTES.some(([verb, pattern]) => {
    const expected = pattern.split("/");
    return (
      method === verb &&
      segments.length === expected.length &&
      expected.every((part, index) =>
        part.startsWith(":")
          ? Boolean(segments[index])
          : segments[index] === part
      )
    );
  });
}
