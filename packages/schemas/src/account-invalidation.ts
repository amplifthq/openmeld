import * as z from "zod/v4";

// The stream carries refresh hints only. Each client re-reads the owning
// projection after an event and after reconnecting.
export const accountInvalidationFrameSchema = z.strictObject({
  type: z.enum(["inbox.changed", "space_index.changed"]),
});
export type AccountInvalidationFrame = z.infer<
  typeof accountInvalidationFrameSchema
>;
