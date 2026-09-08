import { createLocalAdapterContainer } from "@openmeld/local-service";
import { expect, it, vi } from "vitest";
import {
  createMutableRouteCatalogState,
  loadFreshDaemonRouteCatalog,
  syncDaemonRouteCatalogState,
} from "../src/local-service/carrier/service-runner";
import type { RouteCatalog } from "../src/local-service/core/types";
import { syncLocalServiceRuntimeAgentControllerReports } from "../src/local-service/reporting/runtime-agent-controller-report-sync";

const { discover, readRoutes } = vi.hoisted(() => ({
  discover: vi.fn(),
  readRoutes: vi.fn(),
}));

vi.mock("../src/agents/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/agents/registry")>()),
  reconcileNewRunnableBuiltinAgentRegistrations: discover,
}));
vi.mock(
  "../src/local-service/inventory/agent-controller-inventory",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/inventory/agent-controller-inventory")
    >()),
    collectLocalAgentControllerInventory: vi.fn(async () => ({
      capabilities: [],
    })),
  })
);
vi.mock(
  "../src/local-service/routing/route-catalog",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/routing/route-catalog")
    >()),
    loadDaemonRouteCatalog: readRoutes,
  })
);

it("does not gate existing-controller routes on unrelated install discovery", async () => {
  let releaseDiscovery!: () => void;
  const heldDiscovery = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  discover.mockReturnValue(heldDiscovery);
  const localAdapterContainer = createLocalAdapterContainer([]);
  const background = syncLocalServiceRuntimeAgentControllerReports({
    localAdapterContainer,
  });
  const profileIds = Array.from(
    { length: 64 },
    (_, index) => `agt-test-${index}`
  );
  const catalog: RouteCatalog = {
    profileIds,
    routeByProfileId: new Map(
      profileIds.map((profileId) => [
        profileId,
        {
          profileId,
          agentControllerRef: "builtin:codex",
          contextIdMappingSpec: {
            mappingVersion: 1,
            sourceField: "OPENMELD_CLI_CONTEXT_ID",
          },
          streamingMode: "final",
          transportMode: "codex-app-server",
        },
      ])
    ),
    skippedProfiles: [],
  };
  readRoutes.mockResolvedValue(catalog);
  const load = loadFreshDaemonRouteCatalog({
    localAdapterContainer,
    ownerUserId: "test-owner",
    presenter: { view: "agent", event: vi.fn(), line: vi.fn(), data: vi.fn() },
  });
  try {
    await expect
      .poll(() => readRoutes.mock.calls.length, { timeout: 100 })
      .toBe(1);
    expect(await load).toBe(catalog);
    expect(discover).toHaveBeenCalledTimes(1);
    const state = createMutableRouteCatalogState({
      ...catalog,
      profileIds: profileIds.slice(0, 63),
      routeByProfileId: new Map([...catalog.routeByProfileId].slice(0, 63)),
    });
    const leasesByProfileId = new Map(
      profileIds.slice(0, 63).map((id) => [id, 1])
    );
    const registerCatalog = vi.fn(async () => ({
      acceptedLeases: profileIds.map((profileId) => ({
        profileId,
        leaseEpoch: 1,
      })),
      connectionGeneration: 1,
      ok: true as const,
      rejectedProfiles: [],
    }));
    const result = await syncDaemonRouteCatalogState({
      catalogState: state,
      leasesByProfileId,
      loadCatalog: () => load,
      registerCatalog,
    });
    expect(result.status).toBe("changed");
    expect(registerCatalog).toHaveBeenCalledTimes(1);
    expect(state.profileIds).toEqual(profileIds);
    expect(leasesByProfileId.size).toBe(64);
  } finally {
    releaseDiscovery?.();
    await load;
    await background;
  }
});
