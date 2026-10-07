import * as z from "zod/v4";

export const agentComputerBrowserRequestSchema = z.strictObject({
  spaceId: z.string().trim().min(1).max(256),
  code: z.string().trim().min(1).max(32_000),
});

export const agentComputerPreviewRequestSchema = z.strictObject({
  port: z.number().int().min(1024).max(65_535),
  path: z.string().min(1).max(2048),
  expectedText: z.string().min(1).max(500),
});

export const agentComputerPreviewRoutePropsSchema = z.strictObject({
  computerId: z.string().min(1),
  port: z.number().int().min(1024).max(65_535),
});
