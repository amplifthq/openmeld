import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_NAME,
  DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_VERSION,
  daemonRouteCatalogCacheSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

const route = {
  agentControllerRef: "builtin:codex",
  contextIdMappingSpec: {
    mappingVersion: 1 as const,
    sourceField: "OPENMELD_CLI_CONTEXT_ID",
  },
  profileId: "agt_11111111-1111-4111-8111-111111111111",
  streamingMode: "final" as const,
  transportMode: "local-cli" as const,
};

function createCache(input: { schema: string; v: number }) {
  return {
    ...input,
    cachedAt: "2026-07-28T00:00:00.000Z",
    lane: "prod",
    ownerUserId: "owner-1",
    profileIds: [route.profileId],
    routes: [route],
    runtimeContractEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    serviceBundleId: "bundle-1",
    skippedProfiles: [],
  };
}

describe("daemon route catalog cache", () => {
  it("keeps legacy v2 caches readable", () => {
    expect(
      daemonRouteCatalogCacheSchema.safeParse(
        createCache({
          schema: "openmeld-daemon-route-catalog-cache-v2",
          v: 2,
        })
      ).success
    ).toBe(true);
  });

  it("writes v4 and carries binding revision with Codex Collaboration Mode", () => {
    const parsed = daemonRouteCatalogCacheSchema.parse({
      ...createCache({
        schema: DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_NAME,
        v: DAEMON_ROUTE_CATALOG_CACHE_SCHEMA_VERSION,
      }),
      routes: [
        {
          ...route,
          agentControllerCollaborationMode: "codex:plan",
          bindingId: "binding-1",
          configurationRevision: 2,
          conversationPolicy: { collaborationMode: "plan" },
          openMeldServiceRuntimeId: "runtime-1",
        },
      ],
    });

    expect(parsed.v).toBe(4);
    expect(parsed.routes[0]?.bindingId).toBe("binding-1");
    expect(parsed.routes[0]?.configurationRevision).toBe(2);
    expect(parsed.routes[0]?.agentControllerCollaborationMode).toBe(
      "codex:plan"
    );
  });
});
