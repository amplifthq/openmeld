import { z } from "zod/v4";
import type { ComputerFileAccessPolicyResponse } from "../../types/daemon/computer-file-access";
import { computerFileAccessModeSchema } from "../daemon/computer-file-access";
import {
  currentLocalRuntimeReplyReadinessResponseSchema,
  localRuntimesResponseSchema,
} from "./local-runtimes";

const boundedDiagnosticCodeSchema = z.string().trim().min(1).max(256);
const boundedDiagnosticMessageSchema = z.string().trim().min(1).max(1024);

export const computerFileAccessSummarySchema = z.discriminatedUnion("status", [
  z.strictObject({
    deviceId: z.string().trim().min(1).max(512),
    folderCount: z.number().int().nonnegative(),
    mode: computerFileAccessModeSchema,
    revision: z.number().int().positive(),
    status: z.literal("available"),
    updatedAtMs: z.number().int().nonnegative(),
  }),
  z.strictObject({
    status: z.literal("unsupported"),
  }),
  z.strictObject({
    code: boundedDiagnosticCodeSchema,
    message: boundedDiagnosticMessageSchema,
    status: z.literal("unavailable"),
  }),
]);

export const ownerComputerDiagnosticsSchema = z.strictObject({
  currentComputerFileAccess: computerFileAccessSummarySchema,
  currentLocalRuntimeReplyReadiness:
    currentLocalRuntimeReplyReadinessResponseSchema,
  localRuntimes: localRuntimesResponseSchema,
});

export function summarizeComputerFileAccessPolicy(
  response: ComputerFileAccessPolicyResponse
): z.infer<typeof computerFileAccessSummarySchema> {
  return {
    deviceId: response.deviceId,
    folderCount:
      "folders" in response.policy ? response.policy.folders.length : 0,
    mode: response.policy.mode,
    revision: response.policy.revision,
    status: "available",
    updatedAtMs: response.policy.updatedAtMs,
  };
}
