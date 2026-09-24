import * as z from "zod/v4";

export const dispatchProjectShellInputSchema = z.strictObject({
  command: z.string().trim().min(1).max(16_000),
});

export const dispatchProjectShellResultSchema = z.strictObject({
  exitCode: z.number().int().min(0).max(255),
  stdout: z.string().max(128 * 1024),
  stderr: z.string().max(128 * 1024),
});
