import {
  executeExecutionRecoveryBodySchema,
  executeExecutionRecoveryResponseSchema,
  inspectExecutionRecoveryResponseSchema,
} from "@openmeld/schemas";
import type {
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  InspectExecutionRecoveryResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceExecutionRecoveryPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function inspectSpaceExecutionRecovery(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { dispatchId: string }
): Promise<InspectExecutionRecoveryResponse> {
  return await client.requestJson({
    invalidMessage: "invalid execution recovery response",
    method: "GET",
    operation: "space.execution_recovery.inspect",
    requestContext: input.requestContext,
    schema: inspectExecutionRecoveryResponseSchema,
    signal: input.signal,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    timeoutMs: input.timeoutMs,
    url: buildSpaceExecutionRecoveryPath(input.spaceId, input.dispatchId),
  });
}

export async function executeSpaceExecutionRecovery(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    body: ExecuteExecutionRecoveryBody;
    dispatchId: string;
  }
): Promise<ExecuteExecutionRecoveryResponse> {
  const parsed = executeExecutionRecoveryBodySchema.safeParse(input.body);
  if (
    !parsed.success ||
    parsed.data.expectedIdentity.dispatchId !== input.dispatchId
  ) {
    throw new Error(
      parsed.success
        ? "dispatchId does not match expected execution identity"
        : (parsed.error.issues[0]?.message ??
            "invalid execution recovery request")
    );
  }
  return await client.requestJson({
    body: JSON.stringify(parsed.data),
    headers: { "content-type": "application/json" },
    invalidMessage: "invalid execution recovery command response",
    method: "POST",
    operation: "space.execution_recovery.execute",
    requestContext: input.requestContext,
    schema: executeExecutionRecoveryResponseSchema,
    signal: input.signal,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    timeoutMs: input.timeoutMs,
    url: buildSpaceExecutionRecoveryPath(input.spaceId, input.dispatchId),
  });
}
