import * as z from "zod/v4";
import { localExecutionInputBindingSchema } from "./local-execution-input";
import { remoteAgentWorkerExecutionInputRequestSchema } from "./schemas/runtime/remote-agent-execution-input";

// Stored in the existing Space input outbox. The kind selects a carrier, not
// a different queue or an execution authority.
export const localSpaceExecutionInputSchema = z.strictObject({
  kind: z.literal("local"),
  target: localExecutionInputBindingSchema.extend({
    spaceId: z.string().min(1),
  }),
  inputId: z.string().min(1).max(256),
  authorProfileId: z.string().min(1),
  requesterUserId: z.string().min(1),
  sourceSignalId: z.string().min(1),
  text: z.string().trim().min(1).max(100_000),
});
export const spaceExecutionInputRequestSchema = z.union([
  remoteAgentWorkerExecutionInputRequestSchema,
  localSpaceExecutionInputSchema,
]);
export type SpaceExecutionInputRequest = z.infer<
  typeof spaceExecutionInputRequestSchema
>;
export type LocalSpaceExecutionInput = z.infer<
  typeof localSpaceExecutionInputSchema
>;
export function isLocalSpaceExecutionInput(
  request: SpaceExecutionInputRequest
): request is LocalSpaceExecutionInput {
  return "kind" in request && request.kind === "local";
}
