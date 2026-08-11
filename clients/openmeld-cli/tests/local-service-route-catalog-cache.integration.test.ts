import { describe, expect, it } from "vitest";
import type { RouteCatalog } from "../src/local-service/core/types";
import {
  readDaemonRouteCatalogCache,
  writeDaemonRouteCatalogCache,
} from "../src/local-service/state/route-catalog-cache";
import { withTempHome } from "./helpers/fs";

describe("local service route catalog cache", () => {
  it("restores only when owner, lane, and service bundle match", async () => {
    await withTempHome(async () => {
      await writeDaemonRouteCatalogCache({
        lane: "prod",
        ownerUserId: "usr_felix",
        routeCatalog: createRouteCatalog(
          "agt_11111111-1111-4111-8111-111111111111"
        ),
        serviceBundleId: "bundle-1",
      });

      await expect(
        readDaemonRouteCatalogCache({
          lane: "prod",
          ownerUserId: "usr_felix",
          serviceBundleId: "bundle-1",
        })
      ).resolves.toMatchObject({
        profileIds: ["agt_11111111-1111-4111-8111-111111111111"],
      });
      await expect(
        readDaemonRouteCatalogCache({
          lane: "prod",
          ownerUserId: "usr_other",
          serviceBundleId: "bundle-1",
        })
      ).resolves.toBeNull();
      await expect(
        readDaemonRouteCatalogCache({
          lane: "canary",
          ownerUserId: "usr_felix",
          serviceBundleId: "bundle-1",
        })
      ).resolves.toBeNull();
      await expect(
        readDaemonRouteCatalogCache({
          lane: "prod",
          ownerUserId: "usr_felix",
          serviceBundleId: "bundle-2",
        })
      ).resolves.toBeNull();
    });
  });

  it("does not persist a cache when owner, lane, or service bundle is missing", async () => {
    await withTempHome(async () => {
      await writeDaemonRouteCatalogCache({
        lane: "prod",
        ownerUserId: "",
        routeCatalog: createRouteCatalog(
          "agt_11111111-1111-4111-8111-111111111111"
        ),
        serviceBundleId: "bundle-1",
      });

      await expect(
        readDaemonRouteCatalogCache({
          lane: "prod",
          ownerUserId: "usr_felix",
          serviceBundleId: "bundle-1",
        })
      ).resolves.toBeNull();
    });
  });

  it("clears stale cache when the current route catalog is empty", async () => {
    await withTempHome(async () => {
      await writeDaemonRouteCatalogCache({
        lane: "prod",
        ownerUserId: "usr_felix",
        routeCatalog: createRouteCatalog(
          "agt_11111111-1111-4111-8111-111111111111"
        ),
        serviceBundleId: "bundle-1",
      });

      await writeDaemonRouteCatalogCache({
        lane: "prod",
        ownerUserId: "usr_felix",
        routeCatalog: {
          profileIds: [],
          routeByProfileId: new Map(),
          skippedProfiles: [],
        },
        serviceBundleId: "bundle-1",
      });

      await expect(
        readDaemonRouteCatalogCache({
          lane: "prod",
          ownerUserId: "usr_felix",
          serviceBundleId: "bundle-1",
        })
      ).resolves.toBeNull();
    });
  });
});

function createRouteCatalog(profileId: string): RouteCatalog {
  return {
    profileIds: [profileId],
    routeByProfileId: new Map([
      [
        profileId,
        {
          agentControllerRef: "builtin:codex",
          contextIdMappingSpec: {
            sourceField: "OPENMELD_CLI_CONTEXT_ID",
            mappingVersion: 1,
          },
          profileId,
          streamingMode: "final",
          transportMode: "local-cli",
        },
      ],
    ]),
    skippedProfiles: [],
  };
}
