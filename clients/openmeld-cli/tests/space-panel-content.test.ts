import { stripVTControlCharacters } from "node:util";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import pc from "picocolors";
import { describe, expect, it } from "vitest";
import {
  buildHelpPanelBlocks,
  buildLogsPanelBlocks,
  buildLogsSearchableListViewState,
  buildMembersPanelBlocks,
  buildMembersSearchableListViewState,
  buildSpacePanelBlocks,
  resolveLogsSearchableActiveItemId,
  resolveMembersSearchableActiveItemId,
} from "../src/space/panel/space-panel-content";
import type { SpaceSessionContext } from "../src/space/view/space-session-view-state";

const PRIMARY_HUMAN_PROFILE_ID = "55555555-5555-4555-8555-555555555555";
const SECONDARY_HUMAN_PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const AGENT_PROFILE_ID = "agt_77777777-7777-4777-8777-777777777777";

describe("space panel content", () => {
  it("renders help blocks with the updated space and members semantics", () => {
    const blocks = buildHelpPanelBlocks();
    const lines = blocks[0]?.kind === "lines" ? blocks[0].lines : [];

    expect(lines).toContain("/space  Show current Space info");
    expect(lines).toContain("/members  Show current Space members");
    expect(lines).toContain("/logs  Show current Space logs");
    expect(lines.join("\n")).not.toContain("/status");
    expect(lines.join("\n")).not.toContain("/cancel");
  });

  it("renders logs blocks as titled panel sections without inventing a second panel layout", () => {
    const blocks = buildLogsPanelBlocks({
      sections: [
        {
          kind: "presence",
          items: [
            {
              id: "presence:0",
              lines: ["15:42 · 👤 Casey · first joined"],
            },
          ],
          title: "Presence",
          lines: ["15:42 · 👤 Casey · first joined"],
        },
        {
          kind: "system",
          items: [
            {
              id: "system:0",
              lines: ['Agent "ops-bot" is offline.'],
            },
          ],
          title: "System",
          lines: ['Agent "ops-bot" is offline.'],
        },
      ],
    });

    expect(blocks).toEqual([
      {
        kind: "lines",
        lines: [pc.bold("Presence"), "15:42 · 👤 Casey · first joined"],
      },
      {
        kind: "lines",
        lines: [pc.bold("System"), 'Agent "ops-bot" is offline.'],
      },
    ]);
  });

  it("builds the space panel as facts plus join command and clear warning", () => {
    const blocks = buildSpacePanelBlocks({
      context: createSessionContext(),
    });

    expect(blocks).toHaveLength(3);
    expect(
      (blocks[0] as { kind: "lines"; lines: readonly string[] }).lines.map(
        stripAnsi
      )
    ).toEqual([
      "Anyone with this Space link can read what is shared here and join.",
      "Only bring an agent if you're comfortable sharing anything it posts with people who have the link.",
    ]);
    expect(blocks[1]).toEqual({
      kind: "facts",
      items: [
        { label: "Space Name", value: "Ops Room", span: "full" },
        { label: "Space ID", value: "space-1", span: "full" },
        { label: "Space Creator", value: "Felix", span: "column" },
        {
          label: "Space Creator Profile ID",
          value: "11111111-1111-4111-8111-111111111111",
          span: "column",
        },
        {
          label: "Space Created",
          value: "2026-03-13T00:00:00.000Z",
          span: "column",
        },
        {
          label: "Access",
          value: "anyone with the link",
          span: "column",
        },
        {
          label: "Gateway URL",
          value: "http://localhost:8080",
          span: "column",
        },
        { label: "Mode", value: "interactive chat", span: "column" },
        {
          label: "Storage",
          value: "393 KB / 9 GB ( 0% used )",
          span: "column",
        },
      ],
    });
    expect(
      (blocks[2] as { kind: "lines"; lines: readonly string[] }).lines
    ).toEqual([pc.dim("Join command"), pc.cyan("openmeld space join space-1")]);
  });

  it("renders members blocks from the original members card body without the outer frame", () => {
    const blocks = buildMembersPanelBlocks({
      snapshot: createMembersSnapshot(),
    });
    const lines = blocks[0]?.kind === "lines" ? [...blocks[0].lines] : [];
    const plainLines = lines.map(stripAnsi);
    const plainText = stripAnsi(lines.join("\n"));
    const agentsHeaderIndex = plainLines.findIndex((line) =>
      line.includes("🤖 Agents")
    );
    const humansHeaderIndex = plainLines.findIndex((line) =>
      line.includes("👤 Humans")
    );

    expect(plainText).toContain("👤 Humans");
    expect(plainText).toContain("🤖 Agents");
    expect(agentsHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(humansHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(agentsHeaderIndex).toBeLessThan(humansHeaderIndex);
    expect(plainText).toContain("Casey · 55555555-5555-4555-8555-555555555555");
    expect(plainText).toContain("member · live now · seen now");
    expect(plainText).toContain("owner: Felix · added by: Felix");
    expect(plainText).toContain(
      "mention: @Ops Bot(wake) · reply route unavailable · via codex · seen 21m ago"
    );
    expect(plainText).not.toContain("👥 Space Members");
  });

  it("shows a loading or failure message when there is no members snapshot", () => {
    expect(buildMembersPanelBlocks({ snapshot: null })).toEqual([
      {
        kind: "lines",
        lines: ["Members are still loading."],
      },
    ]);
    expect(
      buildMembersPanelBlocks({
        refreshError: "fetch failed",
        snapshot: null,
      })
    ).toEqual([
      {
        kind: "lines",
        lines: [
          "Couldn't load the current Space members.",
          pc.dim("Try /members again in a few seconds."),
        ],
      },
    ]);
  });

  it("builds a searchable members view model that matches mention label, id, and owner", () => {
    const searchableList = buildMembersSearchableListViewState({
      activeItemId: null,
      query: "Ops Bot",
      snapshot: createMembersSnapshot(),
    });

    expect(searchableList.control.query).toBe("Ops Bot");
    expect(searchableList.activeItemId).toBe(AGENT_PROFILE_ID);
    expect(searchableList.emptyLines).toEqual([]);
    expect(searchableList.sections).toHaveLength(1);
    expect(searchableList.sections[0]?.title).toBe("🤖 Agents");
    expect(searchableList.sections[0]?.items[0]?.lines.join("\n")).toContain(
      "mention: @Ops Bot(wake) · reply route unavailable · via codex · seen 21m ago"
    );
    expect(
      resolveMembersSearchableActiveItemId({
        preferredActiveItemId: SECONDARY_HUMAN_PROFILE_ID,
        query: "felix",
        snapshot: createMembersSnapshot(),
      })
    ).toBe(AGENT_PROFILE_ID);
  });

  it("indexes alias mention labels in the searchable members view model", () => {
    const searchableList = buildMembersSearchableListViewState({
      activeItemId: null,
      query: "ops-bot",
      snapshot: {
        ...createMembersSnapshot(),
        agents: [
          createAgentSnapshot({
            mentionAlias: "ops-bot",
          }),
        ],
      },
    });

    expect(searchableList.activeItemId).toBe(AGENT_PROFILE_ID);
    expect(searchableList.sections[0]?.items).toHaveLength(1);
  });

  it("builds a searchable logs view model that keeps multi-line log entries grouped", () => {
    const searchableList = buildLogsSearchableListViewState({
      activeItemId: null,
      query: "ops bot",
      sections: [
        {
          kind: "presence",
          items: [
            {
              id: "presence:0",
              lines: ["15:42 · 👤 Casey · joined ×2"],
            },
          ],
          title: "Presence",
          lines: ["15:42 · 👤 Casey · joined ×2"],
        },
        {
          kind: "membership",
          items: [
            {
              id: "membership:0",
              lines: [
                "15:45 · 👤 Felix · added 1 agent",
                "@Ops Bot(wake) · Ops Bot",
              ],
            },
          ],
          title: "Membership",
          lines: [
            "15:45 · 👤 Felix · added 1 agent",
            "@Ops Bot(wake) · Ops Bot",
          ],
        },
      ],
    });

    expect(searchableList.activeItemId).toBe("membership:0");
    expect(searchableList.sections).toHaveLength(1);
    expect(searchableList.sections[0]?.title).toBe("Membership");
    expect(searchableList.sections[0]?.items[0]?.lines).toEqual([
      "15:45 · 👤 Felix · added 1 agent",
      "@Ops Bot(wake) · Ops Bot",
    ]);
  });

  it("falls back to the first matching logs item when the previous selection no longer matches", () => {
    expect(
      resolveLogsSearchableActiveItemId({
        preferredActiveItemId: "presence:0",
        query: "ops bot",
        sections: [
          {
            kind: "presence",
            items: [
              {
                id: "presence:0",
                lines: ["15:42 · 👤 Casey · joined ×2"],
              },
            ],
            title: "Presence",
            lines: ["15:42 · 👤 Casey · joined ×2"],
          },
          {
            kind: "membership",
            items: [
              {
                id: "membership:0",
                lines: [
                  "15:45 · 👤 Felix · added 1 agent",
                  "@Ops Bot(wake) · Ops Bot",
                ],
              },
            ],
            title: "Membership",
            lines: [
              "15:45 · 👤 Felix · added 1 agent",
              "@Ops Bot(wake) · Ops Bot",
            ],
          },
        ],
      })
    ).toBe("membership:0");
  });

  it("keeps agents before humans in the default searchable members view", () => {
    const searchableList = buildMembersSearchableListViewState({
      activeItemId: null,
      query: "",
      snapshot: createMembersSnapshot(),
    });

    expect(searchableList.activeItemId).toBe(AGENT_PROFILE_ID);
    expect(searchableList.sections.map((section) => section.title)).toEqual([
      "🤖 Agents",
      "👤 Humans",
    ]);
  });

  it("shows an empty state when the searchable members query has no matches", () => {
    const searchableList = buildMembersSearchableListViewState({
      activeItemId: null,
      query: "not-found",
      snapshot: createMembersSnapshot(),
    });

    expect(searchableList.activeItemId).toBeNull();
    expect(searchableList.sections).toEqual([]);
    expect(searchableList.emptyLines.map(stripAnsi)).toEqual([
      "No matching members found.",
    ]);
  });
});

function createSessionContext(): SpaceSessionContext {
  return {
    surface: "active-session",
    connectionMode: "join",
    gatewayUrl: "http://localhost:8080",
    profile: {
      kind: "human",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Felix",
    },
    session: {
      spaceCreatedAt: "2026-03-13T00:00:00.000Z",
      spaceCreatorId: "11111111-1111-4111-8111-111111111111",
      spaceCreatorName: "Felix",
      passwordProtected: false,
      spaceId: "space-1",
      spaceName: "Ops Room",
      storageSoftLimitBytes: 9_000_000_000,
      storageUsedBytes: 393_000,
      storageUsagePercent: 0,
    },
  };
}

function createMembersSnapshot(): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: [createAgentSnapshot()],
    generatedAt: "2026-03-13T00:00:00.000Z",
    humans: [
      createHumanSnapshot({
        lastSeenLabel: "Seen now",
        liveNow: true,
        profileId: PRIMARY_HUMAN_PROFILE_ID,
        profileName: "Casey",
      }),
      createHumanSnapshot({
        lastSeenLabel: "Seen 2h ago",
        profileId: SECONDARY_HUMAN_PROFILE_ID,
        profileName: "Casey",
      }),
    ],
    spaceId: "space-1",
  });
}

