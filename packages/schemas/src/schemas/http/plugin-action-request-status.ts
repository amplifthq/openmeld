import * as z from "../../lazy-zod";

// Shared by private request details and opt-in Agent operation reads.
export const pluginActionRequestStatusSchema = z.strictObject({
  requestId: z.string().uuid(),
  state: z.enum(["pending", "approved", "rejected", "expired", "revoked"]),
  continuation: z.enum(["pending", "requested", "unavailable"]).nullish(),
});
