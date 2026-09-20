import * as z from "zod/v4";

// Optional creation metadata, never execution authority or observed Session truth.
export const agentControllerSessionTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(120);
