import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_NAME,
  DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_VERSION,
  daemonRouteCatalogCacheSchema,
  daemonServiceLaneSchema,
} from "@openmeld/schemas";
import type {
  DaemonRouteCatalogCache,
  DaemonServiceLane,
} from "@openmeld/schemas/types";
import {
  readDaemonLocalStateFile,
  writeDaemonLocalStateFile,
} from "../../config/daemon-local-state-file";
import { daemonRuntimeDataPath } from "../../config/daemon-state";
import type { DaemonProfileRouteConfig, RouteCatalog } from "../core/types";

const ROUTE_CATALOG_CACHE_FILE = "route-catalog-cache.json";

export async function readDaemonRouteCatalogCache(input: {
  lane: string | null | undefined;
  ownerUserId: string | null | undefined;
  serviceBundleId: string | null | undefined;
}): Promise<RouteCatalog | null> {
  const lane = normalizeCacheLane(input.lane);
  const ownerUserId = normalizeCacheIdentityField(input.ownerUserId);
  const serviceBundleId = normalizeServiceBundleId(input.serviceBundleId);
  if (!(lane && ownerUserId && serviceBundleId)) {
    return null;
  }

  const cached = await readDaemonLocalStateFile({
    path: daemonRouteCatalogCachePath(),
    schema: daemonRouteCatalogCacheSchema,
  });
  if (
    !cached ||
    cached.ownerUserId !== ownerUserId ||
    cached.lane !== lane ||
    cached.serviceBundleId !== serviceBundleId
  ) {
    return null;
  }
  return deserializeRouteCatalog(cached);
}

export async function writeDaemonRouteCatalogCache(input: {
  lane: string | null | undefined;
  ownerUserId: string | null | undefined;
  routeCatalog: RouteCatalog;
  serviceBundleId: string | null | undefined;
}): Promise<void> {
  const lane = normalizeCacheLane(input.lane);
  const ownerUserId = normalizeCacheIdentityField(input.ownerUserId);
  const serviceBundleId = normalizeServiceBundleId(input.serviceBundleId);
  if (!(lane && ownerUserId && serviceBundleId)) {
    return;
  }
  if (input.routeCatalog.profileIds.length === 0) {
    await clearDaemonRouteCatalogCache();
    return;
  }

  const value: DaemonRouteCatalogCache = {
    v: DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_VERSION,
    schema: DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_NAME,
    cachedAt: new Date().toISOString(),
    runtimeContractEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    ownerUserId,
    lane,
    serviceBundleId,
    profileIds: [...input.routeCatalog.profileIds],
    routes: input.routeCatalog.profileIds.map((profileId) => {
      const route = input.routeCatalog.routeByProfileId.get(profileId);
      if (!route) {
        throw new Error(`route catalog is missing route for ${profileId}`);
      }
      return serializeRouteConfig(route);
    }),
    skippedProfiles: [...input.routeCatalog.skippedProfiles],
  };
  await writeDaemonLocalStateFile({
    path: daemonRouteCatalogCachePath(),
    schema: daemonRouteCatalogCacheSchema,
    value,
    mode: 0o600,
  });
}

export async function clearDaemonRouteCatalogCache(): Promise<void> {
  await rm(daemonRouteCatalogCachePath(), { force: true });
}

function daemonRouteCatalogCachePath(): string {
  return join(daemonRuntimeDataPath(), ROUTE_CATALOG_CACHE_FILE);
}

function normalizeServiceBundleId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeCacheIdentityField(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeCacheLane(
  value: string | null | undefined
): DaemonServiceLane | null {
  const parsed = daemonServiceLaneSchema.safeParse(
    normalizeCacheIdentityField(value)
  );
  return parsed.success ? parsed.data : null;
}

function serializeRouteConfig(
  route: DaemonProfileRouteConfig
): DaemonRouteCatalogCache["routes"][number] {
  return {
    agentControllerRef: route.agentControllerRef,
    ...(route.bindingId ? { bindingId: route.bindingId } : {}),
    ...(route.agentControllerCollaborationMode
      ? {
          agentControllerCollaborationMode:
            route.agentControllerCollaborationMode,
        }
      : {}),
    ...(route.agentControllerPermissionMode
      ? { agentControllerPermissionMode: route.agentControllerPermissionMode }
      : {}),
    ...(route.configurationRevision
      ? { configurationRevision: route.configurationRevision }
      : {}),
    ...(route.conversationPolicy
      ? { conversationPolicy: route.conversationPolicy }
      : {}),
    ...(route.openCodePermission
      ? { openCodePermission: route.openCodePermission }
      : {}),
    contextIdMappingSpec: route.contextIdMappingSpec,
    ...(route.launchContract ? { launchContract: route.launchContract } : {}),
    profileId: route.profileId,
    streamingMode: route.streamingMode,
    transportMode: route.transportMode,
    ...(route.openMeldServiceRuntimeId
      ? { openMeldServiceRuntimeId: route.openMeldServiceRuntimeId }
      : {}),
  };
}

function deserializeRouteCatalog(cache: DaemonRouteCatalogCache): RouteCatalog {
  const routeByProfileId = new Map<string, DaemonProfileRouteConfig>();
  for (const route of cache.routes) {
    routeByProfileId.set(route.profileId, {
      agentControllerRef: route.agentControllerRef,
      ...(route.bindingId ? { bindingId: route.bindingId } : {}),
      ...(route.agentControllerCollaborationMode
        ? {
            agentControllerCollaborationMode:
              route.agentControllerCollaborationMode,
          }
        : {}),
      ...(route.agentControllerPermissionMode
        ? { agentControllerPermissionMode: route.agentControllerPermissionMode }
        : {}),
      ...(route.configurationRevision
        ? { configurationRevision: route.configurationRevision }
        : {}),
      ...(route.conversationPolicy
        ? { conversationPolicy: route.conversationPolicy }
        : {}),
      ...(route.openCodePermission
        ? { openCodePermission: route.openCodePermission }
        : {}),
      contextIdMappingSpec: route.contextIdMappingSpec,
      ...(route.launchContract ? { launchContract: route.launchContract } : {}),
      profileId: route.profileId,
      streamingMode: route.streamingMode,
      transportMode: route.transportMode,
      ...(route.openMeldServiceRuntimeId
        ? { openMeldServiceRuntimeId: route.openMeldServiceRuntimeId }
        : {}),
    });
  }
  return {
    profileIds: [...cache.profileIds],
    routeByProfileId,
    skippedProfiles: [...cache.skippedProfiles],
    workingFolderObservations: [],
  };
}
