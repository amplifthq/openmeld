import { describe, expect, it, vi } from "vitest";
import {
  publishAgentReadinessInvalidationToSpaces,
  resolveRouteCatalogChangedInvalidationProfileIds,
} from "../runtime-transport/application/agent-readiness-invalidation-service";

describe("resolveRouteCatalogChangedInvalidationProfileIds", () => {
  it("narrows the invalidation to the scoped profiles when provided", () => {
    expect(
      resolveRouteCatalogChangedInvalidationProfileIds({
        scopedProfileIds: ["agt-changed"],
        sessionProfileIds: ["agt-changed", "agt-other-1", "agt-other-2"],
      })
    ).toEqual(["agt-changed"]);
  });

  it("keeps the whole-owner fan-out for unscoped changes", () => {
    expect(
      resolveRouteCatalogChangedInvalidationProfileIds({
        scopedProfileIds: [],
        sessionProfileIds: ["agt-a", "agt-b"],
      })
    ).toEqual(["agt-a", "agt-b"]);
  });

  it("trusts a scoped set even when it names profiles outside the sessions", () => {
    // A binding can change while its daemon is disconnected; that profile's
    // readiness verdict still changed, so it must be invalidated even though
    // no session currently carries it.
    expect(
      resolveRouteCatalogChangedInvalidationProfileIds({
        scopedProfileIds: ["agt-offline-device"],
        sessionProfileIds: [],
      })
    ).toEqual(["agt-offline-device"]);
  });
});

describe("agent readiness invalidation service", () => {
  it("groups readiness invalidations by active Space and dedupes profile ids", async () => {
    const broadcastSpaceAgentReadinessInvalidated = vi
      .fn()
      .mockResolvedValue(undefined);
    const listActiveSpaceIdsForProfile = vi.fn(
      ({ profileId }: { profileId: string }) => {
        if (profileId === "agt-1") {
          return Promise.resolve(["space-a", "space-b", "space-a"]);
        }
        if (profileId === "agt-2") {
          return Promise.resolve(["space-a"]);
        }
        return Promise.resolve([]);
      }
    );

    await publishAgentReadinessInvalidationToSpaces({
      profileIds: ["agt-1", "agt-2", "agt-1", " "],
      reason: "daemon.session.registered",
      ports: {
        broadcastSpaceAgentReadinessInvalidated,
        listActiveSpaceIdsForProfile,
      },
    });

    expect(listActiveSpaceIdsForProfile).toHaveBeenCalledTimes(2);
    expect(broadcastSpaceAgentReadinessInvalidated).toHaveBeenCalledTimes(2);
    expect(broadcastSpaceAgentReadinessInvalidated).toHaveBeenCalledWith({
      agentProfileIds: ["agt-1", "agt-2"],
      reason: "daemon.session.registered",
      spaceId: "space-a",
    });
    expect(broadcastSpaceAgentReadinessInvalidated).toHaveBeenCalledWith({
      agentProfileIds: ["agt-1"],
      reason: "daemon.session.registered",
      spaceId: "space-b",
    });
  });

  it("keeps publishing other Spaces when one lookup or broadcast fails", async () => {
    const warn = vi.fn();
    const broadcastSpaceAgentReadinessInvalidated = vi
      .fn()
      .mockImplementation(({ spaceId }: { spaceId: string }) => {
        if (spaceId === "space-failing") {
          return Promise.reject(new Error("broadcast failed"));
        }
        return Promise.resolve();
      });
    const listActiveSpaceIdsForProfile = vi.fn(
      ({ profileId }: { profileId: string }) => {
        if (profileId === "agt-failing-lookup") {
          return Promise.reject(new Error("lookup failed"));
        }
        if (profileId === "agt-1") {
          return Promise.resolve(["space-ok", "space-failing"]);
        }
        return Promise.resolve([]);
      }
    );

    await publishAgentReadinessInvalidationToSpaces({
      profileIds: ["agt-failing-lookup", "agt-1"],
      reason: "daemon.route_lease.expired",
      ports: {
        broadcastSpaceAgentReadinessInvalidated,
        listActiveSpaceIdsForProfile,
        warn,
      },
    });

    expect(broadcastSpaceAgentReadinessInvalidated).toHaveBeenCalledWith({
      agentProfileIds: ["agt-1"],
      reason: "daemon.route_lease.expired",
      spaceId: "space-ok",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "agt-failing-lookup",
        reasonCode: "agent.readiness.invalidation.space_index_lookup_failed",
      })
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "agent.readiness.invalidation.space_broadcast_failed",
        spaceId: "space-failing",
      })
    );
  });
});
