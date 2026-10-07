import { centerAgentConnectorConnectionSelectionSchema } from "@openmeld/schemas";
import type { ConnectorConnection } from "@openmeld/schemas/types";
import type { ConnectorExecutionConfig } from "./open-connector-runtime";

const REPOSITORY_PART = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

/** Trusted host adapter for native Git read traffic. The Computer owner binds
 * the request to its operation and repository before calling this function.
 * authorize must recheck execution access AND resolve the current connection
 * through Core, with includeAccessPolicy: true, on every exchange.
 * No credentials or reusable execution authority are returned to the caller. */
type GitConnectionTransportInput = {
  request: Request;
  endpoint: "info/refs" | "git-upload-pack";
  owner: string;
  repo: string;
  organizationId: string;
  requesterUserId: string;
  operationId: string;
  connection: ConnectorConnection;
  authorize: () => Promise<unknown>;
  connectorExecution: ConnectorExecutionConfig;
};

export async function forwardGitConnectionRequest(
  input: GitConnectionTransportInput
): Promise<Response> {
  const { request, endpoint, connection } = input;
  const advertise = endpoint === "info/refs";
  if (!isGitReadRequest(input)) {
    return failure(400, "Invalid Git read request.");
  }
  const protocol = request.headers.get("git-protocol");
  const denied = await checkGitConnection(input);
  if (denied) {
    return denied;
  }
  const { baseUrl, runtimeToken } = input.connectorExecution;
  if (!(baseUrl && runtimeToken)) {
    return failure(503, "Git transfer runtime is unavailable.");
  }
  const url = new URL(
    `/v1/openmeld/git-connections/${input.owner}/${input.repo}/${endpoint}`,
    baseUrl
  );
  if (advertise) {
    url.search = "service=git-upload-pack";
  }
  const headers = new Headers({
    authorization: `Bearer ${runtimeToken}`,
    "x-openmeld-organization-id": input.organizationId,
    "x-openmeld-requester-user-id": input.requesterUserId,
    "x-openmeld-operation-id": input.operationId,
    "x-openmeld-repository": `${input.owner}/${input.repo}`,
    "x-openmeld-connection-scope": connection.scope,
    "x-oo-connector-alias": connection.connectionName,
  });
  if (protocol) {
    headers.set("git-protocol", protocol);
  }
  if (!advertise) {
    headers.set("content-type", "application/x-git-upload-pack-request");
    const contentEncoding = request.headers.get("content-encoding");
    if (contentEncoding) {
      headers.set("content-encoding", contentEncoding);
    }
  }
  let upstream: Response;
  try {
    upstream = await (input.connectorExecution.fetch ?? fetch)(url, {
      method: request.method,
      headers,
      body: advertise ? undefined : request.body,
      signal: request.signal,
      redirect: "manual",
      ...(advertise ? {} : { duplex: "half" }),
    } as RequestInit);
  } catch {
    return failure(502, "GitHub transfer could not start.");
  }
  const contentType = advertise
    ? "application/x-git-upload-pack-advertisement"
    : "application/x-git-upload-pack-result";
  if (
    !(upstream.ok && upstream.body) ||
    upstream.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== contentType
  ) {
    await upstream.body?.cancel();
    return failure(
      upstream.status === 403 ? 403 : 502,
      "GitHub did not accept the Git transfer."
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}

function failure(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function checkGitConnection(
  input: GitConnectionTransportInput
): Promise<Response | undefined> {
  const { connection } = input;
  try {
    const selected = centerAgentConnectorConnectionSelectionSchema.parse(
      await input.authorize()
    );
    const current = selected.connection;
    if (
      !current ||
      (selected.permission !== "read" && selected.permission !== "write") ||
      selected.selection !==
        (connection.scope === "member" ? "requester" : "shared") ||
      current.status !== "active" ||
      connection.status !== "active" ||
      current.service !== "github" ||
      connection.service !== "github" ||
      current.organizationId !== input.organizationId ||
      current.organizationId !== connection.organizationId ||
      current.scope !== connection.scope ||
      current.userId !== connection.userId ||
      (current.scope === "member" &&
        current.userId !== input.requesterUserId) ||
      current.connectionName !== connection.connectionName ||
      current.updatedAtMs !== connection.updatedAtMs
    ) {
      return failure(
        403,
        "GitHub connection access changed. Select the connection again in Plugins."
      );
    }
  } catch {
    return failure(403, "Git transfer authorization is unavailable.");
  }
  return undefined;
}

function isGitReadRequest(input: GitConnectionTransportInput): boolean {
  const { request, endpoint } = input;
  if (
    !(
      REPOSITORY_PART.test(input.owner) &&
      REPOSITORY_PART.test(input.repo) &&
      [input.organizationId, input.requesterUserId, input.operationId].every(
        (value) => IDENTIFIER.test(value)
      )
    )
  ) {
    return false;
  }
  const protocol = request.headers.get("git-protocol");
  if (protocol && protocol !== "version=2") {
    return false;
  }
  const query = new URL(request.url).searchParams;
  if (endpoint === "info/refs") {
    return (
      request.method === "GET" &&
      query.size === 1 &&
      query.get("service") === "git-upload-pack"
    );
  }
  return (
    endpoint === "git-upload-pack" &&
    request.method === "POST" &&
    query.size === 0 &&
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/x-git-upload-pack-request"
  );
}
