import { getSpaceUpdatesResponseSchema } from "@openmeld/schemas";
import type { GetSpaceUpdatesResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { currentSpaceAddressingHeaders } from "./addressing-contract";
import { buildSpaceUpdatesPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function getSpaceUpdates(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    afterSignalId: string;
    limit: number;
  }
): Promise<GetSpaceUpdatesResponse> {
  return await client.requestJson({
    url: buildSpaceUpdatesReadPath({
      afterSignalId: input.afterSignalId,
      limit: input.limit,
      spaceId: input.spaceId,
    }),
    operation: "space.updates.read",
    headers: currentSpaceAddressingHeaders(),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceUpdatesResponseSchema,
    invalidMessage: "Unexpected response: expected { signals }",
  });
}

export function buildSpaceUpdatesReadPath(input: {
  spaceId: string;
  afterSignalId: string;
  limit: number;
}): string {
  const afterSignalId = input.afterSignalId.trim();
  if (afterSignalId.length === 0) {
    throw new Error("afterSignalId is required");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("limit must be a positive integer");
  }

  const url = new URL(
    buildSpaceUpdatesPath(input.spaceId),
    "https://openmeld.local"
  );
  url.searchParams.set("afterSignalId", afterSignalId);
  url.searchParams.set("limit", String(input.limit));

  return `${url.pathname}${url.search}`;
}
