import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildSpaceSummaryFactsViewState,
  buildSpaceSummaryViewState,
  selectSpaceSummarySegments,
} from "../src/space/view/build-space-summary-view-state";
import type { SpaceSessionContext } from "../src/space/view/space-session-view-state";

describe("buildSpaceSummaryViewState", () => {
  it("derives compact summary facts from context and members snapshot", () => {
    const facts = buildSpaceSummaryFactsViewState({
      context: createSessionContext(),
      membersSnapshot: createMembersSnapshot(),
    });

    expect(facts).toEqual({
      spaceId:
        "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
      spaceName: "Ops Room",
      accessLabel: "anyone with the link",
      membersCount: 3,
      liveHumanCount: 1,
      liveAgentCount: 1,
      storageUsedBytes: null,
      storageSoftLimitBytes: null,
      storageUsagePercent: null,
    });
  });

  it("returns null counts when members data is unavailable", () => {
    const facts = buildSpaceSummaryFactsViewState({
      context: createSessionContext({
        session: {
          accessMode: null,
          passwordProtected: null,
          spaceName: null,
          visibility: null,
        },
      }),
      membersSnapshot: null,
    });

    expect(facts).toEqual({
      spaceId:
        "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
      spaceName: null,
      accessLabel: null,
      membersCount: null,
      liveHumanCount: null,
      liveAgentCount: null,
      storageUsedBytes: null,
      storageSoftLimitBytes: null,
      storageUsagePercent: null,
    });
  });

  it("hides zero-value segments in the composer footer preset", () => {
    const segments = selectSpaceSummarySegments({
      facts: {
        spaceId:
          "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
        spaceName: "Ops Room",
        accessLabel: "password required",
        membersCount: 2,
        liveHumanCount: 0,
        liveAgentCount: 2,
        storageUsedBytes: null,
        storageSoftLimitBytes: null,
        storageUsagePercent: null,
      },
      preset: "composer-footer",
    });

    expect(segments).toEqual([
      {
        key: "spaceName",
        text: "Ops Room",
      },
      {
        key: "accessLabel",
        text: "password required",
      },
      {
        key: "membersCount",
        text: "2 members",
      },
      {
        key: "liveAgentCount",
        text: "2 live agents",
      },
    ]);
  });

  it("includes storage only in the composer footer preset", () => {
    const viewState = buildSpaceSummaryViewState({
      context: createSessionContext({
        session: {
          storageUsedBytes: 2_100_000,
          storageSoftLimitBytes: 9_000_000,
          storageUsagePercent: 23.6,
        },
      }),
      membersSnapshot: createMembersSnapshot(),
    });

    expect(viewState.composerFooterSegments).toEqual([
      { key: "spaceName", text: "Ops Room" },
      { key: "accessLabel", text: "anyone with the link" },
      { key: "membersCount", text: "3 members" },
      { key: "liveHumanCount", text: "1 live human" },
      { key: "liveAgentCount", text: "1 live agent" },
      { key: "storageUsage", text: "2.1 MB ( 24% used )" },
    ]);
    expect(viewState.sessionSummarySegments).toEqual([
      { key: "spaceName", text: "Ops Room" },
      { key: "accessLabel", text: "anyone with the link" },
      { key: "membersCount", text: "3 members" },
      { key: "liveHumanCount", text: "1 live human" },
      { key: "liveAgentCount", text: "1 live agent" },
    ]);
  });

  it("shows zero storage usage when storage facts are available", () => {
    const segments = selectSpaceSummarySegments({
      facts: {
        spaceId:
          "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
        spaceName: "Ops Room",
        accessLabel: "anyone with the link",
        membersCount: 0,
        liveHumanCount: 0,
        liveAgentCount: 0,
        storageUsedBytes: 0,
        storageSoftLimitBytes: 9_000_000_000,
        storageUsagePercent: 0,
      },
      preset: "composer-footer",
    });

    expect(segments).toEqual([
      { key: "spaceName", text: "Ops Room" },
      { key: "accessLabel", text: "anyone with the link" },
      { key: "storageUsage", text: "0 KB ( 0% used )" },
    ]);
  });
});

function createSessionContext(
  overrides?: Omit<Partial<SpaceSessionContext>, "session"> & {
    session?: Partial<SpaceSessionContext["session"]>;
  }
): SpaceSessionContext {
  const { session: sessionOverrides, ...contextOverrides } = overrides ?? {};
  const baseSession: SpaceSessionContext["session"] = {
    accessMode: "public",
    passwordProtected: false,
    spaceCreatedAt: "2026-03-13T00:00:00.000Z",
    spaceCreatorId: "11111111-1111-4111-8111-111111111111",
    spaceCreatorName: "Felix",
    spaceId: "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
    spaceName: "Ops Room",
    visibility: "public",
  };

  return {
    surface: "active-session",
    connectionMode: "join",
    gatewayUrl: "http://localhost:8080",
    profile: {
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Felix",
      kind: "human",
      ownerUserId: "user_felix",
      ownerName: "Felix",
    },
    ...contextOverrides,
    session: {
      ...baseSession,
      ...sessionOverrides,
    },
  };
}

function createMembersSnapshot(): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: [
      createSpaceMemberAgentSnapshot({
        addedAt: "2026-03-13T00:00:00.000Z",
        addedByDisplayName: "Felix",
        addedByOwnerUserId: "user_felix",
        addedByProfileId: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-03-13T00:00:00.000Z",
        liveNow: true,
        ownerName: "Felix",
        ownerUserId: "user_felix",
        profileId: "agt_ops",
        profileName: "Ops Bot",
        updatedAt: "2026-03-13T00:00:00.000Z",
      }),
      createSpaceMemberAgentSnapshot({
        addedAt: "2026-03-13T00:00:00.000Z",
        addedByDisplayName: "Felix",
        addedByOwnerUserId: "user_felix",
        addedByProfileId: "11111111-1111-4111-8111-111111111111",
        agentControllerRef: "builtin:openclaw",
        createdAt: "2026-03-13T00:00:00.000Z",
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: "2026-03-12T00:00:00.000Z",
        lastSeenLabel: "Seen 1d ago",
        ownerName: "Felix",
        ownerUserId: "user_felix",
        profileId: "agt_watcher",
        profileName: "Watcher",
        updatedAt: "2026-03-13T00:00:00.000Z",
        wakeabilityReasonCodes: ["profile.unbound"],
        wakeabilityReasonText: "This profile currently has no daemon route",
        wakeabilityStatus: "blocked",
      }),
    ],
    generatedAt: "2026-03-13T00:00:00.000Z",
    humans: [
      createSpaceMemberHumanSnapshot({
        addedAt: "2026-03-13T00:00:00.000Z",
        createdAt: "2026-03-13T00:00:00.000Z",
        firstEnteredAt: "2026-03-13T00:00:00.000Z",
        lastEnteredAt: "2026-03-13T00:00:00.000Z",
        lastSeenAt: "2026-03-13T00:00:00.000Z",
        lastSeenLabel: "Seen now",
        liveNow: true,
        ownerName: null,
        ownerUserId: null,
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Felix",
        updatedAt: "2026-03-13T00:00:00.000Z",
      }),
    ],
    spaceId: "space-1",
  });
}
