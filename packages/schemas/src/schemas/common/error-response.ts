import * as z from "zod/v4";

export const commonErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1).optional(),
  details: z.unknown().optional(),
});

export const errorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: commonErrorSchema,
  requestId: z.string().min(1).optional(),
});
