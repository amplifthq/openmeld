import { z } from "zod/v4";
import {
  agentControllerConversationCapabilitySchema,
  resolveBuiltinAgentControllerConversationCapability,
} from "../daemon/agent-controller-conversation-capability";
import { normalizeKnownBuiltinAgentControllerId } from "../daemon/agent-controller-ref";
import {
  localComponentUpdatePolicySchema,
  localComponentUpdateStatusSchema,
  openMeldToolsMaintenanceProjectionSchema,
  openMeldToolsUpdateOperationSchema,
} from "../local-components";
import {
  agentControllerInterfaceCapabilitiesSchema,
  agentControllerInterfaceCheckSnapshotSchema,
  agentControllerInterfaceNativeInterfaceSchema,
  type agentControllerInterfaceSnapshotSchema,
  agentControllerInterfaceStatusSchema,
  agentControllerInterfaceVersionAdvisoryStatusSchema,
  agentControllerUsageLimitsSchema,
} from "../runtime/agent-controller-interface";
import { localAgentCatalogLaunchStatusSchema } from "../runtime/local-agent-catalog";
import {
  localRuntimeDeviceTypeSchema,
  localRuntimePlatformFamilySchema,
} from "./local-runtimes";
import { organizationMemberOpenMeldServiceStateSchema } from "./organization-member-openmeld-service-status";

const BOUNDED_ID_SCHEMA = z.string().trim().min(1).max(256);
const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const REASON_CODES_SCHEMA = z.array(BOUNDED_ID_SCHEMA).max(64);

export const organizationComputerOpenMeldToolsSchema = z.strictObject({
  maintenance: openMeldToolsMaintenanceProjectionSchema.optional(),
  updateOperation: openMeldToolsUpdateOperationSchema.optional(),
  cli: z.strictObject({
    installedPackageVersion: BOUNDED_ID_SCHEMA.nullable(),
    latestPackageVersion: BOUNDED_ID_SCHEMA.nullable(),
    reasonCodes: REASON_CODES_SCHEMA,
    status: localComponentUpdateStatusSchema,
    updatePolicy: localComponentUpdatePolicySchema,
    wakeBlocked: z.boolean(),
  }),
  service: z.strictObject({
    installedVersion: BOUNDED_ID_SCHEMA.nullable(),
    latestVersion: BOUNDED_ID_SCHEMA.nullable(),
    reasonCodes: REASON_CODES_SCHEMA,
    requiredVersion: BOUNDED_ID_SCHEMA.nullable(),
    status: localComponentUpdateStatusSchema,
    updatePolicy: localComponentUpdatePolicySchema,
    wakeBlocked: z.boolean(),
  }),
  skills: z.strictObject({
    reasonCodes: REASON_CODES_SCHEMA,
    status: localComponentUpdateStatusSchema,
    targetCount: z.number().int().nonnegative().nullable(),
    updatePolicy: localComponentUpdatePolicySchema,
    wakeBlocked: z.boolean(),
  }),
});

export const organizationComputerLocalAgentDetailsSchema = z.strictObject({
  capabilities: agentControllerInterfaceCapabilitiesSchema,
  check: agentControllerInterfaceCheckSnapshotSchema.optional(),
  checkedAt: ISO_DATE_TIME_SCHEMA,
  conversationCapabilities:
    agentControllerConversationCapabilitySchema.optional(),
  launch: z.strictObject({
    installChoiceCount: z.number().int().nonnegative(),
    status: localAgentCatalogLaunchStatusSchema,
  }),
  models: z
    .array(
      z.strictObject({
        displayName: z.string().trim().min(1).max(256),
      })
    )
    .max(256),
  nativeInterface: agentControllerInterfaceNativeInterfaceSchema,
  status: agentControllerInterfaceStatusSchema,
  usageLimits: agentControllerUsageLimitsSchema.optional(),
  version: BOUNDED_ID_SCHEMA.nullable(),
  versionAdvisory: z
    .strictObject({
      checkedAt: ISO_DATE_TIME_SCHEMA.nullable(),
      currentVersion: BOUNDED_ID_SCHEMA.nullable(),
      latestVersion: BOUNDED_ID_SCHEMA.nullable(),
      status: agentControllerInterfaceVersionAdvisoryStatusSchema,
    })
    .optional(),
});

export function projectOrganizationComputerLocalAgentDetails(
  snapshot: z.infer<typeof agentControllerInterfaceSnapshotSchema>
): z.infer<typeof organizationComputerLocalAgentDetailsSchema> {
  const builtinControllerId = normalizeKnownBuiltinAgentControllerId(
    snapshot.agentControllerRef
  );
  const conversationCapabilities = builtinControllerId
    ? resolveBuiltinAgentControllerConversationCapability(builtinControllerId)
    : null;
  return {
    capabilities: snapshot.capabilities,
    ...(snapshot.check ? { check: snapshot.check } : {}),
    checkedAt: snapshot.checkedAt,
    ...(conversationCapabilities ? { conversationCapabilities } : {}),
    launch: {
      installChoiceCount: snapshot.launch.installChoiceCount,
      status: snapshot.launch.status,
    },
    models: snapshot.models.map((model) => ({
      displayName: model.displayName,
    })),
    nativeInterface: snapshot.nativeInterface,
    status: snapshot.status,
    ...(snapshot.usageLimits ? { usageLimits: snapshot.usageLimits } : {}),
    version: snapshot.version,
    ...(snapshot.versionAdvisory
      ? {
          versionAdvisory: {
            checkedAt: snapshot.versionAdvisory.checkedAt,
            currentVersion: snapshot.versionAdvisory.currentVersion,
            latestVersion: snapshot.versionAdvisory.latestVersion,
            status: snapshot.versionAdvisory.status,
          },
        }
      : {}),
  };
}

export const organizationComputerLocalAgentSchema = z.strictObject({
  agentControllerRef: BOUNDED_ID_SCHEMA,
  details: organizationComputerLocalAgentDetailsSchema.nullable().optional(),
  enabled: z.boolean(),
  status: z.enum(["ready", "not_ready", "stale", "unknown"]),
});

export const organizationComputerSchema = z.strictObject({
  computerId: BOUNDED_ID_SCHEMA,
  deviceDisplayName: z.string().trim().min(1).max(256),
  deviceType: localRuntimeDeviceTypeSchema,
  lastSeenAtMs: z.number().int().nonnegative().nullable(),
  localAgents: z.array(organizationComputerLocalAgentSchema),
  openMeldTools: organizationComputerOpenMeldToolsSchema.nullable().optional(),
  osVersion: z.string().trim().min(1).max(120).nullable(),
  ownerUserId: BOUNDED_ID_SCHEMA,
  platformFamily: localRuntimePlatformFamilySchema,
  serviceState: organizationMemberOpenMeldServiceStateSchema,
});

export const organizationComputersResponseSchema = z.strictObject({
  computers: z.array(organizationComputerSchema),
  generatedAt: ISO_DATE_TIME_SCHEMA,
  organizationId: BOUNDED_ID_SCHEMA,
});
