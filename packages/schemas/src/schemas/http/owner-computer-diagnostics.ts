import * as z from "zod/v4";
import type { ComputerFileAccessPolicyResponse } from "../../types/daemon/computer-file-access";
import type { LocalRuntimesResponse } from "../../types/http/local-runtimes";
import { computerFileAccessModeSchema } from "../daemon/computer-file-access";
import { daemonServiceLaneSchema } from "../daemon/service-contract";
import {
  currentLocalRuntimeReplyReadinessResponseSchema,
  localRuntimeConnectionStatusSchema,
  localRuntimeDeviceTypeSchema,
  localRuntimeExecutionTargetStatusSchema,
  localRuntimePlatformFamilySchema,
} from "./local-runtimes";
import {
  organizationComputerLocalAgentDetailsSchema,
  projectOrganizationComputerLocalAgentDetails,
} from "./organization-computers";
import { prepareReadinessRuntimeIdSchema } from "./prepare-readiness";

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

const ownerComputerLocalRuntimeCapabilitySchema = z.strictObject({
  agentControllerRef: boundedDiagnosticCodeSchema,
  details: organizationComputerLocalAgentDetailsSchema.nullable().optional(),
  displayName: z.string().trim().min(1).max(256).optional(),
  enabled: z.boolean(),
  reasonCodes: z.array(boundedDiagnosticCodeSchema),
  status: z.enum(["ready", "not_ready", "stale", "unknown"]),
});

const ownerComputerLocalRuntimeExecutionTargetSchema = z.strictObject({
  capabilities: z.array(ownerComputerLocalRuntimeCapabilitySchema),
  deviceId: z.string().trim().min(1).max(256),
  isCurrent: z.boolean(),
  lastObservedAtMs: z.number().int().nonnegative().nullable(),
  openMeldServiceRuntimeId: prepareReadinessRuntimeIdSchema.nullable(),
  reasonCodes: z.array(boundedDiagnosticCodeSchema),
  runtimeLane: daemonServiceLaneSchema,
  status: localRuntimeExecutionTargetStatusSchema,
});

const ownerComputerLocalRuntimeSchema = z.strictObject({
  computerFileAccess: z
    .strictObject({
      readPolicy: z.boolean(),
      updatePolicy: z.boolean(),
    })
    .optional(),
  connectedComputerId: z.string().trim().min(1).max(256).optional(),
  connectionStatus: localRuntimeConnectionStatusSchema.optional(),
  deviceDisplayName: z.string().trim().min(1).max(256),
  deviceId: z.string().trim().min(1).max(256),
  deviceType: localRuntimeDeviceTypeSchema,
  executionTargets: z.array(ownerComputerLocalRuntimeExecutionTargetSchema),
  firstSeenAtMs: z.number().int().nonnegative(),
  isCurrent: z.boolean(),
  lastObservedAtMs: z.number().int().nonnegative().nullable(),
  osVersion: z.string().trim().min(1).max(120).nullable(),
  platformFamily: localRuntimePlatformFamilySchema,
});

export const ownerComputerLocalRuntimesSchema = z.strictObject({
  currentConnectedComputerId: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .nullable()
    .optional(),
  currentDeviceId: z.string().trim().min(1).max(256).nullable(),
  currentRuntimeLane: daemonServiceLaneSchema.nullable(),
  localRuntimes: z.array(ownerComputerLocalRuntimeSchema),
});

export const ownerComputerDiagnosticsSchema = z.strictObject({
  currentComputerFileAccess: computerFileAccessSummarySchema,
  currentLocalRuntimeReplyReadiness:
    currentLocalRuntimeReplyReadinessResponseSchema,
  localRuntimes: ownerComputerLocalRuntimesSchema,
});

export function projectOwnerComputerLocalRuntimes(
  response: LocalRuntimesResponse
): z.infer<typeof ownerComputerLocalRuntimesSchema> {
  return ownerComputerLocalRuntimesSchema.parse({
    ...(response.currentConnectedComputerId === undefined
      ? {}
      : { currentConnectedComputerId: response.currentConnectedComputerId }),
    currentDeviceId: response.currentDeviceId,
    currentRuntimeLane: response.currentRuntimeLane,
    localRuntimes: response.localRuntimes.map((computer) => ({
      ...(computer.computerFileAccess
        ? { computerFileAccess: computer.computerFileAccess }
        : {}),
      ...(computer.connectedComputerId
        ? { connectedComputerId: computer.connectedComputerId }
        : {}),
      ...(computer.connectionStatus
        ? { connectionStatus: computer.connectionStatus }
        : {}),
      deviceDisplayName: computer.deviceDisplayName,
      deviceId: computer.deviceId,
      deviceType: computer.deviceType,
      executionTargets: computer.executionTargets.map((target) => ({
        capabilities: target.capabilities.map((capability) => {
          const snapshot = capability.agentControllerInterface;
          return {
            agentControllerRef: capability.agentControllerRef,
            ...(snapshot === undefined
              ? {}
              : {
                  details:
                    snapshot === null
                      ? null
                      : projectOrganizationComputerLocalAgentDetails(snapshot),
                }),
            ...(snapshot ? { displayName: snapshot.displayName } : {}),
            enabled: capability.enabled,
            reasonCodes: capability.reasonCodes,
            status: capability.status,
          };
        }),
        deviceId: target.deviceId,
        isCurrent: target.isCurrent,
        lastObservedAtMs: target.lastObservedAtMs,
        openMeldServiceRuntimeId: target.openMeldServiceRuntimeId,
        reasonCodes: target.reasonCodes,
        runtimeLane: target.runtimeLane,
        status: target.status,
      })),
      firstSeenAtMs: computer.firstSeenAtMs,
      isCurrent: computer.isCurrent,
      lastObservedAtMs: computer.lastObservedAtMs,
      osVersion: computer.osVersion,
      platformFamily: computer.platformFamily,
    })),
  });
}

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
