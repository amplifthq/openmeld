import * as z from "zod/v4";

export const continuitySchema = z.strictObject({
  messagesSinceThen: z.number().int().finite().min(0),
  higherAuthorityUpdates: z.boolean(),
});
