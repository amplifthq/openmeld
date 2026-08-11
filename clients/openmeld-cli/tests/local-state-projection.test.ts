import { describe, expect, it } from "vitest";
import {
  projectSpaceFacts,
  projectSpaceProfileCache,
} from "../src/space/local-state-projection";

describe("local state projections", () => {
  it("projects space facts without leaking profile-in-space cache fields", () => {
    const projected = projectSpaceFacts({
      v: 2,
      schemaVersion: 1,
      source: "local-cache",
      syncedAt: "2026-03-19T10:00:00.000Z",
      staleAt: "2026-03-19T11:00:00.000Z",
      baseUrl: "https://gateway.example.com",
      space: "space-1",
      name: "Ops Room",
      openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Ops Bot",
      role: "helper",
      mentionAlias: "ops_bot",
      creator: {
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Felix",
        kind: "human",
      },
      passwordProtected: true,
      spaceCreatedAt: "2026-03-19T09:00:00.000Z",
      spaceUpdatedAt: "2026-03-19T10:00:00.000Z",
      lastSeenTs: 42,
      recentMentionProfileIds: ["agt_2"],
      createdAt: "2026-03-19T09:00:00.000Z",
      updatedAt: "2026-03-19T10:00:00.000Z",
    });

    expect(projected).toEqual({
      baseUrl: "https://gateway.example.com",
      spaceId: "space-1",
      name: "Ops Room",
      creator: {
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Felix",
        kind: "human",
      },
      passwordProtected: true,
      spaceCreatedAt: "2026-03-19T09:00:00.000Z",
      spaceUpdatedAt: "2026-03-19T10:00:00.000Z",
      syncedAt: "2026-03-19T10:00:00.000Z",
      staleAt: "2026-03-19T11:00:00.000Z",
      createdAt: "2026-03-19T09:00:00.000Z",
      updatedAt: "2026-03-19T10:00:00.000Z",
    });
  });

  it("projects profile-in-space cache without leaking space facts", () => {
    const projected = projectSpaceProfileCache({
      v: 2,
      schemaVersion: 1,
      source: "local-cache",
      syncedAt: "2026-03-19T10:00:00.000Z",
      baseUrl: "https://gateway.example.com",
      space: "space-1",
      openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      profileHandle: "ops-bot",
      profileName: "Ops Bot",
      role: "helper",
      mentionAlias: "ops_bot",
      lastSeenTs: 42,
      recentMentionProfileIds: ["agt_2", "agt_3"],
      createdAt: "2026-03-19T09:00:00.000Z",
      updatedAt: "2026-03-19T10:00:00.000Z",
    });

    expect(projected).toEqual({
      openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      profileHandle: "ops-bot",
      profileName: "Ops Bot",
      role: "helper",
      mentionAlias: "ops_bot",
      lastSeenTs: 42,
      recentMentionProfileIds: ["agt_2", "agt_3"],
    });
  });
});
