import { createAgentProfileBindingApi } from "@openmeld/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDaemonRouteCatalog,
  type RouteCatalogLoadPhaseTimings,
} from "../src/local-service/routing/route-catalog";

const getPrimaryBinding = vi.fn();
const listOpenMeldProfiles = vi.fn();
const resolveLocalDaemonRouteCandidate = vi.fn();
const syncDeviceRuntimeStateProjection = vi.fn();
const syncProfileWorkspaceState = vi.fn();

vi.mock("@openmeld/api-client", () => ({
  createAgentProfileBindingApi: vi.fn(),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  listOpenMeldProfiles: () => listOpenMeldProfiles(),
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: async () => "https://gateway.test",
}));

vi.mock("../src/local-service/routing/resolve-controller-support", () => ({
  readLocalEnabledControllers: async () => new Map(),
  resolveLocalDaemonRouteCandidate: (
    input: Parameters<typeof resolveLocalDaemonRouteCandidate>[0]
  ) => resolveLocalDaemonRouteCandidate(input),
}));

vi.mock("../src/local-service/reporting/device-runtime-state-sync", () => ({
  syncDeviceRuntimeStateProjection: (
    input: Parameters<typeof syncDeviceRuntimeStateProjection>[0]
  ) => syncDeviceRuntimeStateProjection(input),
}));

vi.mock("../src/system/profile-workspace-state", () => ({
  syncProfileWorkspaceState: (
    input: Parameters<typeof syncProfileWorkspaceState>[0]
  ) => syncProfileWorkspaceState(input),
}));

vi.mock("../src/system/expected-routes-read-session", () => ({
  createExpectedRoutesReadSession: () => ({
    read: () =>
      Promise.resolve({
        status: "legacy_endpoint_unavailable",
      }),
  }),
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: () => ({}),
}));

const QUIET_PRESENTER = {
  view: "agent",
  data: vi.fn(),
  event: vi.fn(),
  line: vi.fn(),
} as const;

describe("route catalog load phase timings", () => {
  beforeEach(() => {
    vi.mocked(createAgentProfileBindingApi).mockReturnValue({
      getPrimaryBinding,
    } as never);
    getPrimaryBinding.mockReset();
    listOpenMeldProfiles.mockReset();
    resolveLocalDaemonRouteCandidate.mockReset();
    syncDeviceRuntimeStateProjection.mockReset();
    syncProfileWorkspaceState.mockReset();
  });

  it("records list and resolve phases without repair phases in check mode", async () => {
    listOpenMeldProfiles.mockResolvedValue([
      createProfile("agt-1", "Agent One"),
    ]);
    getPrimaryBinding.mockResolvedValue({
      binding: { bindingId: "bind-1" },
      status: "found",
    });
    resolveLocalDaemonRouteCandidate.mockImplementation(({ profile }) => ({
      profileId: profile.openMeldProfileId,
      skipReason: "profile.binding.unbound",
      status: "skipped",
    }));

    const phaseTimings: RouteCatalogLoadPhaseTimings = {};
    await loadDaemonRouteCatalog({
      localAdapterContainer: {} as never,
      ownerUserId: "owner-1",
      phaseTimings,
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(phaseTimings.profilesListMs).toBeGreaterThanOrEqual(0);
    expect(phaseTimings.candidateResolveMs).toBeGreaterThanOrEqual(0);
    expect(phaseTimings.projectionRepairMs).toBeUndefined();
    expect(phaseTimings.workspaceRepairMs).toBeUndefined();
    expect(syncDeviceRuntimeStateProjection).not.toHaveBeenCalled();
    expect(syncProfileWorkspaceState).not.toHaveBeenCalled();
  });

  it("records repair phases in repair mode", async () => {
    listOpenMeldProfiles.mockResolvedValue([]);
    syncDeviceRuntimeStateProjection.mockResolvedValue({ status: "ok" });
    syncProfileWorkspaceState.mockResolvedValue({ status: "ok" });

    const phaseTimings: RouteCatalogLoadPhaseTimings = {};
    await loadDaemonRouteCatalog({
      localAdapterContainer: {} as never,
      localReplyStateMode: "repair",
      ownerUserId: "owner-1",
      phaseTimings,
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(phaseTimings.projectionRepairMs).toBeGreaterThanOrEqual(0);
    expect(phaseTimings.workspaceRepairMs).toBeGreaterThanOrEqual(0);
    expect(phaseTimings.profilesListMs).toBeGreaterThanOrEqual(0);
    expect(phaseTimings.candidateResolveMs).toBeGreaterThanOrEqual(0);
    expect(syncDeviceRuntimeStateProjection).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "repair" })
    );
    expect(syncProfileWorkspaceState).toHaveBeenCalledWith({ mode: "repair" });
  });

  it("still records the projection repair duration when repair fails", async () => {
    syncDeviceRuntimeStateProjection.mockRejectedValue(
      new Error("projection repair unavailable")
    );

    const phaseTimings: RouteCatalogLoadPhaseTimings = {};
    await expect(
      loadDaemonRouteCatalog({
        localAdapterContainer: {} as never,
        localReplyStateMode: "repair",
        ownerUserId: "owner-1",
        phaseTimings,
        presenter: QUIET_PRESENTER,
        quiet: true,
      })
    ).rejects.toThrow("local projection repair failed");

    expect(phaseTimings.projectionRepairMs).toBeGreaterThanOrEqual(0);
    expect(phaseTimings.workspaceRepairMs).toBeUndefined();
  });

  it("fails a route catalog load that never settles instead of blocking the Service", async () => {
    vi.useFakeTimers();
    try {
      const phaseTimings: RouteCatalogLoadPhaseTimings = {};
      const loadPromise = loadDaemonRouteCatalog({
        expectedRoutesRead: {
          read: () => new Promise(() => undefined),
        },
        loadTimeoutMs: 25,
        localAdapterContainer: {} as never,
        ownerUserId: "owner-1",
        phaseTimings,
        presenter: QUIET_PRESENTER,
        quiet: true,
      });
      const rejection = expect(loadPromise).rejects.toMatchObject({
        code: "route_catalog.load_timeout",
        phase: "expected_routes_read",
      });

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(phaseTimings.expectedRoutesReadMs).toBe(25);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createProfile(openMeldProfileId: string, profileName: string) {
  return {
    openMeldProfileId,
    ownerUserId: "owner-1",
    profileKind: "agent",
    profileName,
  };
}
