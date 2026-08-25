import * as z from "zod/v4";
import { agentControllerCollaborationModeSchema } from "../agent-controller-collaboration-mode";
import { agentControllerPermissionModeSchema } from "../agent-controller-permission-mode";
import { openCodePermissionConfigSchema } from "../open-code-permission";
import { agentProfileIdSchema } from "../protocol/profile";
import { skippedDaemonProfileSchema } from "./control-plane";
import {
  runtimeAgentControllerConversationIdMappingSpecSchema,
  runtimeAgentControllerLaunchContractSchema,
  runtimeStreamingModeSchema,
  runtimeTransportModeSchema,
} from "./controller-contract";
import { conversationPolicySchema } from "./conversation-contract";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "./runtime-transport";
import { daemonServiceLaneSchema } from "./service-contract";

export const DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_VERSION = 4 as const;
export const DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_NAME =
  "openmeld-daemon-route-catalog-cache-v4" as const;

export const cachedDaemonRouteConfigSchema = z.strictObject({
  agentControllerRef: z.string().trim().min(1),
  bindingId: z.string().trim().min(1).optional(),
  agentControllerCollaborationMode:
    agentControllerCollaborationModeSchema.optional(),
  agentControllerPermissionMode: agentControllerPermissionModeSchema.optional(),
  configurationRevision: z.number().int().positive().optional(),
  contextIdMappingSpec: runtimeAgentControllerConversationIdMappingSpecSchema,
  conversationPolicy: conversationPolicySchema.optional(),
  openCodePermission: openCodePermissionConfigSchema.optional(),
  launchContract: runtimeAgentControllerLaunchContractSchema
    .nullable()
    .optional(),
  profileId: agentProfileIdSchema,
  streamingMode: runtimeStreamingModeSchema,
  transportMode: runtimeTransportModeSchema,
  openMeldServiceRuntimeId: z.string().trim().min(1).optional(),
});

const daemonRouteCatalogCacheBodySchema = z.strictObject({
  cachedAt: z.iso.datetime({ offset: true }),
  runtimeContractEpoch: z.literal(CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH),
  ownerUserId: z.string().trim().min(1),
  lane: daemonServiceLaneSchema,
  serviceBundleId: z.string().trim().min(1),
  profileIds: z.array(agentProfileIdSchema),
  routes: z.array(cachedDaemonRouteConfigSchema),
  skippedProfiles: z.array(skippedDaemonProfileSchema),
});

export const daemonRouteCatalogCacheSchema = z
  .discriminatedUnion("v", [
    daemonRouteCatalogCacheBodySchema.extend({
      v: z.literal(2),
      schema: z.literal("openmeld-daemon-route-catalog-cache-v2"),
    }),
    daemonRouteCatalogCacheBodySchema.extend({
      v: z.literal(3),
      schema: z.literal("openmeld-daemon-route-catalog-cache-v3"),
    }),
    daemonRouteCatalogCacheBodySchema.extend({
      v: z.literal(DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_VERSION),
      schema: z.literal(DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_NAME),
    }),
  ])
  .superRefine((value, ctx) => {
    const routeIds = new Set(value.routes.map((route) => route.profileId));
    for (const profileId of value.profileIds) {
      if (!routeIds.has(profileId)) {
        ctx.addIssue({
          code: "custom",
          message: "route catalog cache profileIds must match routes",
          path: ["profileIds"],
        });
      }
    }
  });
