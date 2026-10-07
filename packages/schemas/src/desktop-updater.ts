import * as z from "zod/v4";
import { daemonServiceLaneSchema } from "./schemas/daemon/service-contract";

export const desktopUpdaterActionSchema = z.enum([
  "check",
  "download",
  "restart",
]);
export type DesktopUpdaterAction = z.infer<typeof desktopUpdaterActionSchema>;

/** Main owns this snapshot; UI surfaces never infer installation state. */
export const desktopUpdaterStateSchema = z.strictObject({
  installationId: z.string().uuid().optional(),
  lane: daemonServiceLaneSchema.optional(),
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

/** Local evidence only. This record never controls update or restart state. */
export const desktopUpdaterFailureDiagnosticSchema = z.strictObject({
  format: z.literal(1),
  recordedAt: z.iso.datetime(),
  stage: desktopUpdaterStateSchema.shape.errorStage.unwrap(),
  currentVersion: z.string().max(80),
  targetVersion: z.string().max(80).nullable(),
  code: z.string().max(80).nullable(),
  httpStatus: z.number().int().min(400).max(599).nullable(),
  message: z.string().max(256),
});
export type DesktopUpdaterFailureDiagnostic = z.infer<
  typeof desktopUpdaterFailureDiagnosticSchema
>;
