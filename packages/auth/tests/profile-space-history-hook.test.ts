import { describe, expect, it } from "vitest";
import type {
  ProfileSpaceHistoryRecord,
  ProfileSpaceHistoryRepository,
} from "../src/profiles/profile-space-history-repository";
import {
  createProfileSpaceHistoryService,
  type ProfileSpaceHistoryServiceHooks,
} from "../src/profiles/profile-space-history-service";

// Reliability proof for the Space Index overlay announcement hook
// (physical-db-split.md P0.3). The Profile domain owns the history write; the
// onHistoryWritten hook is the fire-and-forget bridge to the Core overlay
// projection. These tests pin two invariants the Gate-3 read path depends on:
// (1) the hook fires on every successful history mutation path, and
// (2) a failing hook never fails (or alters) the history write.

function makeRecord(
  overrides: Partial<ProfileSpaceHistoryRecord> = {}
): ProfileSpaceHistoryRecord {
  return {
    profileId: "human-1",
    gatewayHost: "gateway.openmeld.invalid",
    spaceId: "space-1",
    spaceName: "Space One",
    creatorProfileId: "human-1",
    creatorKind: "human",
    spaceCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
    spaceUpdatedAt: new Date("2026-06-02T00:00:00.000Z"),
    lastJoinedAt: new Date("2026-06-03T00:00:00.000Z"),
    lastSeenTs: 1000,
    pinnedAt: new Date("2026-06-04T00:00:00.000Z"),
    status: "active",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-05T00:00:00.000Z"),
    ...overrides,
  };
}

function createStubRepository(
  overrides: Partial<ProfileSpaceHistoryRepository> = {}
): ProfileSpaceHistoryRepository {
  return {
    listByProfileAndGateway: () => Promise.resolve([]),
    listByProfilesAndGateway: () => Promise.resolve([]),
    listAccessibleSpaceIds: () => Promise.resolve([]),
    upsert: (input) =>
      Promise.resolve(
        makeRecord({
          profileId: input.profileId,
          gatewayHost: input.gatewayHost,
          spaceId: input.spaceId,
        })
      ),
    updateStatus: (input) =>
      Promise.resolve(
        makeRecord({
          profileId: input.profileId,
          gatewayHost: input.gatewayHost,
          spaceId: input.spaceId,
          status: input.status,
        })
      ),
    ...overrides,
  };
}

describe("profile space-history overlay announcement hook", () => {
  it("fires onHistoryWritten after a successful upsertHistory with the written record", async () => {
    const announced: ProfileSpaceHistoryRecord[] = [];
    const hooks: ProfileSpaceHistoryServiceHooks = {
      onHistoryWritten: (record) => announced.push(record),
    };
    const service = createProfileSpaceHistoryService(
      createStubRepository(),
      hooks
    );

    const result = await service.upsertHistory({
      profileId: "human-1",
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: "space-1",
      lastJoinedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    expect(announced).toStrictEqual([result]);
    expect(result.spaceId).toBe("space-1");
  });

  it("fires onHistoryWritten after updateStatus resolves an existing row", async () => {
    const announced: ProfileSpaceHistoryRecord[] = [];
    const service = createProfileSpaceHistoryService(createStubRepository(), {
      onHistoryWritten: (record) => announced.push(record),
    });

    await service.updateStatus({
      profileId: "human-1",
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: "space-1",
      status: "removed",
    });

    expect(announced).toEqual([expect.objectContaining({ status: "removed" })]);
  });

  it("fires onHistoryWritten on the updateStatus fallback (no existing row -> upsert)", async () => {
    const announced: ProfileSpaceHistoryRecord[] = [];
    const service = createProfileSpaceHistoryService(
      createStubRepository({
        updateStatus: () => Promise.resolve(null),
      }),
      { onHistoryWritten: (record) => announced.push(record) }
    );

    await service.updateStatus({
      profileId: "human-1",
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: "space-1",
      status: "inaccessible",
    });

    expect(announced).toEqual([
      expect.objectContaining({ spaceId: "space-1" }),
    ]);
  });

  it("does not fail or alter the history write when the hook throws", async () => {
    const service = createProfileSpaceHistoryService(createStubRepository(), {
      onHistoryWritten: () => {
        throw new Error("core overlay RPC unreachable");
      },
    });

    const result = await service.upsertHistory({
      profileId: "human-1",
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: "space-1",
      lastJoinedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    // The write still returns its record; the hook failure is swallowed.
    expect(result.spaceId).toBe("space-1");
  });

  it("completes the history write even with no hook configured", async () => {
    const service = createProfileSpaceHistoryService(createStubRepository());
    const result = await service.upsertHistory({
      profileId: "human-1",
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: "space-1",
      lastJoinedAt: new Date("2026-06-03T00:00:00.000Z"),
    });
    expect(result.spaceId).toBe("space-1");
  });
});
