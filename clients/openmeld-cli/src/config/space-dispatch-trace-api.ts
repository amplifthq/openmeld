import {
  type OpenMeldRequestContext,
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION,
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_HEADER,
  type SpaceDispatchTraceResponse,
  spaceDispatchTraceResponseSchema,
} from "@openmeld/schemas";
import { toSpaceDispatchTraceUrl } from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "../space/fetch-with-timeout";
import { buildOpenMeldRequestContextHeadersWithAuth } from "./request-headers";

export async function fetchSpaceDispatchTrace(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  dispatchId: string;
  includeRemoteAgentRuntimeDiagnostics?: boolean;
  password?: string;
}): Promise<SpaceDispatchTraceResponse> {
  const endpoint = toSpaceDispatchTraceUrl(
    input.baseUrl,
    input.space,
    input.dispatchId,
    input.includeRemoteAgentRuntimeDiagnostics === true
      ? { includeRemoteAgentRuntimeDiagnostics: true }
      : {}
  );
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.dispatch_trace",
    init: {
      headers: {
        ...(await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: endpoint,
          requestContext: input.requestContext,
          spacePassword: input.password,
        })),
        [SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_HEADER]: String(
          SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION
        ),
      },
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw}`);
  }

  const parsed = spaceDispatchTraceResponseSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const issuePath =
      firstIssue && firstIssue.path.length > 0
        ? firstIssue.path.map((part) => String(part)).join(".")
        : "<root>";
    const issueMessage = firstIssue?.message ?? "Unknown schema mismatch";
    throw new Error(
      `invalid space dispatch trace response at ${issuePath}: ${issueMessage}`
    );
  }
  return parsed.data;
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
