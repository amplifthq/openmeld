import { z } from "zod/v4";

// Better Auth owns password policy enforcement (min/max length, reuse rules, etc).
// This bridge schema only locks the request/response shape for our HTTP contract.
export const setAuthPasswordBodySchema = z.strictObject({
  newPassword: z.string(),
});

export const setAuthPasswordResponseSchema = z.strictObject({
  status: z.boolean(),
});
