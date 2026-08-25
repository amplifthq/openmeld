import * as z from "zod/v4";

export const resultArchiveModeSchema = z.enum([
  "none",
  "space_reply_only",
  "all_final_results",
]);

export const resultArchivePolicySchema = z.strictObject({
  mode: resultArchiveModeSchema,
});
