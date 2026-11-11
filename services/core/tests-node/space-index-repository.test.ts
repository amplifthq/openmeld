import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { listAuthorizedMemberAgentDirectMessageSessions } from "../src/space/application/member-agent-direct-message-session-list";
import type { SpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import {
  projectActiveSpaceIndexSnapshot,
  projectDeletedSpaceIndexSnapshot,
} from "../src/space-index/space-index-projection-service";
import {
  diagnoseSpaceIndexProjectionDrift,
  listAccountSpaceIdsFromSpaceIndex,
  listAccountSpacesFromSpaceIndex,
  listDirectMessageSessionIndexRows,
  listOrganizationSpacesFromSpaceIndex,
  readSpaceIndexOrganizationJoinTarget,
  writeDirectMessageSessionArchivedAt,
} from "../src/space-index/space-index-repository";
import { projectSpaceMessagePreview } from "../src/space-index/space-message-preview";
import {
  createFaultInjectingPostgresDatabase,
  createPostgresHarness,
} from "./helpers/postgresql-harness.test-support";

describe("space index AccountSpaces read model", () => {
  it("does not inherit private Space membership through the Organization Center Agent", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const meta = {
        ...createMeta({
          name: "Private review",
          spaceId: "private-review",
          updatedAt: "2026-09-09T00:00:00.000Z",
        }),
        accessMode: "members_only" as const,
        creator: {
          kind: "human" as const,
          ownerUserId: "owner-other",
          profileId: "human-other",
          profileName: "Other",
        },
      };
      const centerMember = {
        ...createMember({
          addedAt: meta.updatedAt,
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileKindSnapshot: "agent",
          profileNameSnapshot: "Center Agent",
          spaceId: meta.spaceId,
        }),
        ownerUserIdSnapshot: null,
        ownerNameSnapshot: null,
      };
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: meta,
        memberRecords: [centerMember],
      });
      const accountQuery = {
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account" as const,
        selectedProfileId: "human-1",
      };
      expect(
        (await listAccountSpacesFromSpaceIndex(accountQuery)).spaceItems
      ).toEqual([]);
      const organizationQuery = {
        db: harness.db,
        generatedAt: meta.updatedAt,
        limit: 10,
        organizationId: "org-1",
        ownerUserId: null,
        profileId: "agt_33333333-3333-4333-8333-333333333333",
      };
      expect(
        (
          await listOrganizationSpacesFromSpaceIndex(organizationQuery)
        ).spaces.map((space) => space.spaceId)
      ).toEqual([meta.spaceId]);
      expect(
        (
          await listOrganizationSpacesFromSpaceIndex({
            ...organizationQuery,
            profileId: "agent-other",
          })
        ).spaces
      ).toEqual([]);
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: meta,
        memberRecords: [
          centerMember,
          createMember({
            addedAt: meta.updatedAt,
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: meta.spaceId,
          }),
        ],
      });
      expect(
        (await listAccountSpacesFromSpaceIndex(accountQuery)).spaceItems.map(
          (space) => space.spaceId
        )
      ).toEqual([meta.spaceId]);
    } finally {
      await harness.close();
    }
  });
  it("opts in to the first three active members without exposing other Spaces", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const members = [
        "human-1",
        "human-2",
        "agent-1",
        "agent-2",
        "agent-3",
        "agent-4",
        "agent-5",
        "agent-6",
        "agent-7",
      ].map((profileId, index) => ({
        ...createMember({
          addedAt: `2026-04-10T00:0${index + 1}:00.000Z`,
          profileId,
          profileKindSnapshot: profileId.startsWith("human")
            ? ("human" as const)
            : ("agent" as const),
          profileNameSnapshot: profileId,
          spaceId: "shared",
        }),
        controllerRefSnapshot: profileId.startsWith("agent") ? "codex" : null,
      }));
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Shared",
          spaceId: "shared",
          updatedAt: "2026-04-11T00:00:00.000Z",
        }),
        memberRecords: [
          createRemovedMember({
            addedAt: "2026-04-09T00:00:00.000Z",
            removedAt: "2026-04-10T00:00:00.000Z",
            profileId: "removed",
            profileNameSnapshot: "Removed",
            profileKindSnapshot: "human",
            spaceId: "shared",
          }),
          ...members.reverse(),
        ],
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Private",
          spaceId: "private",
          updatedAt: "2026-04-11T00:00:00.000Z",
        }),
        memberRecords: [
          {
            ...createMember({
              addedAt: "2026-04-10T00:00:00.000Z",
              profileId: "other",
              profileNameSnapshot: "Other",
              profileKindSnapshot: "human",
              spaceId: "private",
            }),
            ownerUserIdSnapshot: "owner-other",
          },
        ],
      });
      const input = {
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 500,
        ownerUserId: "owner-1",
        scope: "account" as const,
        selectedProfileId: "human-1",
      };
      const legacy = await listAccountSpacesFromSpaceIndex(input);
      expect(legacy.spaceItems[0]).not.toHaveProperty("memberPreviews");
      const result = await listAccountSpacesFromSpaceIndex({
        ...input,
        includeMemberPreviews: true,
      });
      expect(result.spaceItems.map((item) => item.spaceId)).toEqual(["shared"]);
      expect(result.spaceItems[0]?.memberPreviews).toEqual([
        {
          profileId: "human-1",
          profileName: "human-1",
          profileKind: "human",
          agentControllerRef: null,
        },
        {
          profileId: "human-2",
          profileName: "human-2",
          profileKind: "human",
          agentControllerRef: null,
        },
        {
          profileId: "agent-1",
          profileName: "agent-1",
          profileKind: "agent",
          agentControllerRef: "codex",
        },
      ]);
      const directory = await listAccountSpacesFromSpaceIndex({
        ...input,
        includeDirectoryPreviews: true,
      });
      expect(
        directory.spaceItems[0]?.memberPreviews?.map(
          (member) => member.profileId
        )
      ).toEqual([
        "human-1",
        "human-2",
        "agent-1",
        "agent-2",
        "agent-3",
        "agent-4",
        "agent-5",
        "agent-6",
      ]);
    } finally {
      await harness.close();
    }
  });
  it("projects bounded Space entry guidance without reading Space content", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Leadership",
          spaceId: "space-entry",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [],
      });
      await expect(
        readSpaceIndexOrganizationJoinTarget({
          db: harness.db,
          spaceId: "space-entry",
        })
      ).resolves.toEqual({
        creatorProfileId: "human-1",
        creatorProfileName: "Mira",
        organizationId: "org-1",
        spaceId: "space-entry",
        spaceName: "Leadership",
        visibility: "private",
      });
    } finally {
      await harness.close();
    }
  });
  it("reads SpaceIndex truth with account/profile scope, backend limit, dedupe, and history overlay", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Alpha",
          spaceId: "space-alpha",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-alpha",
          }),
          createMember({
            addedAt: "2026-04-10T00:02:00.000Z",
            profileId: "agent-1",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Codex",
            spaceId: "space-alpha",
          }),
        ],
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Beta",
          spaceId: "space-beta",
          updatedAt: "2026-04-11T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-11T00:01:00.000Z",
            profileId: "agent-1",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Codex",
            spaceId: "space-beta",
          }),
        ],
      });
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-12T00:00:00.000Z"),
        pinnedAt: Date.parse("2026-04-13T00:00:00.000Z"),
        profileId: "agent-1",
        spaceId: "space-alpha",
      });
      const accountLimited = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 1,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      expect(accountLimited.pinnedItems).toHaveLength(1);
      expect(accountLimited.spaceItems).toHaveLength(0);
      expect(accountLimited.pinnedItems[0]).toMatchObject({
        lastJoinedAt: "2026-04-12T00:00:00.000Z",
        lastSeenTs: null,
        openProfileId: "agent-1",
        openProfileName: "Codex",
        pinnedAt: "2026-04-13T00:00:00.000Z",
        pinnedProfileIds: ["agent-1"],
        spaceId: "space-alpha",
        spaceName: "Alpha",
      });
      expect(accountLimited.pinnedItems[0]?.joinedProfiles).toEqual([
        {
          lastJoinedAt: "2026-04-12T00:00:00.000Z",
          pinnedAt: "2026-04-13T00:00:00.000Z",
          profileId: "agent-1",
          profileName: "Codex",
        },
        {
          lastJoinedAt: "2026-04-10T00:01:00.000Z",
          pinnedAt: null,
          profileId: "human-1",
          profileName: "Mira",
        },
      ]);
      const humanScoped = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "profile",
        selectedProfileId: "human-1",
      });
      expect(humanScoped.pinnedItems).toHaveLength(0);
      expect(humanScoped.spaceItems.map((item) => item.spaceId)).toEqual([
        "space-alpha",
      ]);
      const agentScoped = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "profile",
        selectedProfileId: "agent-1",
      });
      expect(
        [...agentScoped.pinnedItems, ...agentScoped.spaceItems].map(
          (item) => item.spaceId
        )
      ).toEqual(["space-alpha", "space-beta"]);
    } finally {
      await harness.close();
    }
  });
  it("only returns Space purpose when AccountSpaces callers opt in", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Project Alpha",
          purpose: "project_alpha",
          spaceId: "space-alpha",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-alpha",
          }),
        ],
      });
      const legacy = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const withPurposes = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        includePurposes: true,
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      expect(legacy.spaceItems[0]).not.toHaveProperty("spacePurpose");
      expect(withPurposes.spaceItems[0]).toMatchObject({
        spaceId: "space-alpha",
        spacePurpose: "project_alpha",
      });
    } finally {
      await harness.close();
    }
  });
  it("hides legacy Welcoming Spaces from current account and organization lists", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Mira's OpenMeld Welcoming Space",
          purpose: "openmeld_welcoming_space",
          spaceId: "space-welcome",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-welcome",
          }),
        ],
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Project Alpha",
          spaceId: "space-alpha",
          updatedAt: "2026-04-11T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-11T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-alpha",
          }),
        ],
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        includePurposes: true,
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const organizationSpaces = await listOrganizationSpacesFromSpaceIndex({
        db: harness.db,
        generatedAt: "2026-04-12T00:00:00.000Z",
        limit: 10,
        organizationId: "org-1",
        ownerUserId: "owner-1",
      });
      expect(accountSpaces.spaceItems.map((item) => item.spaceId)).toEqual([
        "space-alpha",
      ]);
      expect(organizationSpaces.spaces.map((item) => item.spaceId)).toEqual([
        "space-alpha",
      ]);
      expect(organizationSpaces.spaces[0]?.activeMemberCount).toBe(1);
      expect(organizationSpaces.spaces[0]?.memberPreviews).toBeUndefined();
      const directoryWithAvatars = await listOrganizationSpacesFromSpaceIndex({
        db: harness.db,
        generatedAt: "2026-04-12T00:00:00.000Z",
        includeMemberPreviews: true,
        limit: 10,
        organizationId: "org-1",
        ownerUserId: "owner-1",
      });
      expect(directoryWithAvatars.spaces[0]?.memberPreviews).toEqual([
        expect.objectContaining({ profileId: "human-1", profileName: "Mira" }),
      ]);
      await harness.db.query({
        ...{
          text: 'UPDATE "openmeld"."space_index_spaces" SET active_member_count = NULL WHERE space_id = $1',
          values: [],
        },
        values: ["space-alpha"],
      });
      const organizationSpacesWithUnknownCount =
        await listOrganizationSpacesFromSpaceIndex({
          db: harness.db,
          generatedAt: "2026-04-12T00:01:00.000Z",
          limit: 10,
          organizationId: "org-1",
          ownerUserId: "owner-1",
        });
      expect(
        organizationSpacesWithUnknownCount.spaces[0]?.activeMemberCount
      ).toBeNull();
    } finally {
      await harness.close();
    }
  });
  it("filters Center Agent DMs from AccountSpaces without hiding ordinary DMs", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await seedCenterAgentDesignation(harness, {
        agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
        organizationId: "org-1",
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          directMessagePairKey:
            "agt_33333333-3333-4333-8333-333333333333:human-1",
          name: "Mira and Center Agent",
          purpose: "openmeld_dm_space",
          spaceId: "space-center-agent-dm",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-center-agent-dm",
          }),
          createMember({
            addedAt: "2026-04-10T00:02:00.000Z",
            profileId: "agt_33333333-3333-4333-8333-333333333333",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Center Agent",
            spaceId: "space-center-agent-dm",
          }),
        ],
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          directMessagePairKey: "agent-helper:human-1",
          name: "Mira and Helper Agent",
          purpose: "openmeld_dm_space",
          spaceId: "space-ordinary-agent-dm",
          updatedAt: "2026-04-11T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-11T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-ordinary-agent-dm",
          }),
          createMember({
            addedAt: "2026-04-11T00:02:00.000Z",
            profileId: "agent-helper",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Helper Agent",
            spaceId: "space-ordinary-agent-dm",
          }),
        ],
      });
      const projectedPreview = {
        signalId: "signal-ordinary-dm",
        profileId: "human-1",
        timestamp: Date.parse("2026-04-12T00:00:00.000Z"),
        text: "Latest ordinary message",
      };
      await projectSpaceMessagePreview({
        db: harness.db,
        spaceId: "space-ordinary-agent-dm",
        revision: 1,
        preview: projectedPreview,
      });
      await projectSpaceMessagePreview({
        db: harness.db,
        spaceId: "space-center-agent-dm",
        revision: 1,
        preview: {
          signalId: "signal-center-agent-dm",
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          timestamp: Date.parse("2026-04-13T00:00:00.000Z"),
          text: "Center Agent reply",
        },
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        includeDirectMessageProfileIds: true,
        includeMessagePreviews: true,
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      expect(accountSpaces.spaceItems.map((item) => item.spaceId)).toEqual([
        "space-ordinary-agent-dm",
      ]);
      expect(accountSpaces.spaceItems[0]?.directMessageProfileIds).toEqual([
        "agent-helper",
        "human-1",
      ]);
      expect(accountSpaces.spaceItems[0]?.messagePreview).toEqual(
        projectedPreview
      );
      const sessions = await listDirectMessageSessionIndexRows({
        db: harness.db,
        organizationId: "org-1",
        pairKeys: ["agt_33333333-3333-4333-8333-333333333333:human-1"],
        limit: 10,
      });
      expect(sessions).toMatchObject([
        {
          spaceId: "space-center-agent-dm",
          messagePreview: { text: "Center Agent reply" },
        },
      ]);
      await projectSpaceMessagePreview({
        db: harness.db,
        spaceId: "space-center-agent-dm",
        revision: 2,
        preview: null,
      });
      expect(
        await listDirectMessageSessionIndexRows({
          db: harness.db,
          organizationId: "org-1",
          pairKeys: ["agt_33333333-3333-4333-8333-333333333333:human-1"],
          limit: 10,
        })
      ).toMatchObject([
        { spaceId: "space-center-agent-dm", messagePreview: null },
      ]);
      // Archived Sessions leave the active list and appear only on request.
      await writeDirectMessageSessionArchivedAt({
        db: harness.db,
        spaceId: "space-center-agent-dm",
        organizationId: "org-1",
        archivedAtMs: Date.parse("2026-04-14T00:00:00.000Z"),
        nowMs: Date.parse("2026-04-14T00:00:00.000Z"),
      });
      const sessionPair = {
        db: harness.db,
        organizationId: "org-1",
        pairKeys: ["agt_33333333-3333-4333-8333-333333333333:human-1"],
        limit: 10,
        archived: false,
      };
      expect(
        await listDirectMessageSessionIndexRows({
          ...sessionPair,
          archived: undefined,
        })
      ).toHaveLength(1);
      expect(await listDirectMessageSessionIndexRows(sessionPair)).toEqual([]);
      expect(
        await listDirectMessageSessionIndexRows({
          ...sessionPair,
          archived: true,
        })
      ).toMatchObject([
        {
          spaceId: "space-center-agent-dm",
          archivedAtMs: Date.parse("2026-04-14T00:00:00.000Z"),
        },
      ]);
      await writeDirectMessageSessionArchivedAt({
        db: harness.db,
        spaceId: "space-center-agent-dm",
        organizationId: "org-1",
        archivedAtMs: null,
        nowMs: Date.parse("2026-04-15T00:00:00.000Z"),
      });
      expect(
        await listDirectMessageSessionIndexRows(sessionPair)
      ).toMatchObject([
        { spaceId: "space-center-agent-dm", archivedAtMs: null },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("lists the member's Sessions with several agent Profiles as one paged list", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const sessions = [
        { spaceId: "space-a-1", agent: "agent-a", human: "human-1" },
        { spaceId: "space-a-2", agent: "agent-a", human: "human-1" },
        { spaceId: "space-b-1", agent: "agent-b", human: "human-1" },
        // Another Human's Session with the same Agent stays out.
        { spaceId: "space-a-other", agent: "agent-a", human: "human-2" },
      ];
      for (const session of sessions) {
        await projectActiveSpaceIndexSnapshot({
          db: harness.db,
          eventType: "space.created",
          metaRecord: createMeta({
            directMessagePairKey: `${session.agent}:${session.human}`,
            name: `Chat ${session.spaceId}`,
            purpose: "openmeld_dm_space",
            spaceId: session.spaceId,
            updatedAt: "2026-04-10T00:00:00.000Z",
          }),
          memberRecords: [
            createMember({
              addedAt: "2026-04-10T00:01:00.000Z",
              profileId: session.human,
              profileKindSnapshot: "human",
              profileNameSnapshot: "Mira",
              spaceId: session.spaceId,
            }),
            createMember({
              addedAt: "2026-04-10T00:02:00.000Z",
              profileId: session.agent,
              profileKindSnapshot: "agent",
              profileNameSnapshot: "Helper",
              spaceId: session.spaceId,
            }),
          ],
        });
      }
      await writeDirectMessageSessionArchivedAt({
        db: harness.db,
        spaceId: "space-b-1",
        organizationId: "org-1",
        archivedAtMs: Date.parse("2026-04-14T00:00:00.000Z"),
        nowMs: Date.parse("2026-04-14T00:00:00.000Z"),
      });
      const read = (cursor?: string) =>
        listAuthorizedMemberAgentDirectMessageSessions({
          db: harness.db,
          organizationId: "org-1",
          memberProfileId: "human-1",
          ownerUserId: "owner-1",
          agentProfileIds: ["agent-a", "agent-b"],
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
      const first = await read();
      expect(first.nextCursor).not.toBeNull();
      const second = await read(first.nextCursor ?? undefined);
      expect(second.nextCursor).toBeNull();
      // Active and archived Sessions of every Profile, each tagged with its
      // Profile, newest first across Profiles.
      expect([...first.sessions, ...second.sessions]).toEqual([
        {
          spaceId: "space-b-1",
          agentProfileId: "agent-b",
          name: "Chat space-b-1",
          archivedAt: "2026-04-14T00:00:00.000Z",
        },
        {
          spaceId: "space-a-2",
          agentProfileId: "agent-a",
          name: "Chat space-a-2",
          archivedAt: null,
        },
        {
          spaceId: "space-a-1",
          agentProfileId: "agent-a",
          name: "Chat space-a-1",
          archivedAt: null,
        },
      ]);
      await expect(
        listAuthorizedMemberAgentDirectMessageSessions({
          db: harness.db,
          organizationId: "org-1",
          memberProfileId: "human-2",
          ownerUserId: "owner-2",
          agentProfileIds: ["agent-a"],
          limit: 2,
          cursor: first.nextCursor ?? "",
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(
        (
          await listAuthorizedMemberAgentDirectMessageSessions({
            db: harness.db,
            organizationId: "org-1",
            memberProfileId: "human-1",
            ownerUserId: "owner-1",
            agentProfileIds: [],
            limit: 2,
          })
        ).sessions
      ).toEqual([]);
    } finally {
      await harness.close();
    }
  });
  it("keeps each account Space open profile scoped to that Space history", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Human Last",
          spaceId: "space-human-last",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Test 1",
            spaceId: "space-human-last",
          }),
          createMember({
            addedAt: "2026-04-10T00:02:00.000Z",
            profileId: "agent-1",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Codex",
            spaceId: "space-human-last",
          }),
        ],
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Agent Last",
          spaceId: "space-agent-last",
          updatedAt: "2026-04-11T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-11T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Test 1",
            spaceId: "space-agent-last",
          }),
          createMember({
            addedAt: "2026-04-11T00:02:00.000Z",
            profileId: "agent-1",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Codex",
            spaceId: "space-agent-last",
          }),
        ],
      });
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-12T00:00:00.000Z"),
        pinnedAt: null,
        profileId: "human-1",
        spaceId: "space-human-last",
      });
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-13T00:00:00.000Z"),
        pinnedAt: null,
        profileId: "agent-1",
        spaceId: "space-agent-last",
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      expect(
        accountSpaces.spaceItems.map((item) => ({
          openProfileId: item.openProfileId,
          openProfileName: item.openProfileName,
          spaceId: item.spaceId,
        }))
      ).toEqual([
        {
          openProfileId: "agent-1",
          openProfileName: "Codex",
          spaceId: "space-agent-last",
        },
        {
          openProfileId: "human-1",
          openProfileName: "Test 1",
          spaceId: "space-human-last",
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("keeps Space ordering stable when a Space is opened as another profile", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Recently Joined",
          spaceId: "space-recent",
          updatedAt: "2026-04-20T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-20T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Test 1",
            spaceId: "space-recent",
          }),
        ],
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Opened Again",
          spaceId: "space-opened-again",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Test 1",
            spaceId: "space-opened-again",
          }),
          createMember({
            addedAt: "2026-04-10T00:02:00.000Z",
            profileId: "human-2",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Journey Human",
            spaceId: "space-opened-again",
          }),
        ],
      });
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-10T00:01:00.000Z"),
        lastSeenTs: Date.parse("2026-06-24T01:46:00.000Z"),
        pinnedAt: null,
        profileId: "human-1",
        spaceId: "space-opened-again",
      });
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-10T00:02:00.000Z"),
        pinnedAt: null,
        profileId: "human-2",
        spaceId: "space-opened-again",
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      expect(
        accountSpaces.spaceItems.map((item) => ({
          openProfileId: item.openProfileId,
          spaceId: item.spaceId,
        }))
      ).toEqual([
        {
          openProfileId: "human-1",
          spaceId: "space-recent",
        },
        {
          openProfileId: "human-1",
          spaceId: "space-opened-again",
        },
      ]);
      expect(accountSpaces.spaceItems[1]?.lastJoinedAt).toBe(
        "2026-04-10T00:02:00.000Z"
      );
    } finally {
      await harness.close();
    }
  });
  it("keeps deleted Space evidence before hiding the Space from AccountSpaces", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const metaRecord = createMeta({
        name: "Deleted Alpha",
        spaceId: "space-alpha",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const memberRecords = [
        createMember({
          addedAt: "2026-04-10T00:01:00.000Z",
          profileId: "human-1",
          profileKindSnapshot: "human",
          profileNameSnapshot: "Mira",
          spaceId: "space-alpha",
        }),
      ];
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord,
        memberRecords,
      });
      await projectDeletedSpaceIndexSnapshot({
        db: harness.db,
        deletedAt: "2026-04-10T00:05:00.000Z",
        deletedByOwnerUserId: "owner-1",
        deletedByProfileId: "human-1",
        deletedByProfileName: "Mira",
        eventType: "space.deleted",
        metaRecord,
        memberRecords,
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const deletedSpaceRow = await harness.queryFirst<{
        deleted_at_ms: number | null;
        status: string;
      }>({
        values: ["space-alpha"],
        text: `
          SELECT status, deleted_at_ms
          FROM "openmeld"."space_index_spaces"
          WHERE space_id = $1
        `,
      });
      const deletedMembershipRow = await harness.queryFirst<{
        removal_reason: string | null;
        status: string;
      }>({
        values: ["space-alpha", "human-1"],
        text: `
          SELECT status, removal_reason
          FROM "openmeld"."space_index_memberships"
          WHERE space_id = $1 AND profile_id = $2
        `,
      });
      const deletionEventRow = await harness.queryFirst<{
        event_type: string;
      }>({
        values: ["space-alpha"],
        text: `
          SELECT event_type
          FROM "openmeld"."space_index_projection_events"
          WHERE space_id = $1
          ORDER BY source_updated_at_ms DESC
          LIMIT 1
        `,
      });
      expect(accountSpaces).toEqual({
        pinnedItems: [],
        spaceItems: [],
      });
      expect(deletedSpaceRow).toEqual({
        deleted_at_ms: Date.parse("2026-04-10T00:05:00.000Z"),
        status: "deleted",
      });
      expect(deletedMembershipRow).toEqual({
        removal_reason: "space_deleted",
        status: "removed",
      });
      expect(deletionEventRow).toEqual({ event_type: "space.deleted" });
    } finally {
      await harness.close();
    }
  });
  it("records member update projection evidence when only membership truth changes", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const metaRecord = createMeta({
        name: "Membership Alpha",
        spaceId: "space-alpha",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const humanMember = createMember({
        addedAt: "2026-04-10T00:01:00.000Z",
        profileId: "human-1",
        profileKindSnapshot: "human",
        profileNameSnapshot: "Mira",
        spaceId: "space-alpha",
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.members_updated",
        metaRecord,
        memberRecords: [humanMember],
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.members_updated",
        metaRecord,
        memberRecords: [
          humanMember,
          createMember({
            addedAt: "2026-04-10T00:02:00.000Z",
            profileId: "agent-1",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Codex",
            spaceId: "space-alpha",
          }),
        ],
      });
      const projectionEvents = await harness.queryAll<{
        event_type: string;
        source_updated_at_ms: number;
      }>({
        values: ["space-alpha", "space.members_updated"],
        text: `
          SELECT event_type, source_updated_at_ms
          FROM "openmeld"."space_index_projection_events"
          WHERE space_id = $1
            AND event_type = $2
          ORDER BY source_updated_at_ms ASC
        `,
      });
      expect(projectionEvents).toEqual([
        {
          event_type: "space.members_updated",
          source_updated_at_ms: Date.parse("2026-04-10T00:01:00.000Z"),
        },
        {
          event_type: "space.members_updated",
          source_updated_at_ms: Date.parse("2026-04-10T00:02:00.000Z"),
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("does not write a completed event when projection rows fail and reports the partial row", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const oldMeta = createMeta({
        name: "Old Alpha",
        spaceId: "space-alpha",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const humanMember = createMember({
        addedAt: "2026-04-10T00:01:00.000Z",
        profileId: "human-1",
        profileKindSnapshot: "human",
        profileNameSnapshot: "Mira",
        spaceId: "space-alpha",
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: oldMeta,
        memberRecords: [humanMember],
      });
      await expect(
        projectActiveSpaceIndexSnapshot({
          db: createProjectionFailureDb({
            db: harness.db,
            failOnSql: 'INSERT INTO "openmeld"."space_index_memberships"',
          }),
          eventType: "space.members_updated",
          metaRecord: createMeta({
            name: "Renamed Alpha",
            spaceId: "space-alpha",
            updatedAt: "2026-04-10T00:10:00.000Z",
          }),
          memberRecords: [
            humanMember,
            createMember({
              addedAt: "2026-04-10T00:11:00.000Z",
              profileId: "agent-1",
              profileKindSnapshot: "agent",
              profileNameSnapshot: "Codex",
              spaceId: "space-alpha",
            }),
          ],
        })
      ).rejects.toThrow("injected PostgreSQL query failure");
      const completedProjectionEvent = await harness.queryFirst<{
        event_type: string;
        projection_event_id: string;
      }>({
        values: ["space-alpha", "space.members_updated"],
        text: `
          SELECT projection_event_id, event_type
          FROM "openmeld"."space_index_projection_events"
          WHERE space_id = $1 AND event_type = $2
          ORDER BY source_updated_at_ms DESC
          LIMIT 1
        `,
      });
      const indexedProfiles = await harness.queryAll<{
        profile_id: string;
      }>({
        values: ["space-alpha"],
        text: `
          SELECT profile_id
          FROM "openmeld"."space_index_memberships"
          WHERE space_id = $1
          ORDER BY profile_id ASC
        `,
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const diagnostic = await diagnoseSpaceIndexProjectionDrift({
        db: harness.db,
        spaceId: "space-alpha",
      });
      expect(completedProjectionEvent).toBeNull();
      expect(indexedProfiles).toEqual([{ profile_id: "human-1" }]);
      expect(accountSpaces.spaceItems[0]).toMatchObject({
        joinedProfiles: [
          {
            lastJoinedAt: "2026-04-10T00:01:00.000Z",
            pinnedAt: null,
            profileId: "human-1",
            profileName: "Mira",
          },
        ],
        spaceId: "space-alpha",
        spaceName: "Renamed Alpha",
      });
      expect(diagnostic.ok).toBe(false);
      expect(diagnostic.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "space_index_space_missing_completed_event",
            spaceId: "space-alpha",
          }),
        ])
      );
    } finally {
      await harness.close();
    }
  });
  it("detects a completed projection event whose membership rows are incomplete", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const oldMeta = createMeta({
        name: "Old Alpha",
        spaceId: "space-alpha",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const humanMember = createMember({
        addedAt: "2026-04-10T00:01:00.000Z",
        profileId: "human-1",
        profileKindSnapshot: "human",
        profileNameSnapshot: "Mira",
        spaceId: "space-alpha",
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: oldMeta,
        memberRecords: [humanMember],
      });
      const partialEventId = "spidx_projection_legacy_partial";
      await harness.query({
        values: [
          partialEventId,
          "space-alpha",
          "space.members_updated",
          Date.parse("2026-04-10T00:11:00.000Z"),
          Date.parse("2026-04-10T00:11:01.000Z"),
          JSON.stringify({ memberCount: 2, spaceId: "space-alpha" }),
        ],
        text: `
          INSERT INTO "openmeld"."space_index_projection_events" (
            projection_event_id,
            space_id,
            event_type,
            source_updated_at_ms,
            projected_at_ms,
            payload_json
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
      });
      const diagnostic = await diagnoseSpaceIndexProjectionDrift({
        db: harness.db,
        spaceId: "space-alpha",
      });
      expect(diagnostic.ok).toBe(false);
      expect(diagnostic.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "space_index_space_behind_completed_event",
            projectionEventId: partialEventId,
            spaceId: "space-alpha",
          }),
          expect.objectContaining({
            code: "space_index_projection_event_membership_count_mismatch",
            projectionEventId: partialEventId,
            spaceId: "space-alpha",
          }),
        ])
      );
    } finally {
      await harness.close();
    }
  });
  it("does not let an older active snapshot resurrect a deleted Space", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const metaRecord = createMeta({
        name: "Deleted Alpha",
        spaceId: "space-alpha",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const memberRecords = [
        createMember({
          addedAt: "2026-04-10T00:01:00.000Z",
          profileId: "human-1",
          profileKindSnapshot: "human",
          profileNameSnapshot: "Mira",
          spaceId: "space-alpha",
        }),
      ];
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord,
        memberRecords,
      });
      await projectDeletedSpaceIndexSnapshot({
        db: harness.db,
        deletedAt: "2026-04-10T00:05:00.000Z",
        deletedByOwnerUserId: "owner-1",
        deletedByProfileId: "human-1",
        deletedByProfileName: "Mira",
        eventType: "space.deleted",
        metaRecord,
        memberRecords,
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.index_backfilled",
        metaRecord,
        memberRecords,
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const deletedSpaceRow = await harness.queryFirst<{
        status: string;
      }>({
        values: ["space-alpha"],
        text: `
          SELECT status
          FROM "openmeld"."space_index_spaces"
          WHERE space_id = $1
        `,
      });
      const deletedMembershipRow = await harness.queryFirst<{
        status: string;
      }>({
        values: ["space-alpha", "human-1"],
        text: `
          SELECT status
          FROM "openmeld"."space_index_memberships"
          WHERE space_id = $1 AND profile_id = $2
        `,
      });
      expect(accountSpaces).toEqual({
        pinnedItems: [],
        spaceItems: [],
      });
      expect(deletedSpaceRow).toEqual({ status: "deleted" });
      expect(deletedMembershipRow).toEqual({ status: "removed" });
    } finally {
      await harness.close();
    }
  });
  // Production repro (2026-06-14): a whole-space delete wrote status="deleted",
  // then a ~13s-delayed `space.members_updated` (source ts BEFORE the delete)
  // landed just after it and revived the space to "active" because the guard was
  // a non-atomic JS read-then-write. The guard now lives in the ON CONFLICT WHERE
  // and is evaluated atomically against the live (deleted) row, so the stale
  // members_updated cannot resurrect the Space or re-activate the removed member.
  it("keeps a Space deleted when a stale members_updated lands after the delete", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const metaRecord = createMeta({
        name: "Raced Alpha",
        spaceId: "space-alpha",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const memberRecords = [
        createMember({
          addedAt: "2026-04-10T00:01:00.000Z",
          profileId: "human-1",
          profileKindSnapshot: "human",
          profileNameSnapshot: "Mira",
          spaceId: "space-alpha",
        }),
      ];
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.members_updated",
        metaRecord,
        memberRecords,
      });
      await projectDeletedSpaceIndexSnapshot({
        db: harness.db,
        deletedAt: "2026-04-10T00:05:00.000Z",
        deletedByOwnerUserId: "owner-1",
        deletedByProfileId: "human-1",
        deletedByProfileName: "Mira",
        eventType: "space.deleted",
        metaRecord,
        memberRecords,
      });
      // Stale members_updated (source ts 00:00:00 < delete 00:05:00) applied late.
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.members_updated",
        metaRecord,
        memberRecords,
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const spaceRow = await harness.queryFirst<{
        status: string;
      }>({
        values: ["space-alpha"],
        text: 'SELECT status FROM "openmeld"."space_index_spaces" WHERE space_id = $1',
      });
      const membershipRow = await harness.queryFirst<{
        status: string;
      }>({
        values: ["space-alpha", "human-1"],
        text: 'SELECT status FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
      });
      expect(accountSpaces).toEqual({
        pinnedItems: [],
        spaceItems: [],
      });
      expect(spaceRow).toEqual({ status: "deleted" });
      expect(membershipRow).toEqual({ status: "removed" });
    } finally {
      await harness.close();
    }
  });
  it("surfaces a recently deleted Space as a one-time notice with who deleted it", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const metaRecord = createMeta({
        name: "Soon Deleted",
        spaceId: "space-del",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const memberRecords = [
        createMember({
          addedAt: "2026-04-10T00:01:00.000Z",
          profileId: "human-1",
          profileKindSnapshot: "human",
          profileNameSnapshot: "Mira",
          spaceId: "space-del",
        }),
      ];
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord,
        memberRecords,
      });
      // Deleted just now -> inside the recent-notice window.
      await projectDeletedSpaceIndexSnapshot({
        db: harness.db,
        deletedAt: new Date(Date.now() - 60_000).toISOString(),
        deletedByOwnerUserId: "owner-1",
        deletedByProfileId: "human-1",
        deletedByProfileName: "Mira",
        eventType: "space.deleted",
        metaRecord,
        memberRecords,
      });
      const result = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        includeRecentlyDeletedItems: true,
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      // The deleted Space is hidden from the active lists but surfaced once as a
      // notice carrying who deleted it.
      expect(result.pinnedItems).toHaveLength(0);
      expect(result.spaceItems).toHaveLength(0);
      expect(result.recentlyDeletedItems).toEqual([
        {
          deletedAt: expect.any(String),
          deletedByProfileName: "Mira",
          spaceId: "space-del",
          spaceName: "Soon Deleted",
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("does not let history overlay resurrect removed members or deleted Spaces", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      const removedMeta = createMeta({
        name: "Removed Member Alpha",
        spaceId: "space-removed-member",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.members_updated",
        metaRecord: removedMeta,
        memberRecords: [
          createRemovedMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            removedAt: "2026-04-10T00:02:00.000Z",
            spaceId: "space-removed-member",
          }),
        ],
      });
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-12T00:00:00.000Z"),
        pinnedAt: Date.parse("2026-04-13T00:00:00.000Z"),
        profileId: "human-1",
        spaceId: "space-removed-member",
      });
      const deletedMeta = createMeta({
        name: "Deleted Overlay Alpha",
        spaceId: "space-deleted-overlay",
        updatedAt: "2026-04-11T00:00:00.000Z",
      });
      const deletedMembers = [
        createMember({
          addedAt: "2026-04-11T00:01:00.000Z",
          profileId: "human-1",
          profileKindSnapshot: "human",
          profileNameSnapshot: "Mira",
          spaceId: "space-deleted-overlay",
        }),
      ];
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: deletedMeta,
        memberRecords: deletedMembers,
      });
      await projectDeletedSpaceIndexSnapshot({
        db: harness.db,
        deletedAt: "2026-04-11T00:05:00.000Z",
        deletedByOwnerUserId: "owner-1",
        deletedByProfileId: "human-1",
        deletedByProfileName: "Mira",
        eventType: "space.deleted",
        metaRecord: deletedMeta,
        memberRecords: deletedMembers,
      });
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-14T00:00:00.000Z"),
        pinnedAt: Date.parse("2026-04-15T00:00:00.000Z"),
        profileId: "human-1",
        spaceId: "space-deleted-overlay",
      });
      const accountSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const profileSpaces = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "profile",
        selectedProfileId: "human-1",
      });
      expect(accountSpaces).toEqual({
        pinnedItems: [],
        spaceItems: [],
      });
      expect(profileSpaces).toEqual({
        pinnedItems: [],
        spaceItems: [],
      });
    } finally {
      await harness.close();
    }
  });
  // P0.3 equivalence proof (physical-db-split.md): the overlay read is
  // gateway-host scoped exactly like the old `h.gateway_host = ?` JOIN
  // predicate. Overlay stored for one host must NOT surface to a query for a
  // different host; the space itself still lists (membership is host-agnostic),
  // only the pin/last-joined overlay is gated.
  it("scopes overlay to the matching gateway host and ignores a mismatched host", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Host Scoped",
          spaceId: "space-host",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-host",
          }),
        ],
      });
      // Overlay stored under a DIFFERENT gateway host than the reader uses.
      await harness.query({
        values: [
          "other.example",
          Date.parse("2026-04-13T00:00:00.000Z"),
          Date.parse("2026-04-12T00:00:00.000Z"),
          Date.parse("2026-04-12T00:00:00.000Z"),
          "space-host",
          "human-1",
        ],
        text: `
          UPDATE "openmeld"."space_index_memberships" SET
            overlay_gateway_host = $1,
            overlay_pinned_at_ms = $2,
            overlay_last_joined_at_ms = $3,
            overlay_updated_at_ms = $4
          WHERE space_id = $5 AND profile_id = $6
        `,
      });
      const mismatched = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      // Space still lists, but the cross-host overlay must NOT pin it.
      expect(mismatched.pinnedItems).toHaveLength(0);
      expect(mismatched.spaceItems.map((item) => item.spaceId)).toEqual([
        "space-host",
      ]);
      expect(mismatched.spaceItems[0]?.pinnedAt ?? null).toBeNull();
      const matched = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "other.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      // Same overlay row, queried under its own host, DOES surface and pins.
      expect(matched.pinnedItems.map((item) => item.spaceId)).toEqual([
        "space-host",
      ]);
      expect(matched.pinnedItems[0]?.pinnedAt).toBe("2026-04-13T00:00:00.000Z");
    } finally {
      await harness.close();
    }
  });
  it("lists visible space ids with the same membership predicates as the account read", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Alpha",
          spaceId: "space-alpha",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:01:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-alpha",
          }),
        ],
      });
      const betaMetaRecord = createMeta({
        name: "Beta",
        spaceId: "space-beta",
        updatedAt: "2026-04-11T00:00:00.000Z",
      });
      const betaMemberRecords = [
        createMember({
          addedAt: "2026-04-11T00:01:00.000Z",
          profileId: "human-1",
          profileKindSnapshot: "human",
          profileNameSnapshot: "Mira",
          spaceId: "space-beta",
        }),
      ];
      await projectActiveSpaceIndexSnapshot({
        db: harness.db,
        eventType: "space.created",
        metaRecord: betaMetaRecord,
        memberRecords: betaMemberRecords,
      });
      await projectDeletedSpaceIndexSnapshot({
        db: harness.db,
        deletedAt: "2026-04-12T00:00:00.000Z",
        deletedByOwnerUserId: "owner-1",
        deletedByProfileId: "human-1",
        deletedByProfileName: "Mira",
        eventType: "space.deleted",
        metaRecord: betaMetaRecord,
        memberRecords: betaMemberRecords,
      });
      const spaceIds = await listAccountSpaceIdsFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
      });
      expect(spaceIds).toEqual(["space-alpha"]);
      await expect(
        listAccountSpaceIdsFromSpaceIndex({
          db: harness.db,
          gatewayHost: "gateway.testing.example",
          limit: 10,
          ownerUserId: "owner-unknown",
        })
      ).resolves.toEqual([]);
    } finally {
      await harness.close();
    }
  });
  it("uses the exact account sidebar candidate ordering for bounded fan-out", async () => {
    const harness = await createSpaceIndexHarness();
    try {
      for (const [spaceId, name, addedAt] of [
        ["space-first", "First", "2026-04-10T00:01:00.000Z"],
        ["space-pinned", "Pinned", "2026-04-11T00:01:00.000Z"],
      ] as const) {
        await projectActiveSpaceIndexSnapshot({
          db: harness.db,
          eventType: "space.created",
          metaRecord: createMeta({ name, spaceId, updatedAt: addedAt }),
          memberRecords: [
            createMember({
              addedAt,
              profileId: "human-1",
              profileKindSnapshot: "human",
              profileNameSnapshot: "Mira",
              spaceId,
            }),
          ],
        });
      }
      await seedMembershipOverlay(harness, {
        lastJoinedAt: Date.parse("2026-04-10T00:01:00.000Z"),
        pinnedAt: Date.parse("2026-04-12T00:00:00.000Z"),
        profileId: "human-1",
        spaceId: "space-first",
      });
      const sidebar = await listAccountSpacesFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 1,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      const fanOutIds = await listAccountSpaceIdsFromSpaceIndex({
        db: harness.db,
        gatewayHost: "gateway.testing.example",
        limit: 1,
        ownerUserId: "owner-1",
      });
      expect(fanOutIds).toEqual(
        [...sidebar.pinnedItems, ...sidebar.spaceItems].map(
          (item) => item.spaceId
        )
      );
      expect(fanOutIds).toEqual(["space-first"]);
    } finally {
      await harness.close();
    }
  });
});
async function createSpaceIndexHarness() {
  const harness = await createPostgresHarness();
  for (const sql of SPACE_INDEX_AUXILIARY_TABLES_SQL) {
    await harness.query({ text: sql });
  }
  return harness;
}
function createMeta(input: {
  directMessagePairKey?: string;
  name: string;
  organizationId?: string;
  purpose?: string | null;
  spaceId: string;
  updatedAt: string;
  visibility?: "public" | "private";
}): SpaceMetaRecord {
  return {
    v: 1,
    accessMode: "public",
    createdAt: "2026-04-09T00:00:00.000Z",
    creator: {
      kind: "human",
      ownerUserId: "owner-1",
      profileId: "human-1",
      profileName: "Mira",
    },
    ...(typeof input.directMessagePairKey === "string"
      ? { directMessage: { pairKey: input.directMessagePairKey } }
      : {}),
    name: input.name,
    organizationId: input.organizationId ?? "org-1",
    ...(typeof input.purpose === "string" ? { purpose: input.purpose } : {}),
    spaceId: input.spaceId,
    updatedAt: input.updatedAt,
    visibility: input.visibility ?? "private",
  };
}
function createMember(input: {
  addedAt: string;
  profileId: string;
  profileKindSnapshot: "human" | "agent";
  profileNameSnapshot: string;
  spaceId: string;
}): SpaceMemberRecord {
  return {
    addedAt: input.addedAt,
    addedByDisplayNameSnapshot: "Mira",
    addedByOwnerUserId: "owner-1",
    addedByProfileId: "human-1",
    controllerRefSnapshot: null,
    createdAt: input.addedAt,
    firstEnteredAt: null,
    lastEnteredAt: null,
    memberSource:
      input.profileKindSnapshot === "human"
        ? "space_creator"
        : "added_by_member",
    ownerNameSnapshot: "Mira",
    ownerUserIdSnapshot: "owner-1",
    profileId: input.profileId,
    profileKindSnapshot: input.profileKindSnapshot,
    profileNameSnapshot: input.profileNameSnapshot,
    removalReason: null,
    removedAt: null,
    removedByOwnerUserId: null,
    removedByProfileId: null,
    spaceId: input.spaceId,
    status: "active",
    updatedAt: input.addedAt,
  };
}
function createRemovedMember(input: {
  addedAt: string;
  profileId: string;
  profileKindSnapshot: "human" | "agent";
  profileNameSnapshot: string;
  removedAt: string;
  spaceId: string;
}): SpaceMemberRecord {
  return {
    ...createMember(input),
    removalReason: "removed_by_member",
    removedAt: input.removedAt,
    removedByOwnerUserId: "owner-1",
    removedByProfileId: "human-1",
    status: "removed",
    updatedAt: input.removedAt,
  };
}
function createProjectionFailureDb(input: {
  db: PostgresDatabase;
  failOnSql: string;
}): PostgresDatabase {
  return createFaultInjectingPostgresDatabase({
    db: input.db,
    matches: (sql) => sql.includes(input.failOnSql),
  });
}
async function seedMembershipOverlay(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    lastJoinedAt: number;
    lastSeenTs?: number | null;
    pinnedAt: number | null;
    profileId: string;
    spaceId: string;
  }
): Promise<void> {
  // Overlay values now live as projected columns on the membership row
  // (physical-db-split.md P0.3); the cross-domain history JOIN is gone.
  await harness.query({
    values: [
      "gateway.testing.example",
      input.pinnedAt,
      input.lastJoinedAt,
      input.lastSeenTs ?? null,
      input.lastJoinedAt,
      input.spaceId,
      input.profileId,
    ],
    text: `
      UPDATE "openmeld"."space_index_memberships" SET
        overlay_gateway_host = $1,
        overlay_pinned_at_ms = $2,
        overlay_last_joined_at_ms = $3,
        overlay_last_seen_ts = $4,
        overlay_updated_at_ms = $5
      WHERE space_id = $6 AND profile_id = $7
    `,
  });
}
async function seedCenterAgentDesignation(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    agentProfileId: string;
    organizationId: string;
  }
): Promise<void> {
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
    VALUES ($1, 'Organization', $1, 100) ON CONFLICT DO NOTHING`,
    values: [input.organizationId],
  });
  await harness.query(`INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at)
    VALUES ('owner-1', 'Owner', 'owner@example.test', 100, 100) ON CONFLICT DO NOTHING`);
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles"
    (profile_id, profile_name, profile_handle, profile_kind, managed_role, organization_id, source)
    VALUES ($1, 'Center Agent', 'center', 'agent', 'center_agent', $2, 'migration')`,
    values: [input.agentProfileId, input.organizationId],
  });
  await harness.query({
    values: [input.organizationId, input.agentProfileId, "owner-1", 100],
    text: `
      INSERT INTO "openmeld"."center_agent_designations" (
        organization_id,
        agent_profile_id,
        designated_by,
        created_at
      )
      VALUES ($1, $2, $3, $4)
    `,
  });
}

const SPACE_INDEX_AUXILIARY_TABLES_SQL = [] as const;
