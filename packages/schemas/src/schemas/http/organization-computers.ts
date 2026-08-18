import { z } from "zod/v4";
import {
  localRuntimeDeviceTypeSchema,
  localRuntimePlatformFamilySchema,
} from "./local-runtimes";
import { organizationMemberOpenMeldServiceStateSchema } from "./organization-member-openmeld-service-status";

const BOUNDED_ID_SCHEMA = z.string().trim().min(1).max(256);
const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });

export const organizationComputerLocalAgentSchema = z.strictObject({
  agentControllerRef: BOUNDED_ID_SCHEMA,
  enabled: z.boolean(),
  status: z.enum(["ready", "not_ready", "stale", "unknown"]),
});

export const organizationComputerSchema = z.strictObject({
  computerId: BOUNDED_ID_SCHEMA,
  deviceDisplayName: z.string().trim().min(1).max(256),
  deviceType: localRuntimeDeviceTypeSchema,
  lastSeenAtMs: z.number().int().nonnegative().nullable(),
  localAgents: z.array(organizationComputerLocalAgentSchema),
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
