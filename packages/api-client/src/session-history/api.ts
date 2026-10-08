import { sessionHistoryResultSchema } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SessionHistoryRpcInput,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export function createSessionHistoryApi(client: OpenMeldApiClientFoundation) {
  return {
    request: (
      input: Omit<SessionHistoryRpcInput, "context"> & {
        requestContext?: OpenMeldRequestContext;
        signal?: AbortSignal;
      }
    ) =>
      client.requestJson({
        method: "POST",
        operation: "computer.session-history",
        timeoutMs: 40_000,
        schema: sessionHistoryResultSchema,
        invalidMessage: "Invalid session history response.",
        url: `/v1/people-computers/${encodeURIComponent(input.deviceId)}/lanes/${encodeURIComponent(input.runtimeLane)}/session-history`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: input.organizationId,
          request: input.request,
          ...(input.execution ? { execution: input.execution } : {}),
        }),
        ...(input.requestContext
          ? { requestContext: input.requestContext }
          : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
  };
}
