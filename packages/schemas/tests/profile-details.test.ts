import { describe, expect, it } from "vitest";
import { profileDetailsSnapshotSchema } from "../src/schemas/profile-details";

describe("Profile Details recovery action contract", () => {
  const activitySection = {
    id: "activity" as const,
    recoveryAction: {
      kind: "approve_queued_work" as const,
      visibility: "owner_self" as const,
    },
    rows: [
      {
        copy: null,
        id: "work_summary",
        label: "Work",
        source: "agent_profile_work_coordinator" as const,
        value: "Paused · 1 queued",
        valueKind: "status" as const,
        visibility: "all_viewers" as const,
      },
    ],
    title: "Activity",
  };

  it("keeps the snapshot strict and permits recovery only for its owner Activity section", () => {
    expect(
      profileDetailsSnapshotSchema.parse({
        context: "account",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        profileName: "Research Agent",
        sections: [activitySection],
        viewerScope: "owner_self",
      })
    ).toMatchObject({ sections: [activitySection] });

    expect(
      profileDetailsSnapshotSchema.safeParse({
        context: "account",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        profileName: "Research Agent",
        sections: [activitySection],
        viewerScope: "observer",
      }).success
    ).toBe(false);

    expect(
      profileDetailsSnapshotSchema.safeParse({
        context: "account",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        profileName: "Research Agent",
        sections: [
          {
            ...activitySection,
            id: "profile",
          },
        ],
        viewerScope: "owner_self",
      }).success
    ).toBe(false);
  });
});
