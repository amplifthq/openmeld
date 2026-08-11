import {
  getPrepareReadinessQuerySchema,
  getPrepareReadinessResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildPrepareReadinessRoute } from "./routes";
import type {
  CreatePrepareReadinessApi,
  GetPrepareReadinessInput,
} from "./types";

function requireValidPrepareReadinessQuery(input: GetPrepareReadinessInput) {
  const parsed = getPrepareReadinessQuerySchema.safeParse({
    agentControllerRefs: input.agentControllerRefs,
    lane: input.lane,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Prepare readiness read query."
    );
  }
  return parsed.data;
}

function buildPrepareReadinessUrl(input: GetPrepareReadinessInput): string {
  const query = requireValidPrepareReadinessQuery(input);
  const searchParams = new URLSearchParams();
  searchParams.set("lane", query.lane);
  if (query.openMeldServiceRuntimeId) {
    searchParams.set(
      "openMeldServiceRuntimeId",
      query.openMeldServiceRuntimeId
    );
  }
  for (const agentControllerRef of query.agentControllerRefs ?? []) {
    searchParams.append("agentControllerRef", agentControllerRef);
  }

  return `${buildPrepareReadinessRoute(input.deviceId)}?${searchParams.toString()}`;
}

export const createPrepareReadinessApi: CreatePrepareReadinessApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    getReadiness: async (input) =>
      await client.requestJson({
        url: buildPrepareReadinessUrl(input),
        operation: "prepare_readiness.read",
        method: "GET",
        requestContext: input.requestContext,
        schema: getPrepareReadinessResponseSchema,
        invalidMessage: "Invalid Prepare readiness response.",
      }),
  };
};
