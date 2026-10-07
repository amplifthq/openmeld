import type { RouteCatalog } from "../core/types";
import type { ExecutionHostPort } from "./port";

export function createExecutionHostCatalogClient(host: ExecutionHostPort) {
  let resolved = false;
  return {
    isResolved: () => resolved,
    async load(): Promise<RouteCatalog> {
      const catalog = await host.call("loadCatalog", { initial: !resolved });
      resolved = true;
      return {
        executionHostCatalogRevision: catalog.revision,
        expectedRoutesContractVersion: catalog.expectedRoutesContractVersion,
        profileIds: catalog.profileIds,
        routeByProfileId: new Map(
          catalog.routes.map((route) => [route.profileId, route])
        ),
        skippedProfiles: catalog.skippedProfiles,
        workingFolderExpectedProfileIds:
          catalog.workingFolderExpectedProfileIds,
        workingFolderObservations: catalog.workingFolderObservations,
      };
    },
    async persist(catalog: RouteCatalog): Promise<void> {
      if (catalog.executionHostCatalogRevision) {
        await host.call("persistCatalog", {
          revision: catalog.executionHostCatalogRevision,
        });
      }
    },
  };
}
