import * as z from "zod/v4";
import { agentExecutionSteerResponseSchema } from "./schemas/runtime/agent-execution-steer";

const id = z.string().min(1).max(1024);

export const LOCAL_EXECUTION_INPUT_CAPABILITY_HEADER =
  "x-openmeld-local-execution-input";
// The Execution Host still waits for native consumption. Space keeps reading.
export const LOCAL_EXECUTION_INPUT_PENDING_DIAGNOSTIC =
  "service.execution_input.pending";

// Only Core resolves these private selectors. Source identifies the original
// requester and effect; it is not an authorization token.
export const localExecutionInputRequestSchema = z.strictObject({
  inputId: id,
  ownerUserId: id,
  dispatchId: id,
  runtimeCoordinatorExecutionId: id,
  attemptId: id,
  runtimeCoordinatorRunId: id,
  targetProfileId: id,
  source: z.strictObject({
    spaceId: id,
    signalId: id,
    authorProfileId: id,
    requesterUserId: id,
    effect: z.literal("steer"),
  }),
  text: z.string().trim().min(1).max(100_000),
});

export const localExecutionInputResponseSchema = z.discriminatedUnion(
  "status",
  [
    agentExecutionSteerResponseSchema.options[0].extend({ inputId: id }),
    agentExecutionSteerResponseSchema.options[1].extend({
      inputId: id,
      taskId: id.nullable(),
    }),
    agentExecutionSteerResponseSchema.options[2].extend({ inputId: id }),
    z.strictObject({
      inputId: id,
      status: z.enum(["not_found", "conflict", "capacity"]),
    }),
  ]
);

export const localExecutionInputOperationSchema = z.strictObject({
  operation: z.enum(["apply", "read"]),
  request: localExecutionInputRequestSchema,
});

export const localExecutionInputFrameSchema =
  localExecutionInputOperationSchema.extend({
    requestId: id,
    connectionGeneration: z.number().int().positive(),
    leaseEpoch: z.number().int().positive(),
  });

export const localExecutionInputResultFrameSchema = z.strictObject({
  requestId: id,
  result: localExecutionInputResponseSchema,
});

// Space checks original authorship and current membership before requesting a
// binding. The Coordinator checks the admitted source before returning one.
export const localExecutionInputResolveSchema = z.strictObject({
  ownerUserId: id,
  runtimeCoordinatorExecutionId: id,
  dispatchId: id,
  targetProfileId: id,
  spaceId: id,
  authorProfileId: id,
});
export const localExecutionInputBindingSchema =
  localExecutionInputRequestSchema.pick({
    ownerUserId: true,
    runtimeCoordinatorExecutionId: true,
    dispatchId: true,
    targetProfileId: true,
    attemptId: true,
    runtimeCoordinatorRunId: true,
  });
export type LocalExecutionInputRequest = z.infer<
  typeof localExecutionInputRequestSchema
>;
export type LocalExecutionInputResponse = z.infer<
  typeof localExecutionInputResponseSchema
>;
