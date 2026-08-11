import { createAgentProfileBindingApi } from "@openmeld/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDaemonRouteCatalog } from "../src/local-service/routing/route-catalog";
import type { PrimaryBindingReadSession } from "../src/system/primary-binding-read-session";

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

const createProfile = (openMeldProfileId: string) => ({
  openMeldProfileId,
  ownerUserId: "owner-1",
  profileKind: "agent",
  profileName: `Profile ${openMeldProfileId}`,
  status: "active",
});

describe("route catalog binding read sharing", () => {
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

  it("repair-mode projection and catalog resolve share one read per profile", async () => {
    const profile = createProfile("agt-shared");
    listOpenMeldProfiles.mockResolvedValue([profile]);
    getPrimaryBinding.mockResolvedValue({
      binding: { bindingId: "bind-shared" },
      status: "found",
    });
    resolveLocalDaemonRouteCandidate.mockImplementation(
      ({ profile: candidateProfile }) => ({
        profileId: candidateProfile.openMeldProfileId,
        skipReason: "profile.binding.unbound",
        status: "skipped",
      })
    );
    // The repair-mode projection consults the same profile binding through
    // the session handed down by the catalog load.
    syncDeviceRuntimeStateProjection.mockImplementation(
      async (input: { bindingReads?: PrimaryBindingReadSession }) => {
        await input.bindingReads?.readPrimaryBinding(profile as never);
        return { status: "ok" };
      }
    );
    syncProfileWorkspaceState.mockResolvedValue({ status: "ok" });

    await loadDaemonRouteCatalog({
      localAdapterContainer: {} as never,
      localReplyStateMode: "repair",
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(syncDeviceRuntimeStateProjection).toHaveBeenCalledTimes(1);
    // One HTTP read total for the profile: projection repair + catalog
    // candidate resolution shared the session instead of fanning out twice.
    expect(getPrimaryBinding).toHaveBeenCalledTimes(1);
  });

  it("uses a caller-provided session so outer operations can share reads", async () => {
    const profile = createProfile("agt-outer");
    listOpenMeldProfiles.mockResolvedValue([profile]);
    getPrimaryBinding.mockResolvedValue({
      binding: { bindingId: "bind-outer" },
      status: "found",
    });
    resolveLocalDaemonRouteCandidate.mockImplementation(
      ({ profile: candidateProfile }) => ({
        profileId: candidateProfile.openMeldProfileId,
        skipReason: "profile.binding.unbound",
        status: "skipped",
      })
    );

    const reads = new Map<string, Promise<unknown>>();
    const outerSession: PrimaryBindingReadSession = {
      readPrimaryBinding: (readProfile) => {
        const existing = reads.get(readProfile.openMeldProfileId);
        if (existing) {
          return existing as never;
        }
        const read = getPrimaryBinding({
          agentProfileId: readProfile.openMeldProfileId,
        });
        reads.set(readProfile.openMeldProfileId, read);
        return read as never;
      },
    };

    await outerSession.readPrimaryBinding(profile as never);
    await loadDaemonRouteCatalog({
      bindingReads: outerSession,
      localAdapterContainer: {} as never,
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(getPrimaryBinding).toHaveBeenCalledTimes(1);
  });
});
