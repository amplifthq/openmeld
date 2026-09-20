import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import type { Presenter } from "../../runtime/presenter/types";
import { emitRunLine, toErrorMessage } from "../core/logger";
import type { RouteCatalog } from "../core/types";
import { emitDaemonLifecycleEvent } from "../lifecycle/daemon-lifecycle-journal";
import {
  loadDaemonRouteCatalog,
  type RouteCatalogLoadPhaseTimings,
} from "../routing/route-catalog";
import {
  readDaemonRouteCatalogCache,
  writeDaemonRouteCatalogCache,
} from "../state/route-catalog-cache";

type CatalogOwner = {
  lane: string;
  localAdapterContainer: LocalDaemonAdapterContainer;
  ownerUserId: string;
  presenter: Presenter;
  serviceBundleId: string | null;
};

export async function loadExecutionHostCatalog(
  owner: CatalogOwner,
  initial: boolean
): Promise<RouteCatalog> {
  if (!initial) {
    return await loadDaemonRouteCatalog({
      localAdapterContainer: owner.localAdapterContainer,
      ownerUserId: owner.ownerUserId,
      presenter: owner.presenter,
      allowEmpty: true,
      localReplyStateMode: "check",
      quiet: true,
    });
  }
  const startedAt = Date.now();
  const phaseTimings: RouteCatalogLoadPhaseTimings = {};
  await recordInitialLoad("started", {});
  try {
    const catalog = await loadDaemonRouteCatalog({
      allowEmpty: true,
      localAdapterContainer: owner.localAdapterContainer,
      localReplyStateMode: "check",
      ownerUserId: owner.ownerUserId,
      phaseTimings,
      presenter: owner.presenter,
    });
    await recordInitialLoad("completed", {
      durationMs: Date.now() - startedAt,
      phaseTimings,
      profileCount: catalog.profileIds.length,
      skippedProfileCount: catalog.skippedProfiles.length,
    });
    return catalog;
  } catch (error) {
    const cached = await readDaemonRouteCatalogCache({
      lane: owner.lane,
      ownerUserId: owner.ownerUserId,
      serviceBundleId: owner.serviceBundleId,
    });
    emitRunLine({
      presenter: owner.presenter,
      code: cached
        ? "daemon.run.route_catalog_cache_recovered"
        : "daemon.run.route_catalog_initial_load_failed",
      text: cached
        ? `using last known route catalog after initial catalog load failed: ${toErrorMessage(error)}`
        : `initial route catalog load failed; starting with an empty catalog and retrying via catalog sync: ${toErrorMessage(error)}`,
      payload: {
        reason: cached ? "initial_load_failed" : "initial_load_failed_no_cache",
      },
    });
    await recordInitialLoad(cached ? "cache_recovered" : "failed_empty_start", {
      durationMs: Date.now() - startedAt,
      errorMessage: toErrorMessage(error),
      phaseTimings,
      ...(cached ? { profileCount: cached.profileIds.length } : {}),
    });
    return (
      cached ?? {
        profileIds: [],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      }
    );
  }
}

export async function persistExecutionHostCatalog(
  owner: CatalogOwner,
  routeCatalog: RouteCatalog
): Promise<void> {
  try {
    await writeDaemonRouteCatalogCache({
      lane: owner.lane,
      ownerUserId: owner.ownerUserId,
      serviceBundleId: owner.serviceBundleId,
      routeCatalog,
    });
  } catch (error) {
    emitRunLine({
      presenter: owner.presenter,
      code: "daemon.run.route_catalog_cache_write_failed",
      text: `route catalog cache write failed: ${toErrorMessage(error)}`,
    });
  }
}

async function recordInitialLoad(
  result: string,
  metadata: Record<string, unknown>
): Promise<void> {
  // Match the existing diagnostic contract: journaling never owns startup.
  await emitDaemonLifecycleEvent({
    type: "route_catalog.initial_load",
    result,
    metadata,
  }).catch(() => undefined);
}
