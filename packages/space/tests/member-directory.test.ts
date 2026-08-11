import type { SpaceIdentityDirectory } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { buildSpaceMemberDirectoryFromIdentityDirectory } from "../src";

describe("space member directory", () => {
  it("builds a lightweight active-member directory from identity facts", () => {
    const directory = buildSpaceMemberDirectoryFromIdentityDirectory({
      spaceId: "space-1",
      generatedAt: "2026-04-09T00:00:00.000Z",
      entries: [
        {
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          profileKind: "agent",
          profileName: "Watcher",
          mentionAlias: "watcher",
          ownerUserId: "usr-felix",
          ownerName: "Felix",
          agentControllerRef: "builtin:codex",
        },
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          profileName: "Mira",
          mentionAlias: null,
          ownerUserId: "usr-mira",
          ownerName: "Mira",
          agentControllerRef: null,
        },
      ],
    } satisfies SpaceIdentityDirectory);

    expect(directory).toEqual({
      spaceId: "space-1",
      generatedAt: "2026-04-09T00:00:00.000Z",
      members: [
        expect.objectContaining({
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          displayName: "Mira",
          primaryMentionLabel: "Mira",
          allowedRelations: {
            wake: false,
            reference: true,
          },
        }),
        expect.objectContaining({
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          profileKind: "agent",
          displayName: "Watcher",
          primaryMentionLabel: "Watcher",
          allowedRelations: {
            wake: true,
            reference: true,
          },
          agentCard: null,
          spaceRole: null,
        }),
      ],
    });
    expect(JSON.stringify(directory)).not.toContain("wakeAvailability");
    expect(JSON.stringify(directory)).not.toContain("agentControllerRef");
  });
});
