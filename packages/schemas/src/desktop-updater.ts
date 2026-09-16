import * as z from "zod/v4";

export const desktopUpdaterActionSchema = z.enum([
  "check",
  "download",
  "restart",
]);
export type DesktopUpdaterAction = z.infer<typeof desktopUpdaterActionSchema>;

/** Main owns this snapshot; UI surfaces never infer installation state. */
export const desktopUpdaterStateSchema = z.strictObject({
  status: z.enum([
    "unavailable",
    "idle",
    "checking",
    "current",
    "available",
    "downloading",
    "downloaded",
    "preparing",
    "installing",
    "error",
  ]),
  currentVersion: z.string(),
  version: z.string().nullable(),
  percent: z.number().min(0).max(100).nullable(),
  errorStage: z.enum(["check", "download", "restart", "install"]).nullable(),
});
export type DesktopUpdaterState = z.infer<typeof desktopUpdaterStateSchema>;

export const desktopUpdaterRestartReplySchema = z.strictObject({
  requestId: z.string().uuid(),
  saved: z.boolean(),
});
export type DesktopUpdaterRestartReply = z.infer<
  typeof desktopUpdaterRestartReplySchema
>;

export const desktopUpdaterRestartRequestSchema = z.strictObject({
  requestId: z.string().uuid(),
});
export type DesktopUpdaterRestartRequest = z.infer<
  typeof desktopUpdaterRestartRequestSchema
>;
