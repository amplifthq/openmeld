import * as z from "zod/v4";

export const agentComputerBrowserRequestSchema = z.strictObject({
  spaceId: z.string().trim().min(1).max(256),
  code: z.string().trim().min(1).max(32_000),
});
