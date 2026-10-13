import { spacePublishedDispatchResultSchema } from "@openmeld/schemas";
import { fetchSpaceDispatchTrace } from "../config/space-dispatch-trace-api";
import type { SpaceApi } from "./cli-space-api";
import { toStructuredGatewayFailure } from "./gateway-response";
import { fetchSpaceDispatchResult } from "./result-api";

export async function readSpaceResult(
  input: Parameters<typeof fetchSpaceDispatchResult>[0] & {
    spaceApi: Pick<SpaceApi, "listSignalEnvelopes">;
  }
) {
  try {
    return {
      source: "archive" as const,
      result: await fetchSpaceDispatchResult(input),
    };
  } catch (error) {
    const failure = toStructuredGatewayFailure(error);
    const missing =
      failure.code === "space.dispatch_result.not_found" ||
      (failure.code === "upstream_error" &&
        failure.message.trim().toLowerCase() === "dispatch result not found");
    if (!input.dispatchId || failure.status !== 404 || !missing) {
      throw error;
    }
  }

  const trace = await fetchSpaceDispatchTrace({
    ...input,
    dispatchId: input.dispatchId,
    includeRemoteAgentRuntimeDiagnostics: false,
    includeServiceConnectionDiagnostics: false,
  });
  if (
    trace.query.dispatchId !== input.dispatchId ||
    trace.query.spaceId !== input.space
  ) {
    throw new Error(
      "Dispatch result trace does not match the requested execution."
    );
  }
  const execution = trace.nativeDeliveryTrace ?? trace.trace;
  const visible = execution?.finalVisibleMessage;
  const outcome = execution?.finalVisibleOutcome;
  if (
    !(visible && outcome?.delivered) ||
    outcome.signalId !== visible.signalId
  ) {
    const state =
      trace.nativeDeliveryTrace?.turn.status ??
      trace.trace?.nativeDelivery?.status ??
      outcome?.status ??
      "not_found";
    throw Object.assign(
      new Error(
        `No final Space message is available. Execution/publication state: ${state}. Use service trace for details.`
      ),
      {
        code: "space.result.not_published",
        status: 409,
      }
    );
  }
  if (visible.dispatchId !== input.dispatchId) {
    throw new Error(
      "Dispatch result trace does not match the requested execution."
    );
  }
  const history = await input.spaceApi.listSignalEnvelopes({
    spaceId: input.space,
    requestContext: input.requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
    query: { aroundSignalId: visible.signalId, beforeCount: 0, afterCount: 0 },
  });
  const signal = history.envelopes.find(
    (candidate) => candidate.id === visible.signalId
  );
  if (
    !signal ||
    signal.spaceId !== input.space ||
    signal.type !== visible.signalType ||
    signal.profile.profileId !== visible.profileId
  ) {
    throw Object.assign(
      new Error(
        "The final Space message could not be read or did not match its execution. Use service trace for details."
      ),
      {
        code: "space.result.message_unavailable",
        status: 409,
      }
    );
  }
  return {
    source: "published_message" as const,
    result: spacePublishedDispatchResultSchema.parse({
      source: "published_message",
      spaceId: input.space,
      dispatchId: input.dispatchId,
      outcome,
      signal,
    }),
  };
}
