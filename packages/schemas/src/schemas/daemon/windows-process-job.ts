import * as z from "zod/v4";

// Private Node/native process boundary. This never changes Wake or Service truth.
const jobName = z.string().regex(/^Local\\OpenMeld-Process-[a-f0-9-]{36}$/u);
const text = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"));
export const windowsProcessJobRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      operation: z.literal("launch"),
      jobName,
      executable: text,
      commandLine: text.max(32_766),
      workingDirectory: text,
      ownerPid: z.number().int().positive(),
      ownerStartedAt: z.string().regex(/^\d{10,20}$/u),
    }),
    z.strictObject({ operation: z.literal("drain"), jobName }),
  ]
);
