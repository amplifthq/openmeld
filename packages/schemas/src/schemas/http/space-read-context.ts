import * as z from "zod/v4";
import { spaceEntryTargetSchema } from "./space-entry";

/** Discovery only: content remains in the owning Space read resources. */
export const spaceReadContextSchema = z.strictObject({
  target: spaceEntryTargetSchema,
  resources: z.array(z.strictObject({ rel: z.string(), href: z.string() })),
  instructions: z.array(z.string()),
});
