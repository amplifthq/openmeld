import { spaceBootstrapResponseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceBootstrapPath } from "./routes";
import { buildSpaceSignalsReadSearchParams } from "./signals";
import type { SpaceRequestInput, SpaceSignalsReadQuery } from "./types";

export async function getSpaceBootstrap(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    historyQuery?: SpaceSignalsReadQuery;
    includeAgentStreamPresence?: boolean;
  }
) {
  return await client.requestJson({
    url: buildSpaceBootstrapReadPath(
      input.spaceId,
      input.historyQuery,
      input.includeAgentStreamPresence
    ),
    operation: "space.bootstrap.read",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceBootstrapResponseSchema,
    invalidMessage: "invalid space bootstrap response",
  });
}

export function buildSpaceBootstrapReadPath(
  spaceId: string,
  historyQuery?: SpaceSignalsReadQuery,
  includeAgentStreamPresence?: boolean
): string {
  const url = new URL(
    buildSpaceBootstrapPath(spaceId),
    "https://openmeld.local"
  );
  for (const [key, value] of buildSpaceSignalsReadSearchParams(historyQuery)) {
    url.searchParams.append(key, value);
  }
  if (includeAgentStreamPresence === true) {
    url.searchParams.set("includeAgentStreamPresence", "true");
  }
  return `${url.pathname}${url.search}`;
}