function createHumanSnapshot(
  input: Partial<SpaceMemberHumanSnapshot> & {
    profileId: string;
    profileName: string;
  }
): SpaceMemberHumanSnapshot {
  return createSpaceMemberHumanSnapshot({
    addedAt: "2026-03-13T00:00:00.000Z",
    createdAt: "2026-03-13T00:00:00.000Z",
    memberSource: "added_by_member",
    memberSourceLabel: "Added by Felix",
    ownerName: null,
    ownerUserId: null,
    updatedAt: "2026-03-13T00:00:00.000Z",
    ...input,
  });
}

function createAgentSnapshot(
  input: Parameters<typeof createSpaceMemberAgentSnapshot>[0] = {}
): SpaceMemberAgentSnapshot {
  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-03-13T00:00:00.000Z",
    addedByDisplayName: "Felix",
    addedByOwnerUserId: "user_felix",
    addedByProfileId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-03-13T00:00:00.000Z",
    lastSeenLabel: "Seen 21m ago",
    memberSourceLabel: "Added by Felix",
    ownerName: "Felix",
    ownerUserId: "user_felix",
    profileId: AGENT_PROFILE_ID,
    profileName: "Ops Bot",
    updatedAt: "2026-03-13T00:00:00.000Z",
    wakeabilityReasonCodes: ["controller.binding.disabled"],
    wakeabilityReasonText:
      "This profile cannot be woken until its controller binding is enabled.",
    wakeabilityStatus: "blocked",
    ...input,
  });
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value);
}
