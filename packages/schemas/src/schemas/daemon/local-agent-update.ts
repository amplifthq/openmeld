import * as z from "../../lazy-zod";

export const localAgentUpdateRequestSchema = z.strictObject({
  installationId: z.string().trim().min(1).max(256),
  operationId: z.string().uuid(),
});

export const localAgentUpdateOperationSchema =
  localAgentUpdateRequestSchema.extend({
    status: z.enum(["running", "succeeded", "failed", "outcome_unknown"]),
    beforeVersion: z.string().max(128).nullable(),
    afterVersion: z.string().max(128).nullable(),
    message: z.string().min(1).max(1024),
  });

export const localAgentUpdateStateSchema = z.strictObject({
  supported: z.boolean(),
  operation: localAgentUpdateOperationSchema.nullable(),
});
