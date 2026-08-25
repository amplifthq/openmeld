import * as z from "zod/v4";
import { runtimeCoordinatorExecutionRecordSchema } from "../daemon/runtime-coordinator-execution";
import { runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema } from "../daemon/runtime-transport";
import { agentInteractionResponseSchema } from "../protocol/agent-interaction";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";

export const respondToSpaceAgentInteractionBodySchema = z.strictObject({
  runtimeCoordinatorExecutionId:
    runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId,
  interactionId: z.string().trim().min(1).max(256),
  response: agentInteractionResponseSchema,
});

export const respondToSpaceAgentInteractionInputSchema = z.strictObject({
  body: respondToSpaceAgentInteractionBodySchema,
  spaceId: nonEmptyTrimmedStringFromUnknown,
});

export const respondToSpaceAgentInteractionResponseSchema =
  runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema;
