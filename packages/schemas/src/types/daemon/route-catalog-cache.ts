import type { z } from "zod/v4";

type CachedDaemonRouteConfigSchema =
  typeof import("../../schemas/daemon/route-catalog-cache")["cachedDaemonRouteConfigSchema"];
type DaemonRouteCatalogCacheSchema =
  typeof import("../../schemas/daemon/route-catalog-cache")["daemonRouteCatalogCacheSchema"];

export type CachedDaemonRouteConfig = z.infer<CachedDaemonRouteConfigSchema>;
export type DaemonRouteCatalogCache = z.infer<DaemonRouteCatalogCacheSchema>;
