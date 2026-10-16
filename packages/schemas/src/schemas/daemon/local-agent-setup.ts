import * as z from "../../lazy-zod";

export const localAgentSetupRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  action: z.enum(["install", "login"]),
});

export const localAgentSetupOperationSchema =
  localAgentSetupRequestSchema.extend({
    status: z.enum(["running", "succeeded", "failed", "outcome_unknown"]),
    message: z.string().min(1).max(1024),
  });

export const localAgentSetupStateSchema = z.strictObject({
  supported: z.boolean(),
  installed: z.boolean(),
  signedIn: z.boolean(),
  operation: localAgentSetupOperationSchema.nullable(),
});
