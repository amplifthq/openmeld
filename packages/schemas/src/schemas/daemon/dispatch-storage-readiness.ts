import * as z from "zod/v4";

export const dispatchStorageReadinessSchema = z.strictObject({
  ready: z.boolean(),
  detail: z.string().nullable(),
  checkedAt: z.iso.datetime(),
});
