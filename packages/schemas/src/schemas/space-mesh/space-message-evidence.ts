import * as z from "zod/v4";

export const spaceMessageEvidenceRequestSchema = z
  .strictObject({
    sourceSignalId: z.string().trim().min(1).max(256),
    version: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u)
      .optional(),
    offset: z.int().nonnegative().max(1_000_000).optional(),
  })
  .refine((value) => !value.offset || value.version !== undefined, {
    message: "A continuation must retain the source version.",
  });
