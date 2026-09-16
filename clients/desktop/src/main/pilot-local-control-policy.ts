// Exact Gateway route families. The pilot permits local Start/Stop only through
// account-checked IPC; shared Web continues to use these management APIs.
const LOCAL_CONTROL_ROUTES = [
  ["POST", "/v1/devices/:deviceId/forget"],
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
  ["POST", "/v1/people-computers/:deviceId/lanes/:runtimeLane/folders/select"],
  [
    "POST",
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/projects/discover",
  ],
  ["POST", "/v1/prepare/sessions"],
  ["POST", "/v1/prepare/sessions/:sessionId/token"],
  ["POST", "/v1/prepare/sessions/resolve-token"],
  ["PUT", "/v1/prepare/sessions/:sessionId/agent-selection"],
  ["PATCH", "/v1/prepare/sessions/:sessionId/setup-bootstrap"],
  ["PUT", "/v1/prepare/sessions/:sessionId/terminal-step"],
] as const;

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
