import { createAgentProfileBindingApi } from "@openmeld/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDaemonRouteCatalog } from "../src/local-service/routing/route-catalog";

const getPrimaryBinding = vi.fn();
const listOpenMeldProfiles = vi.fn();
const resolveLocalDaemonRouteCandidate = vi.fn();

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
  readLocalEnabledControllers: async () => new Set(["codex"]),
  resolveLocalDaemonRouteCandidate: (
    input: Parameters<typeof resolveLocalDaemonRouteCandidate>[0]
  ) => resolveLocalDaemonRouteCandidate(input),
}));

vi.mock("../src/profile-workspace/runtime-resolution", () => ({
  resolveProfileWorkspaceRuntime: async () => ({
    fingerprint: "sha256:test",
    path: "/tmp/openmeld-profile",
    reasonCode: null,
    reasonText: null,
    runtimeContext: {
      providerRuntimeWorkingDirectory: "/tmp/openmeld-profile",
    },
    status: "ready",
    workspaceMode: "openmeld_managed",
  }),
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

describe("route catalog", () => {
  beforeEach(() => {
    vi.mocked(createAgentProfileBindingApi).mockReturnValue({
      getPrimaryBinding,
    } as never);
    getPrimaryBinding.mockReset();
    listOpenMeldProfiles.mockReset();
    resolveLocalDaemonRouteCandidate.mockReset();
  });

  it("keeps routable profiles when one profile binding read is unavailable", async () => {
    listOpenMeldProfiles.mockResolvedValue([
      createProfile("agt-ready", "Ready Codex"),
      createProfile("agt-binding-down", "Binding API Down"),
    ]);
    getPrimaryBinding.mockImplementation(({ agentProfileId }) => {
      if (agentProfileId === "agt-binding-down") {
        return Promise.reject(new Error("gateway fetch failed"));
      }
      return Promise.resolve({
        binding: {
          bindingId: "bind-ready",
        },
        status: "found",
      });
    });
    resolveLocalDaemonRouteCandidate.mockImplementation(
      ({ primaryBinding, profile }) => {
        if (!primaryBinding) {
          return {
            profileId: profile.openMeldProfileId,
            skipReason: "profile.binding.unbound",
            status: "skipped",
          };
        }
        return {
          profileId: profile.openMeldProfileId,
          route: {
            agentControllerConversationId: null,
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime-ready",
            bindingId: primaryBinding.bindingId,
            contextIdMappingSpec: null,
            profileId: profile.openMeldProfileId,
            streamingMode: "final",
            transportMode: "local-cli",
          },
          status: "accepted",
        };
      }
    );

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: {} as never,
      ownerUserId: "owner-1",
      presenter: {
        view: "agent",
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      },
      quiet: true,
    });

    expect(catalog.profileIds).toEqual(["agt-ready"]);
    expect(catalog.routeByProfileId.get("agt-ready")?.bindingId).toBe(
      "bind-ready"
    );
    expect(catalog.skippedProfiles).toEqual([
      {
        profileId: "agt-binding-down",
        profileName: "Binding API Down",
        skipReason: "profile.binding.read_unavailable",
      },
    ]);
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
