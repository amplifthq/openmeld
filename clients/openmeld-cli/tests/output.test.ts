import { stripVTControlCharacters } from "node:util";
import {
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
  SPACE_MENTION_REJECT_NOTICE_PURPOSE,
} from "@openmeld/schemas";
import {
  createSpaceMemberAgentExecutionReadiness,
  createSpaceMemberAgentSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSpaceInfoCardLines,
  buildSpaceMembersCardLines,
  formatCatchupMarker,
  formatConnectIntro,
  formatInputPrompt,
  formatTextEvent,
} from "../src/ui/output";
import { buildSpaceMentionHighlightIndex } from "../src/ui/space-mention-highlight";

const TIMESTAMP_CHAT_LINE_REGEX = /\d{8} \d{2}:\d{2}: hi$/;
const TIMESTAMP_PRESENCE_JOIN_LINE_REGEX =
  /^\* 📣 system: 🤖 Seal joined the space\.$/;
const TIMESTAMP_PRESENCE_QUIT_LINE_REGEX =
  /^\* 📣 system: 👤 Felix left the space\.$/;
const ANSI_ESCAPE_PATTERN = "\\x1B\\[[0-9;]*m";
const stripAnsi = (value: string | null): string =>
  (value ?? "").replace(new RegExp(ANSI_ESCAPE_PATTERN, "g"), "");
const stripTerminalControl = (value: string | null): string =>
  stripVTControlCharacters(value ?? "").replaceAll("\r", "");
const formatExpectedSignalTimestamp = (ts: number): string => {
  const date = new Date(ts);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}${month}${day} ${hour}:${minute}`;
};
const TRUECOLOR_PREFIX_START = "\u001B[38;2;";
const LIVE_NOW_ACCENT = pc.isColorSupported
  ? "\u001B[38;2;174;255;80mlive now\u001B[39m"
  : "live now";
const RED_BACKGROUND_ESCAPE = "\u001B[41m";
const RESET_ESCAPE = "\u001B[0m";
const OSC_LINK = "\u001B]8;;https://openmeld.ai\u0007openmeld\u001B]8;;\u0007";
const HUMAN_FELIX_RUNTIME_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const HUMAN_SHARED_RUNTIME_PROFILE_ID_A =
  "22222222-2222-4222-8222-222222222222";
const HUMAN_SHARED_RUNTIME_PROFILE_ID_B =
  "33333333-3333-4333-8333-333333333333";
const AGENT_OPS_BOT_RUNTIME_PROFILE_ID =
  "agt_44444444-4444-4444-8444-444444444444";
const HUMAN_NORMAL_GUY_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const AGENT_MY_CODEX_PROFILE_ID = "agt_55555555-5555-4555-8555-555555555555";
const AGENT_MY_CLAUDE_PROFILE_ID = "agt_66666666-6666-4666-8666-666666666666";
const AGENT_FOREIGN_OWNER_PROFILE_ID =
  "agt_77777777-7777-4777-8777-777777777777";

function createOutputAgentSnapshot(
  input: Parameters<typeof createSpaceMemberAgentSnapshot>[0]
): SpaceMembersSnapshot["agents"][number] {
  return createSpaceMemberAgentSnapshot(input);
}

afterEach(() => {
  Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
});

function createHumanSpeakerMetadataSnapshot(): SpaceMembersSnapshot {
  return {
    spaceId: "demo",
    generatedAt: "2026-03-10T00:00:00.000Z",
    summary: {
      totalCount: 6,
      humanCount: 3,
      agentCount: 3,
      liveNowCount: 2,
    },
    humans: [
      {
        profileId: "22222222-2222-4222-8222-222222222222",
        profileName: "OpenMeld Dev Local Test",
        profileKind: "human",
        mentionAlias: null,
        status: "active",
        memberSource: "space_creator",
        memberSourceLabel: "Creator",
        addedAt: "2026-03-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        addedByProfileId: null,
        addedByOwnerUserId: null,
        addedByDisplayName: null,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: "2026-03-10T00:00:00.000Z",
        lastEnteredAt: "2026-03-10T00:00:00.000Z",
        lastSeenAt: "2026-03-10T00:00:00.000Z",
        lastSeenLabel: "Seen now",
        liveNow: true,
        ownerUserId: "owner-openmeld-dev",
        ownerName: "OpenMeld Dev Local Test",
      },
      {
        profileId: "33333333-3333-4333-8333-333333333333",
        profileName: "felix-assistant",
        profileKind: "human",
        mentionAlias: null,
        status: "active",
        memberSource: "joined_directly",
        memberSourceLabel: "Joined directly",
        addedAt: "2026-03-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        addedByProfileId: null,
        addedByOwnerUserId: null,
        addedByDisplayName: null,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: "2026-03-10T00:00:00.000Z",
        lastEnteredAt: "2026-03-10T00:00:00.000Z",
        lastSeenAt: "2026-03-10T00:01:00.000Z",
        lastSeenLabel: "Seen 1m ago",
        liveNow: false,
        ownerUserId: "owner-felix-assistant",
        ownerName: "felix-assistant",
      },
      {
        profileId: HUMAN_NORMAL_GUY_PROFILE_ID,
        profileName: "normal-guy",
        profileKind: "human",
        mentionAlias: null,
        status: "active",
        memberSource: "joined_directly",
        memberSourceLabel: "Joined directly",
        addedAt: "2026-03-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        addedByProfileId: null,
        addedByOwnerUserId: null,
        addedByDisplayName: null,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: "2026-03-10T00:00:00.000Z",
        lastEnteredAt: "2026-03-10T00:00:00.000Z",
        lastSeenAt: "2026-03-10T00:30:00.000Z",
        lastSeenLabel: "Seen 30m ago",
        liveNow: false,
        ownerUserId: "owner-normal-guy",
        ownerName: "normal-guy",
      },
    ],
    agents: [
      createOutputAgentSnapshot({
        profileId: AGENT_MY_CODEX_PROFILE_ID,
        profileName: "my-codex",
        profileKind: "agent",
        mentionAlias: null,
        status: "active",
        memberSource: "added_by_member",
        memberSourceLabel: "Added by OpenMeld Dev Local Test",
        addedAt: "2026-03-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        addedByProfileId: "22222222-2222-4222-8222-222222222222",
        addedByOwnerUserId: "owner-openmeld-dev",
        addedByDisplayName: "OpenMeld Dev Local Test",
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: "2026-03-10T00:56:00.000Z",
        lastSeenLabel: "Seen 56m ago",
        liveNow: false,
        ownerUserId: "owner-openmeld-dev",
        ownerName: "OpenMeld Dev Local Test",
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "sess-my-codex-1",
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "This profile can be woken in Space",
      }),
      createOutputAgentSnapshot({
        profileId: AGENT_MY_CLAUDE_PROFILE_ID,
        profileName: "my-claude",
        profileKind: "agent",
        mentionAlias: null,
        status: "active",
        memberSource: "added_by_member",
        memberSourceLabel: "Added by OpenMeld Dev Local Test",
        addedAt: "2026-03-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        addedByProfileId: "22222222-2222-4222-8222-222222222222",
        addedByOwnerUserId: "owner-openmeld-dev",
        addedByDisplayName: "OpenMeld Dev Local Test",
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: "2026-03-10T00:56:00.000Z",
        lastSeenLabel: "Seen 56m ago",
        liveNow: false,
        ownerUserId: "owner-openmeld-dev",
        ownerName: "OpenMeld Dev Local Test",
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationId: null,
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "This profile can be woken in Space",
      }),
      createOutputAgentSnapshot({
        profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        profileName: "openclaw-agent",
        profileKind: "agent",
        mentionAlias: null,
        status: "active",
        memberSource: "added_by_member",
        memberSourceLabel: "Added by felix-assistant",
        addedAt: "2026-03-10T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        addedByProfileId: "33333333-3333-4333-8333-333333333333",
        addedByOwnerUserId: "owner-openmeld-dev",
        addedByDisplayName: "felix-assistant",
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: null,
        lastSeenLabel: null,
        liveNow: false,
        ownerUserId: "owner-openmeld-dev",
        ownerName: "OpenMeld Dev Local Test",
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId: null,
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "This profile can be woken in Space",
      }),
    ],
  };
}

describe("output", () => {
  it("formats signal.text in human view with profileIdentity name", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: "mira",
          profileName: "Mira",
          owner: "Felix",
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "human",
        selfProfileId: "me",
      }
    );
    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("🤖 Mira ");
    expect(plainLines[0]).not.toContain("(agent");
    expect(plainLines[0]).toMatch(TIMESTAMP_CHAT_LINE_REGEX);
    expect(plainLines[1]).toBe("agent · owner: Felix");
  });

  it("shows a copyable trace command for human-visible wake replies", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "reply-1",
        spaceId: "demo-space",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: "agt_codex",
          profileName: "Codex",
        },
        type: "signal.text",
        data: {
          text: "done",
          meta: {
            dispatchId: "dispatch-1",
            purpose: "agent_reply_final",
          },
        },
      },
      {
        view: "human",
        selfProfileId: "me",
      }
    );

    expect(stripAnsi(line)).toContain(
      "trace: openmeld service trace --space demo-space --dispatch dispatch-1 --view agent"
    );
  });

  it("keeps human mentions plain while still colorizing agent mentions in human chat text", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const mentionHighlightIndex = buildSpaceMentionHighlightIndex({
        spaceId: "demo",
        generatedAt: "2026-03-10T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            profileName: "felix-in-space",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-10T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-10T00:00:00.000Z",
            lastEnteredAt: "2026-03-10T00:00:00.000Z",
            lastSeenAt: "2026-03-10T00:00:00.000Z",
            lastSeenLabel: "Seen now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
          },
        ],
        agents: [
          createOutputAgentSnapshot({
            profileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
            profileName: "ops-bot",
            profileKind: "agent",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-10T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            addedByProfileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            addedByOwnerUserId: "owner-felix",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-10T00:00:00.000Z",
            lastSeenLabel: "Seen now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
            agentControllerRef: "builtin:ops-bot",
            agentControllerConversationId: null,
            wakeState: "wakeable",
            wakeabilityStatus: "ready",
            wakeabilityReasonCodes: [],
            wakeabilityReasonText: "This profile can be woken in Space",
          }),
        ],
      });

      const line = formatTextEvent(
        {
          v: 1,
          id: "mention-highlight-1",
          spaceId: "demo",
          ts: 1,
          profile: {
            kind: "human",
            profileId: "alpha",
            profileName: "Alpha",
          },
          type: "signal.text",
          data: { text: "hello @felix-in-space and @ops-bot" },
        },
        {
          view: "human",
          mentionHighlightIndex,
        }
      );

      const felixPrompt = formatInputPrompt({
        profileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
        profileName: "felix-in-space",
        kind: "human",
      });

      expect(stripAnsi(line)).toContain("hello @felix-in-space and @ops-bot");
      expect(
        extractTrueColorPrefixForLabel(felixPrompt, "felix-in-space")
      ).toBeUndefined();
      expect(
        line
          ? extractInlineTrueColorPrefixForLabel(line, "@felix-in-space")
          : undefined
      ).toBeUndefined();
      expect(
        line
          ? extractInlineTrueColorPrefixForLabel(line, "@ops-bot")
          : undefined
      ).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });

  it("keeps ambiguous or partial mention-like tokens uncolored", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const mentionHighlightIndex = buildSpaceMentionHighlightIndex({
        spaceId: "demo",
        generatedAt: "2026-03-10T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 2,
          agentCount: 0,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: HUMAN_SHARED_RUNTIME_PROFILE_ID_A,
            profileName: "shared-name",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-10T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-10T00:00:00.000Z",
            lastEnteredAt: "2026-03-10T00:00:00.000Z",
            lastSeenAt: "2026-03-10T00:00:00.000Z",
            lastSeenLabel: "Seen now",
            liveNow: false,
            ownerUserId: "owner-shared-1",
            ownerName: "shared-name",
          },
          {
            profileId: HUMAN_SHARED_RUNTIME_PROFILE_ID_B,
            profileName: "shared-name",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-10T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            addedByProfileId: HUMAN_SHARED_RUNTIME_PROFILE_ID_A,
            addedByOwnerUserId: null,
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-10T00:00:00.000Z",
            lastEnteredAt: "2026-03-10T00:00:00.000Z",
            lastSeenAt: "2026-03-10T00:00:00.000Z",
            lastSeenLabel: "Seen now",
            liveNow: false,
            ownerUserId: null,
            ownerName: null,
          },
        ],
        agents: [],
      });

      const line = formatTextEvent(
        {
          v: 1,
          id: "mention-highlight-ambiguous-1",
          spaceId: "demo",
          ts: 1,
          profile: {
            kind: "human",
            profileId: "alpha",
            profileName: "Alpha",
          },
          type: "signal.text",
          data: {
            text: "hello @shared-name and @shared-name-extra",
          },
        },
        {
          view: "human",
          mentionHighlightIndex,
        }
      );

      expect(stripAnsi(line)).toContain(
        "hello @shared-name and @shared-name-extra"
      );
      expect(
        line
          ? extractInlineTrueColorPrefixForLabel(line, "@shared-name")
          : undefined
      ).toBeUndefined();
      expect(
        line
          ? extractInlineTrueColorPrefixForLabel(line, "@shared-name-extra")
          : undefined
      ).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });

  it("formats agent speaker kind with controller and context metadata", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "meta-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: "mira",
          profileName: "Mira",
          owner: "Felix",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "thread-ctx-7",
          workingDirectory: "/tmp/mira-codex-workspace",
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "human",
        selfProfileId: "me",
        spaceMembersSnapshot: {
          spaceId: "demo",
          generatedAt: "2026-03-10T00:00:00.000Z",
          summary: {
            totalCount: 1,
            humanCount: 0,
            agentCount: 1,
            liveNowCount: 0,
          },
          humans: [],
          agents: [
            createOutputAgentSnapshot({
              profileId: "mira",
              profileName: "Mira",
              profileKind: "agent",
              mentionAlias: null,
              status: "active",
              memberSource: "added_by_member",
              memberSourceLabel: "Added by Felix",
              addedAt: "2026-03-10T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
              addedByProfileId: "felix",
              addedByOwnerUserId: "owner-felix",
              addedByDisplayName: "Felix",
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: null,
              lastEnteredAt: null,
              lastSeenAt: "2026-03-10T00:00:00.000Z",
              lastSeenLabel: "Seen now",
              liveNow: false,
              ownerUserId: "owner-felix",
              ownerName: "Felix",
              agentControllerRef: "builtin:codex",
              agentControllerConversationId: "thread-ctx-7",
              workingDirectory: "/tmp/mira-codex-workspace",
              wakeState: "wakeable",
              wakeabilityStatus: "ready",
              wakeabilityReasonCodes: [],
              wakeabilityReasonText: "This profile can be woken in Space",
            }),
          ],
        },
      }
    );
    const ansiLines = line?.split("\n") ?? [];
    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("🤖 Mira ");
    expect(plainLines[0]).toMatch(TIMESTAMP_CHAT_LINE_REGEX);
    expect(plainLines[1]).toBe(
      "agent via codex · owner: Felix · added by: Felix"
    );
    expect(ansiLines[1]).toContain(pc.dim("added by: Felix"));
    expect(plainLines[2]).toBe(
      "origin: cd /tmp/mira-codex-workspace && codex resume thread-ctx-7"
    );
  });

  it("formats signal.status with the same agent metadata lines as signal.text", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "status-meta-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: AGENT_MY_CODEX_PROFILE_ID,
          profileName: "my-codex",
          ownerName: "OpenMeld Dev Local Test",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "sess-my-codex-1",
          workingDirectory: "/tmp/my-codex-workspace",
        },
        type: "signal.status",
        data: {
          actorProfileId: AGENT_MY_CODEX_PROFILE_ID,
          status: "done",
          dispatchId: "dispatch-1",
          text: "Claude is present and ready.",
          generatedBy: "openmeld",
          replyTo: {
            signalId: "sig-66666666-6666-4666-8666-666666666666",
            profileId: "22222222-2222-4222-8222-222222222222",
            profileName: "OpenMeld Dev Local Test",
            profileKind: "human",
            previewText: "@hi-agent wake up",
          },
        },
      },
      {
        view: "human",
        selfProfileId: "me",
        spaceMembersSnapshot: createHumanSpeakerMetadataSnapshot(),
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("🤖 my-codex ");
    expect(plainLines[0]).toContain("[status: done]");
    expect(plainLines[0]).toContain("Claude is present and ready.");
    expect(plainLines[1]).toBe(
      "agent via codex · owner: OpenMeld Dev Local Test · added by: OpenMeld Dev Local Test"
    );
    expect(plainLines[2]).toBe(
      "origin: cd /tmp/my-codex-workspace && codex resume sess-my-codex-1"
    );
  });

  it("formats OpenMeld System signal.status as a unified system broadcast line in human view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "system-status-66666666-6666-4666-8666-666666666666",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.status",
        data: {
          actorProfileId: AGENT_MY_CODEX_PROFILE_ID,
          status: "blocked",
          dispatchId: "dispatch-1",
          text: "Permission denied while finalizing the reply.",
          generatedBy: "openmeld",
        },
      },
      {
        view: "human",
      }
    );

    expect(stripAnsi(line)).toBe(
      "* 📣 system: Permission denied while finalizing the reply."
    );
  });

  it("keeps OpenMeld System signal.status visible in agent view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "system-status-agent-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.status",
        data: {
          actorProfileId: AGENT_MY_CODEX_PROFILE_ID,
          status: "blocked",
          dispatchId: "dispatch-1",
          text: "Permission denied while finalizing the reply.",
          generatedBy: "openmeld",
        },
      },
      {
        view: "agent",
      }
    );

    expect(stripAnsi(line)).toBe(
      "openmeld-system (kind=system, profileName=OpenMeld System) [status: blocked]: Permission denied while finalizing the reply."
    );
  });

  it("formats signal.system_notice as a system line with reply and actor metadata", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "system-notice-meta-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: AGENT_MY_CODEX_PROFILE_ID,
          dispatchId: "dispatch-system-notice-1",
          resultRef: "dispatch-result:dispatch-system-notice-1",
          reason: "Keeping this private.",
          text: "my-codex chose to stay silent.",
          generatedBy: "openmeld",
          replyTo: {
            signalId: "sig-66666666-6666-4666-8666-666666666666",
            profileId: "22222222-2222-4222-8222-222222222222",
            profileName: "OpenMeld Dev Local Test",
            profileKind: "human",
            previewText:
              '@hi-agent wake up\n```openmeld-space-action\n{"type":"stay_silent"}\n```',
          },
        },
      },
      {
        view: "human",
        selfProfileId: "me",
        spaceMembersSnapshot: createHumanSpeakerMetadataSnapshot(),
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("* 📣 system:");
    expect(plainLines[0]).toContain("my-codex chose to stay silent.");
    expect(plainLines[1]).toBe("agent reason: Keeping this private.");
    expect(plainLines[2]).toBe("reply to OpenMeld Dev Local Test · wake up");
    expect(plainLines[3]).toBe(
      "agent via codex · owner: OpenMeld Dev Local Test · added by: OpenMeld Dev Local Test"
    );
    expect(plainLines).toHaveLength(4);
  });

  it("formats stay_silent system notices for agent view with a separate agent reason line", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "system-notice-agent-view-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: AGENT_MY_CODEX_PROFILE_ID,
          dispatchId: "dispatch-system-notice-agent-view-1",
          reason: "Keeping this private.",
          text: "my-codex chose to stay silent.",
          generatedBy: "openmeld",
        },
      },
      {
        view: "agent",
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("my-codex chose to stay silent.");
    expect(plainLines[1]).toBe("agent reason: Keeping this private.");
  });

  it("does not repeat a stay_silent reason when locale-sensitive case folding would diverge", () => {
    const toLocaleLowerCaseMock = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (this: string): string {
        return this.replaceAll("I", "ı").toLowerCase();
      });

    try {
      const line = formatTextEvent(
        {
          v: 1,
          id: "system-notice-agent-view-dedup-1",
          spaceId: "demo",
          ts: 1,
          profile: {
            kind: "system",
            profileId: "openmeld-system",
            profileName: "OpenMeld System",
          },
          type: "signal.system_notice",
          data: {
            noticeType: "stay_silent",
            actorProfileId: AGENT_MY_CODEX_PROFILE_ID,
            dispatchId: "dispatch-system-notice-agent-view-dedup-1",
            reason: "Keep I private.",
            text: "my-codex chose to stay silent. keep i private.",
            generatedBy: "openmeld",
          },
        },
        {
          view: "agent",
        }
      );

      const plainLines = stripAnsi(line).split("\n");
      expect(plainLines).toHaveLength(1);
      expect(plainLines[0]).toContain(
        "my-codex chose to stay silent. keep i private."
      );
    } finally {
      toLocaleLowerCaseMock.mockRestore();
    }
  });

  it("formats stay_silent system notices without a public reason when the reason is omitted", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "system-notice-meta-plain-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: AGENT_MY_CODEX_PROFILE_ID,
          dispatchId: "dispatch-system-notice-plain-1",
          text: "my-codex chose to stay silent.",
          generatedBy: "openmeld",
        },
      },
      {
        view: "human",
        selfProfileId: "me",
        spaceMembersSnapshot: createHumanSpeakerMetadataSnapshot(),
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("* 📣 system:");
    expect(plainLines[0]).toContain("my-codex chose to stay silent.");
    expect(plainLines[0]).not.toContain("Keeping this private.");
  });

  it("does not leak origin from the members snapshot when the event profile is already redacted", () => {
    const spaceMembersSnapshot = createHumanSpeakerMetadataSnapshot();
    const line = formatTextEvent(
      {
        v: 1,
        id: "system-notice-meta-redacted-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: AGENT_FOREIGN_OWNER_PROFILE_ID,
          dispatchId: "dispatch-system-notice-2",
          reason: "Keeping this private.",
          text: "foreign-bot chose to stay silent.",
          generatedBy: "openmeld",
        },
      },
      {
        view: "human",
        selfProfileId: "me",
        spaceMembersSnapshot: {
          ...spaceMembersSnapshot,
          agents: [
            ...spaceMembersSnapshot.agents,
            createOutputAgentSnapshot({
              profileId: AGENT_FOREIGN_OWNER_PROFILE_ID,
              profileName: "foreign-bot",
              profileKind: "agent",
              mentionAlias: null,
              status: "active",
              memberSource: "added_by_member",
              memberSourceLabel: "Added by Other Owner",
              addedAt: "2026-03-10T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
              addedByProfileId: "hum_other_owner",
              addedByOwnerUserId: "owner-other",
              addedByDisplayName: "Other Owner",
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: null,
              lastEnteredAt: null,
              lastSeenAt: "2026-03-10T00:56:00.000Z",
              lastSeenLabel: "Seen 56m ago",
              liveNow: false,
              ownerUserId: "owner-other",
              ownerName: "Other Owner",
              agentControllerRef: "builtin:codex",
              agentControllerConversationId: "ctx-should-stay-hidden",
              wakeState: "wakeable",
              wakeabilityStatus: "ready",
              wakeabilityReasonCodes: [],
              wakeabilityReasonText: "This profile can be woken in Space",
            }),
          ],
        },
      }
    );

    expect(stripAnsi(line)).not.toContain("origin:");
    expect(stripAnsi(line)).not.toContain("ctx-should-stay-hidden");
  });

  it("adds human avatar and does not add robot avatar for human speaker", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "66666666-6666-4666-8666-666666666666",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "human",
          profileId: "felix",
          profileName: "Felix",
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "human",
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("👤 Felix ");
    expect(plainLines[0]).not.toContain("(human)");
    expect(plainLines[1]).toBe("human");
    expect((plainLines[0] ?? "").includes("🤖")).toBe(false);
  });

  it("renders human speaker metadata with owns priority from the space members snapshot", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "human-owned-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "human",
          profileId: "22222222-2222-4222-8222-222222222222",
          profileName: "OpenMeld Dev Local Test",
        },
        type: "signal.text",
        data: { text: "@my-claude hey yo wake up" },
      },
      {
        view: "human",
        spaceMembersSnapshot: createHumanSpeakerMetadataSnapshot(),
      }
    );

    const ansiLines = line?.split("\n") ?? [];
    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("👤 OpenMeld Dev Local Test ");
    expect(plainLines[1]).toBe("human · space creator · seen now");
    expect(plainLines[2]).toBe(
      "owns: @my-codex · @my-claude · @openclaw-agent"
    );
    expect(ansiLines[2]).not.toContain(TRUECOLOR_PREFIX_START);
  });

  it("renders added agents for a human speaker that owns none", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "human-added-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "human",
          profileId: "33333333-3333-4333-8333-333333333333",
          profileName: "felix-assistant",
        },
        type: "signal.text",
        data: { text: "hey all" },
      },
      {
        view: "human",
        spaceMembersSnapshot: createHumanSpeakerMetadataSnapshot(),
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[1]).toBe("human · member · seen 1m ago");
    expect(plainLines[2]).toBe("added: @openclaw-agent");
  });

  it("omits related agents line when the human speaker owns and adds none", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "human-none-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "human",
          profileId: HUMAN_NORMAL_GUY_PROFILE_ID,
          profileName: "normal-guy",
        },
        type: "signal.text",
        data: { text: "hey" },
      },
      {
        view: "human",
        spaceMembersSnapshot: createHumanSpeakerMetadataSnapshot(),
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[1]).toBe("human · member · seen 30m ago");
    expect(plainLines).toHaveLength(2);
  });

  it("strips terminal control sequences from rendered chat text", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "malicious-chat-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "human",
          profileId: "felix",
          profileName: "Felix",
        },
        type: "signal.text",
        data: {
          text: `${RED_BACKGROUND_ESCAPE}alert${RESET_ESCAPE}\r\n${OSC_LINK}\b!`,
        },
      },
      {
        view: "human",
      }
    );

    expect(line?.includes(RED_BACKGROUND_ESCAPE)).toBe(false);
    expect(line?.includes(RESET_ESCAPE)).toBe(false);
    expect(line?.includes(OSC_LINK)).toBe(false);
    expect(line?.includes("\b")).toBe(false);
    expect(stripTerminalControl(line)).toContain("alert");
    expect(stripTerminalControl(line)).toContain("openmeld!");
  });

  it("strips terminal control sequences from connect intro fragments", () => {
    const lines = formatConnectIntro({
      spaceId: "space-1",
      spaceName: `${RED_BACKGROUND_ESCAPE}Ops${RESET_ESCAPE}`,
      spaceCreatedAt: "2026-03-08T00:00:00.000Z",
      spaceCreatorName: `${OSC_LINK}`,
      spaceCreatorId: "creator-1",
      passwordProtected: false,
      profileId: "66666666-6666-4666-8666-666666666666",
      profileName: `${RED_BACKGROUND_ESCAPE}Felix${RESET_ESCAPE}`,
      profileKind: "human",
      gatewayUrl: "https://gateway.openmeld.ai",
      stdio: true,
      spaceMembersSnapshot: {
        spaceId: "space-1",
        generatedAt: "2026-03-08T00:00:00.000Z",
        summary: {
          totalCount: 1,
          humanCount: 1,
          agentCount: 0,
          liveNowCount: 1,
        },
        humans: [
          {
            profileId: "66666666-6666-4666-8666-666666666666",
            profileName: `${RED_BACKGROUND_ESCAPE}Bang${RESET_ESCAPE}`,
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "joined_directly",
            memberSourceLabel: `${OSC_LINK}`,
            addedAt: "2026-03-08T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-08T00:00:00.000Z",
            lastEnteredAt: "2026-03-08T00:00:00.000Z",
            lastSeenAt: "2026-03-08T00:00:00.000Z",
            lastSeenLabel: `${RED_BACKGROUND_ESCAPE}Seen now${RESET_ESCAPE}`,
            liveNow: true,
            ownerUserId: null,
            ownerName: null,
          },
        ],
        agents: [],
      },
    });

    expect(lines.some((line) => line.includes("\u001B]"))).toBe(false);
    expect(
      lines.some((line) => line.includes(`${RED_BACKGROUND_ESCAPE}`))
    ).toBe(false);
    expect(lines.join("\n")).toContain("Ops");
    expect(lines.join("\n")).toContain("Bang");
  });

  it("renders claude origin as a single official resume command", () => {
    const workingDirectory =
      " /Users/felix/Desktop/felix-projects/openmeld/openmeld ";
    const line = formatTextEvent(
      {
        v: 1,
        id: "meta-claude-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: "claude-agent",
          profileName: "Claude Agent",
          owner: "Felix",
          agentControllerRef: "builtin:claude-code",
          agentControllerConversationId: "f7127852-f928-45b0-add3-41bfee1ab7a7",
          workingDirectory,
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "human",
      }
    );

    const plain = stripAnsi(line);
    const originLines = plain
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("origin: "));
    expect(originLines).toEqual([
      `origin: cd '${workingDirectory}' && claude --model claude-opus-4-8 --resume f7127852-f928-45b0-add3-41bfee1ab7a7`,
    ]);
  });

  it("renders openclaw origin from the canonical session key", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "meta-openclaw-1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: "openclaw-agent",
          profileName: "OpenClaw Agent",
          owner: "Felix",
          agentControllerRef: "builtin:openclaw",
          agentControllerConversationId:
            "agent:openmeld-openclaw-phase-one:openmeld-space:demo--deadbeef",
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "human",
      }
    );

    const plain = stripAnsi(line);
    expect(plain).toContain(
      "origin: openclaw tui --session agent:openmeld-openclaw-phase-one:openmeld-space:demo--deadbeef"
    );
  });

  it("hides non-actionable agent context placeholder in human speaker label", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "meta-2",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: "mira",
          profileName: "Mira",
          owner: "Felix",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "pending",
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "human",
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("🤖 Mira ");
    expect(plainLines[1]).toBe("agent via codex · owner: Felix");
    expect(plainLines.includes("context: pending")).toBe(false);
    expect(plainLines).toHaveLength(2);
  });

  it("formats signal.text in agent view with full metadata", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "1",
        spaceId: "demo",
        ts: 1,
        profile: {
          kind: "agent",
          profileId: "mira",
          profileName: "Mira",
          owner: "Felix",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "thread-ctx-7",
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "agent",
        selfProfileId: "me",
      }
    );
    expect(stripAnsi(line)).toBe(
      "mira (kind=agent, profileName=Mira, owner=Felix, agentControllerRef=builtin:codex, agentControllerConversationId=thread-ctx-7): hi"
    );
  });

  it("formats hello ack in agent view with full metadata", () => {
    const line = formatTextEvent(
      {
        type: "system.hello.ack",
        profile: {
          kind: "agent",
          profileId: "mira",
          profileName: "Mira",
          owner: "Felix",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "thread-ctx-7",
        },
      },
      {
        view: "agent",
      }
    );
    expect(stripAnsi(line)).toBe(
      "system: hello.ack mira (kind=agent, profileName=Mira, owner=Felix, agentControllerRef=builtin:codex, agentControllerConversationId=thread-ctx-7)"
    );
  });

  it("formats hello ack in human view with profileIdentity name", () => {
    const line = formatTextEvent(
      {
        type: "system.hello.ack",
        profile: { kind: "human", profileId: "felix-id", profileName: "Felix" },
      },
      {
        view: "human",
        selfProfileId: "felix-id",
      }
    );
    expect(stripAnsi(line)).toBe("* 📣 system: connected as Felix.");
  });

  it("formats OpenMeld System text as a unified system broadcast line in human view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "dispatch-in-progress-system-hint-1",
        spaceId: "demo",
        ts: 7,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: 'Agent "new-space-agent-codex" already got the same request in the last 24h, so this duplicate was skipped. Send a new message to run again.',
        },
      },
      {
        view: "human",
      }
    );

    expect(stripAnsi(line)).toBe(
      '* 📣 system: Agent "new-space-agent-codex" already got the same request in the last 24h, so this duplicate was skipped. Send a new message to run again.'
    );
  });

  it("formats presence.join in human view as readable sentence", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "2",
        spaceId: "demo",
        ts: 2,
        profile: { kind: "agent", profileId: "seal", profileName: "Seal" },
        type: "presence.join",
        data: {},
      },
      {
        view: "human",
      }
    );
    if (line === null) {
      throw new Error("expected presence.join line");
    }
    expect(stripAnsi(line)).toMatch(TIMESTAMP_PRESENCE_JOIN_LINE_REGEX);
  });

  it("formats presence.quit in human view as readable sentence with timestamp", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "presence-quit-1",
        spaceId: "demo",
        ts: 2,
        profile: { kind: "human", profileId: "felix", profileName: "Felix" },
        type: "presence.quit",
        data: {},
      },
      {
        view: "human",
      }
    );
    if (line === null) {
      throw new Error("expected presence.quit line");
    }
    expect(stripAnsi(line)).toMatch(TIMESTAMP_PRESENCE_QUIT_LINE_REGEX);
  });

  it("renders purpose-backed member notices as a plain system line", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "join-notice-1",
        spaceId: "demo",
        ts: 3,
        profile: { kind: "human", profileId: "felix", profileName: "Felix" },
        type: "signal.text",
        data: {
          text: "Felix added 🤖 Claude Code to this space.",
          meta: {
            purpose: "space_membership_join_notice",
            targetProfileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            targetProfileKind: "agent",
            targetProfileName: "Claude Code",
            targetMentionLabel: "Claude Code",
          },
        },
      },
      {
        view: "human",
      }
    );
    const plain = stripAnsi(line);
    expect(plain).toBe(
      "* 📣 system: Felix added 🤖 Claude Code to this space. · Mention as `@Claude Code(wake)`"
    );
  });

  it("prefers the persisted target mention label over the current snapshot label for join notices", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "join-notice-persisted-mention-label",
        spaceId: "demo",
        ts: 3,
        profile: { kind: "human", profileId: "felix", profileName: "Felix" },
        type: "signal.text",
        data: {
          text: "Felix added 🤖 Claude Code to this space.",
          meta: {
            purpose: "space_membership_join_notice",
            targetProfileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            targetProfileKind: "agent",
            targetProfileName: "Claude Code",
            targetMentionLabel: "Claude Code",
          },
        },
      },
      {
        view: "human",
        spaceMembersSnapshot: {
          spaceId: "demo",
          generatedAt: "2026-03-15T00:00:00.000Z",
          summary: {
            totalCount: 2,
            humanCount: 1,
            agentCount: 1,
            liveNowCount: 0,
          },
          humans: [
            {
              profileId: "felix",
              profileName: "Felix",
              profileKind: "human",
              mentionAlias: null,
              status: "active",
              memberSource: "space_creator",
              memberSourceLabel: "Creator",
              addedAt: "2026-03-15T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-03-15T00:00:00.000Z",
              updatedAt: "2026-03-15T00:00:00.000Z",
              addedByProfileId: null,
              addedByOwnerUserId: null,
              addedByDisplayName: null,
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: "2026-03-15T00:00:00.000Z",
              lastEnteredAt: "2026-03-15T00:00:00.000Z",
              liveNow: false,
              lastSeenAt: "2026-03-15T00:00:00.000Z",
              lastSeenLabel: "seen now",
              ownerUserId: "user_felix_01",
              ownerName: "Felix",
            },
          ],
          agents: [
            createOutputAgentSnapshot({
              profileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              profileName: "Renamed Claude",
              profileKind: "agent",
              mentionAlias: null,
              status: "active",
              memberSource: "added_by_member",
              memberSourceLabel: "Added by Felix",
              addedAt: "2026-03-15T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-03-15T00:00:00.000Z",
              updatedAt: "2026-03-15T00:00:00.000Z",
              addedByProfileId: "felix",
              addedByOwnerUserId: "user_felix_01",
              addedByDisplayName: "Felix",
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: null,
              lastEnteredAt: null,
              lastSeenAt: "2026-03-15T00:00:00.000Z",
              lastSeenLabel: "seen now",
              liveNow: false,
              ownerUserId: "user_felix_01",
              ownerName: "Felix",
              agentControllerRef: "builtin:claude",
              agentControllerConversationId: "agent-context-1",
              wakeState: "wakeable",
              wakeabilityStatus: "ready",
              wakeabilityReasonCodes: [],
              wakeabilityReasonText: "This profile can be woken in Space",
            }),
          ],
        },
      }
    );

    expect(stripAnsi(line)).toBe(
      "* 📣 system: Felix added 🤖 Claude Code to this space. · Mention as `@Claude Code(wake)`"
    );
  });

  it("keeps human names plain in system presence and purpose-backed notices while preserving agent colors", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const spaceMembersSnapshot: SpaceMembersSnapshot = {
        spaceId: "demo",
        generatedAt: "2026-03-15T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
        },
        humans: [
          {
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-15T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-15T00:00:00.000Z",
            updatedAt: "2026-03-15T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-15T00:00:00.000Z",
            lastEnteredAt: "2026-03-15T00:00:00.000Z",
            liveNow: true,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            lastSeenLabel: "seen now",
            ownerUserId: "user_felix_01",
            ownerName: "Felix",
          },
        ],
        agents: [
          createOutputAgentSnapshot({
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            profileName: "my-codex",
            profileKind: "agent",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-15T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-15T00:00:00.000Z",
            updatedAt: "2026-03-15T00:00:00.000Z",
            addedByProfileId: "11111111-1111-4111-8111-111111111111",
            addedByOwnerUserId: "user_felix_01",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            lastSeenLabel: "seen now",
            liveNow: false,
            ownerUserId: "user_felix_01",
            ownerName: "Felix",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId:
              "019ce83f-a125-7113-904e-884f60de8fe1",
            wakeState: "wakeable",
            wakeabilityStatus: "ready",
            wakeabilityReasonCodes: [],
            wakeabilityReasonText: "This profile can be woken in Space",
          }),
        ],
      };
      const presenceLine = formatTextEvent(
        {
          v: 1,
          id: "presence-color-1",
          spaceId: "demo",
          ts: 2,
          profile: {
            kind: "human",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Felix",
          },
          type: "presence.join",
          data: {},
        },
        {
          view: "human",
          spaceMembersSnapshot,
        }
      );
      const noticeLine = formatTextEvent(
        {
          v: 1,
          id: "join-notice-color-1",
          spaceId: "demo",
          ts: 3,
          profile: {
            kind: "human",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Felix",
          },
          type: "signal.text",
          data: {
            text: "Felix added 🤖 my-codex to this space.",
            meta: {
              purpose: "space_membership_join_notice",
              targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
              targetProfileKind: "agent",
              targetProfileName: "my-codex",
              targetMentionLabel: "my-codex",
              addedByProfileId: "11111111-1111-4111-8111-111111111111",
              addedByDisplayName: "Felix",
            },
          },
        },
        {
          view: "human",
          spaceMembersSnapshot,
        }
      );
      const felixPrompt = formatInputPrompt(
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
          kind: "human",
          ownerUserId: "user_felix_01",
          ownerName: "Felix",
        },
        {
          spaceMembersSnapshot,
        }
      );
      const myCodexPrompt = formatInputPrompt(
        {
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "my-codex",
          kind: "agent",
        },
        {
          spaceMembersSnapshot,
        }
      );

      expect(extractFelixTrueColorPrefix(felixPrompt)).toBeUndefined();
      expect(
        presenceLine ? extractFelixTrueColorPrefix(presenceLine) : undefined
      ).toBeUndefined();
      expect(
        noticeLine ? extractFelixTrueColorPrefix(noticeLine) : undefined
      ).toBeUndefined();
      expect(
        noticeLine
          ? extractTrueColorPrefixForLabel(noticeLine, "my-codex")
          : undefined
      ).toBe(extractTrueColorPrefixForLabel(myCodexPrompt, "my-codex"));
      expect(
        noticeLine
          ? extractTrueColorPrefixForLabel(noticeLine, "`@my-codex(wake)`")
          : undefined
      ).toBe(extractTrueColorPrefixForLabel(myCodexPrompt, "my-codex"));
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });

  it("keeps legacy add-members notice as a normal chat line", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "join-notice-legacy-1",
        spaceId: "demo",
        ts: 3,
        profile: { kind: "human", profileId: "felix", profileName: "Felix" },
        type: "signal.text",
        data: {
          text: "new-space-agent-codex (agent) joined the space via add-members.",
        },
      },
      {
        view: "human",
      }
    );

    const plain = stripAnsi(line);
    expect(plain).toBe(
      `- 👤 Felix ${formatExpectedSignalTimestamp(3)}: new-space-agent-codex (agent) joined the space via add-members.\nhuman`
    );
    expect(plain.includes("* 📣 system")).toBe(false);
    expect(plain.includes("Wake with `@new-space-agent-codex`")).toBe(false);
  });

  it("keeps purpose-backed member notices as one-line system text in agent view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "join-notice-agent-view-1",
        spaceId: "demo",
        ts: 3,
        profile: { kind: "human", profileId: "felix", profileName: "Felix" },
        type: "signal.text",
        data: {
          text: "Felix added 🤖 Claude Code to this space.",
          meta: {
            purpose: "space_membership_join_notice",
            targetProfileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            targetProfileKind: "agent",
            targetProfileName: "Claude Code",
            targetMentionLabel: "Claude Code",
          },
        },
      },
      {
        view: "agent",
      }
    );

    expect(stripAnsi(line)).toBe(
      "system: Felix added 🤖 Claude Code to this space. · Mention as `@Claude Code(wake)`"
    );
  });

  it("renders purpose-backed member removal notices as a plain system line", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "remove-notice-1",
        spaceId: "demo",
        ts: 3,
        profile: { kind: "human", profileId: "felix", profileName: "Felix" },
        type: "signal.text",
        data: {
          text: "Felix removed 🤖 Claude Code from this space.",
          meta: {
            purpose: SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
            targetProfileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            targetProfileKind: "agent",
            targetProfileName: "Claude Code",
            removedByProfileId: "felix",
            removedByDisplayName: "Felix",
          },
        },
      },
      {
        view: "human",
      }
    );

    expect(stripAnsi(line)).toBe(
      "* 📣 system: Felix removed 🤖 Claude Code from this space."
    );
  });

  it("hides mention failure hint in human view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "mention-hint-1",
        spaceId: "demo",
        ts: 4,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: [
            'Mention skipped for "mention" (may be expected).',
            "If you intended to mention someone, use the exact @handle shown in this space. If needed, use @ProfileID.",
          ].join("\n"),
          meta: {
            purpose: "mention_dispatch_hint",
          },
        },
      },
      {
        view: "human",
      }
    );
    expect(line).toBeNull();
  });

  it("keeps durable mention reject notices visible in human view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "mention-reject-notice-1",
        spaceId: "demo",
        ts: 4,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: [
            'Mention skipped for "mention" (may be expected).',
            "If you intended to mention someone, use the exact @handle shown in this space. If needed, use @ProfileID.",
          ].join("\n"),
          meta: {
            purpose: SPACE_MENTION_REJECT_NOTICE_PURPOSE,
          },
        },
      },
      {
        view: "human",
      }
    );

    expect(stripAnsi(line)).toContain(
      '* 📣 system: Mention skipped for "mention" (may be expected).'
    );
  });

  it("keeps normal user text visible even if it starts with mention-hint prefix", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "mention-prefix-normal-user-1",
        spaceId: "demo",
        ts: 4,
        profile: {
          kind: "agent",
          profileId: "mira",
          profileName: "Mira",
          owner: "Felix",
        },
        type: "signal.text",
        data: {
          text: 'Mention skipped for "test" but this is a normal chat line.',
        },
      },
      {
        view: "human",
      }
    );
    expect(stripAnsi(line)).toContain(
      'Mention skipped for "test" but this is a normal chat line.'
    );
  });

  it("hides legacy mention hint text from OpenMeld System in human view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "mention-hint-legacy-1",
        spaceId: "demo",
        ts: 4,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: "Mention skipped. Try this: @ProfileName",
        },
      },
      {
        view: "human",
      }
    );
    expect(line).toBeNull();
  });

  it("keeps mention failure hint visible in agent view", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "mention-hint-2",
        spaceId: "demo",
        ts: 5,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: [
            'Mention skipped for "mention" (may be expected).',
            "If you intended to mention someone, use the exact @handle shown in this space. If needed, use @ProfileID.",
          ].join("\n"),
          meta: {
            purpose: "mention_dispatch_hint",
          },
        },
      },
      {
        view: "agent",
      }
    );
    expect(stripAnsi(line)).toContain(
      'Mention skipped for "mention" (may be expected).'
    );
  });

  it("falls back to owner id when ownerName is unavailable", () => {
    const line = formatTextEvent(
      {
        v: 1,
        id: "owner-opaque-1",
        spaceId: "demo",
        ts: 2,
        profile: {
          kind: "agent",
          profileId: "seal",
          profileName: "Seal",
          owner: "fd356631-3ec8-4e93-a730-6d4f4c78173f",
        },
        type: "signal.text",
        data: { text: "hi" },
      },
      {
        view: "human",
      }
    );

    const plainLines = stripAnsi(line).split("\n");
    expect(plainLines[0]).toContain("🤖 Seal ");
    expect(plainLines[1]).toBe(
      "agent · owner: fd356631-3ec8-4e93-a730-6d4f4c78173f"
    );
  });

  it("formats human input prompt with profileIdentity name and kind", () => {
    const prompt = formatInputPrompt({
      profileName: "mira",
      kind: "human",
      profileId: "2505aa11-fef3-476b-9546-60e26d608f60",
    });
    expect(stripAnsi(prompt)).toContain("- ");
    expect(stripAnsi(prompt)).toContain("mira (human)");
    expect(stripAnsi(prompt)).toContain(": ");
  });

  it("formats catch-up marker in human view", () => {
    expect(stripAnsi(formatCatchupMarker("human"))).toContain(
      "Conversation after you left."
    );
  });

  it("formats connect intro with space created timestamp", () => {
    const lines = formatConnectIntro({
      spaceId: "room-1",
      spaceName: "nebula",
      spaceCreatedAt: "2026-02-13T20:12:00.000Z",
      spaceCreatorName: "Felix",
      spaceCreatorId: "hum_felix_creator_01",
      passwordProtected: true,
      profileId: "profileIdentity-1",
      profileName: "Mira",
      profileKind: "agent",
      ownerName: "Felix",
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: "019cb814-35d2-72e1-a665-1ac02aafe9e5",
      modelSelection: {
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      },
      workingDirectory: "/tmp/connect-intro-codex-workspace",
      gatewayUrl: "http://127.0.0.1:8787",
      stdio: true,
    });
    const plainLines = lines.map(stripAnsi);
    expect(plainLines.some((line) => line.includes("🛰️ Space Info"))).toBe(true);
    expect(
      plainLines.some((line) => line.includes("👤 Your profile in this space"))
    ).toBe(true);
    expect(plainLines.some((line) => line.includes("Link access"))).toBe(true);
    expect(plainLines.some((line) => line.includes("password required"))).toBe(
      true
    );
    expect(
      plainLines.some((line) => line.includes("2026-02-13T20:12:00.000Z"))
    ).toBe(true);
    expect(
      plainLines.some((line) => line.includes("Space Creator  Felix"))
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes("Space Creator Profile ID  hum_felix_creator_01")
      )
    ).toBe(true);
    expect(plainLines.some((line) => line.includes("Type  agent"))).toBe(true);
    expect(
      plainLines.some((line) => line.includes("To join this space, run:"))
    ).toBe(true);
    expect(
      plainLines.some((line) => line.includes("openmeld space join room-1"))
    ).toBe(true);
    expect(plainLines.some((line) => line.includes("Owner Name  Felix"))).toBe(
      true
    );
    expect(plainLines.some((line) => line.includes("Controller  codex"))).toBe(
      true
    );
    expect(
      plainLines.some((line) =>
        line.includes(
          "Origin  cd /tmp/connect-intro-codex-workspace && codex resume -m gpt-5.4-mini 019cb814-35d2-72e1-a665-1ac02aafe9e5"
        )
      )
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes("019cb814-35d2-72e1-a665-1ac02aafe9e5")
      )
    ).toBe(true);
    expect(plainLines.some((line) => line.includes("Role Instructions"))).toBe(
      false
    );
  });

  it("labels a private members-only Space by access instead of calling it public", () => {
    const plainLines = formatConnectIntro({
      accessMode: "members_only",
      gatewayUrl: "https://gateway.openmeld.ai",
      passwordProtected: false,
      profileId: "profile-1",
      profileKind: "human",
      profileName: "Felix",
      spaceId: "space-1",
      spaceName: "Private work",
      stdio: true,
      visibility: "private",
    }).map(stripAnsi);

    expect(plainLines.some((line) => line.includes("Link access"))).toBe(true);
    expect(plainLines.some((line) => line.includes("members only"))).toBe(true);
    expect(plainLines.join("\n")).not.toContain("Public Space Warning");
    expect(plainLines.join("\n")).not.toContain("Security  public");
  });

  it("builds the original Space Info card lines directly from the shared builder", () => {
    const lines = buildSpaceInfoCardLines({
      gatewayUrl: "https://gateway.openmeld.ai",
      modeLabel: "interactive chat",
      passwordProtected: false,
      spaceCreatedAt: "2026-03-04T21:16:08.881Z",
      spaceCreatorId: "cc4cfabe-8f04-41b5-a4ca-20413afb3fb5",
      spaceCreatorName: "felix",
      spaceId:
        "a203fc0fc18f71881e82ec9d96e0177c943b03e1ab8a29b8c3f5878e567224ff",
      spaceName: "felix-space",
    });
    const plainLines = lines.map(stripAnsi);

    expect(plainLines.some((line) => line.includes("🛰️ Space Info"))).toBe(true);
    expect(
      plainLines.some((line) => line.includes("Space Name  felix-space"))
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes(
          "Space ID  a203fc0fc18f71881e82ec9d96e0177c943b03e1ab8a29b8c3f5878e567224ff"
        )
      )
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes("Gateway URL  https://gateway.openmeld.ai")
      )
    ).toBe(true);
    expect(
      plainLines.some((line) => line.includes("Mode  interactive chat"))
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes(
          "openmeld space join a203fc0fc18f71881e82ec9d96e0177c943b03e1ab8a29b8c3f5878e567224ff"
        )
      )
    ).toBe(true);
  });

  it("uses the current lane command when building Space Info join guidance", () => {
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    const lines = buildSpaceInfoCardLines({
      gatewayUrl: "https://gateway.openmeld.ai",
      modeLabel: "interactive chat",
      passwordProtected: false,
      spaceCreatedAt: "2026-03-04T21:16:08.881Z",
      spaceCreatorId: "cc4cfabe-8f04-41b5-a4ca-20413afb3fb5",
      spaceCreatorName: "felix",
      spaceId: "room-1",
      spaceName: "felix-space",
    });
    const plainLines = lines.map(stripAnsi);

    expect(
      plainLines.some((line) => line.includes("openmeld-dev space join room-1"))
    ).toBe(true);
  });

  it("renders public-space warnings in Space Info", () => {
    const lines = formatConnectIntro({
      spaceId: "room-public",
      spaceName: "open nebula",
      passwordProtected: false,
      profileId: "profileIdentity-1",
      profileName: "Mira",
      profileKind: "human",
      gatewayUrl: "http://127.0.0.1:8787",
      stdio: true,
    });
    const plainLines = lines.map(stripAnsi);

    expect(
      plainLines.some((line) =>
        line.includes(
          "Anyone with this Space link can read what is shared here and join."
        )
      )
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes(
          "Only bring an agent if you're comfortable sharing anything it posts with people who have the link."
        )
      )
    ).toBe(true);
  });

  it("does not render public-space warnings when security is unknown", () => {
    const lines = formatConnectIntro({
      spaceId: "room-unknown",
      spaceName: "mystery nebula",
      profileId: "profileIdentity-1",
      profileName: "Mira",
      profileKind: "human",
      gatewayUrl: "http://127.0.0.1:8787",
      stdio: true,
    });
    const plainLines = lines.map(stripAnsi);

    expect(
      plainLines.some((line) =>
        line.includes(
          "Anyone with this Space link can read what is shared here and join."
        )
      )
    ).toBe(false);
  });

  it("renders a Space Members card in the connect intro", () => {
    const lines = formatConnectIntro({
      spaceId: "room-1",
      spaceName: "nebula",
      profileId: "profileIdentity-1",
      profileName: "Mira",
      profileKind: "human",
      gatewayUrl: "http://127.0.0.1:8787",
      stdio: false,
      spaceMembersSnapshot: {
        spaceId: "room-1",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
        },
        humans: [
          {
            profileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
          },
        ],
        agents: [
          createOutputAgentSnapshot({
            profileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
            profileName: "ops-bot",
            profileKind: "agent",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            addedByOwnerUserId: "owner-felix",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: true,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
            agentControllerRef: "builtin:ops-bot",
            agentControllerConversationId: null,
            wakeState: "wakeable",
            wakeabilityStatus: "ready",
            wakeabilityReasonCodes: [],
            wakeabilityReasonText: "This profile can be woken in Space",
          }),
        ],
      },
    });
    const plainLines = lines.map(stripAnsi);
    const agentsHeaderIndex = plainLines.findIndex((line) =>
      line.includes("🤖 Agents")
    );
    const humansHeaderIndex = plainLines.findIndex((line) =>
      line.includes("👤 Humans")
    );

    expect(plainLines.some((line) => line.includes("👥 Space Members"))).toBe(
      true
    );
    expect(plainLines.some((line) => line.includes("👤 Humans"))).toBe(true);
    expect(agentsHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(humansHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(agentsHeaderIndex).toBeLessThan(humansHeaderIndex);
    expect(
      plainLines.some((line) =>
        line.includes(`Felix · ${HUMAN_FELIX_RUNTIME_PROFILE_ID}`)
      )
    ).toBe(true);
    expect(
      plainLines.some((line) => line.includes("space creator · seen just now"))
    ).toBe(true);
    expect(plainLines.some((line) => line.includes("owns: @ops-bot"))).toBe(
      true
    );
    expect(plainLines.some((line) => line.includes("🤖 Agents"))).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes(`ops-bot · ${AGENT_OPS_BOT_RUNTIME_PROFILE_ID}`)
      )
    ).toBe(true);
    expect(
      plainLines.some((line) => line.includes("owner: Felix · added by: Felix"))
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes(
          "mention: @ops-bot(wake) · via ops-bot · live now · seen just now"
        )
      )
    ).toBe(true);
  });

  it("builds the original Space Members card lines directly from the shared builder", () => {
    const snapshot: SpaceMembersSnapshot = {
      spaceId: "room-1",
      generatedAt: "2026-03-06T00:00:00.000Z",
      summary: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        liveNowCount: 1,
      },
      humans: [
        {
          profileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
          profileName: "Felix",
          profileKind: "human",
          mentionAlias: null,
          status: "active",
          memberSource: "space_creator",
          memberSourceLabel: "Creator",
          addedAt: "2026-03-06T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayName: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: "2026-03-06T00:00:00.000Z",
          lastEnteredAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenLabel: "Seen just now",
          liveNow: false,
          ownerUserId: "owner-felix",
          ownerName: "Felix",
        },
      ],
      agents: [
        createOutputAgentSnapshot({
          profileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
          profileName: "ops-bot",
          profileKind: "agent",
          mentionAlias: null,
          status: "active",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by Felix",
          addedAt: "2026-03-06T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
          addedByProfileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
          addedByOwnerUserId: "owner-felix",
          addedByDisplayName: "Felix",
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: null,
          lastEnteredAt: null,
          lastSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenLabel: "Seen just now",
          liveNow: true,
          ownerUserId: "owner-felix",
          ownerName: "Felix",
          agentControllerRef: "builtin:ops-bot",
          agentControllerConversationId: null,
          wakeState: "wakeable",
          wakeabilityStatus: "ready",
          wakeabilityReasonCodes: [],
          wakeabilityReasonText: "This profile can be woken in Space",
        }),
      ],
    };
    const plainLines = buildSpaceMembersCardLines(snapshot).map(stripAnsi);
    const agentsHeaderIndex = plainLines.findIndex((line) =>
      line.includes("🤖 Agents")
    );
    const humansHeaderIndex = plainLines.findIndex((line) =>
      line.includes("👤 Humans")
    );

    expect(plainLines.some((line) => line.includes("👥 Space Members"))).toBe(
      true
    );
    expect(plainLines.some((line) => line.includes("👤 Humans"))).toBe(true);
    expect(agentsHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(humansHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(agentsHeaderIndex).toBeLessThan(humansHeaderIndex);
    expect(
      plainLines.some((line) =>
        line.includes(`Felix · ${HUMAN_FELIX_RUNTIME_PROFILE_ID}`)
      )
    ).toBe(true);
    expect(plainLines.some((line) => line.includes("owns: @ops-bot"))).toBe(
      true
    );
    expect(plainLines.some((line) => line.includes("🤖 Agents"))).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes(`ops-bot · ${AGENT_OPS_BOT_RUNTIME_PROFILE_ID}`)
      )
    ).toBe(true);
    expect(
      plainLines.some((line) => line.includes("owner: Felix · added by: Felix"))
    ).toBe(true);
    expect(
      plainLines.some((line) =>
        line.includes(
          "mention: @ops-bot(wake) · via ops-bot · live now · seen just now"
        )
      )
    ).toBe(true);
  });

  it("highlights live now in Space Members metadata with a brighter green accent", () => {
    const lines = buildSpaceMembersCardLines({
      spaceId: "room-1",
      generatedAt: "2026-03-06T00:00:00.000Z",
      summary: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        liveNowCount: 2,
      },
      humans: [
        {
          profileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
          profileName: "Felix",
          profileKind: "human",
          mentionAlias: null,
          status: "active",
          memberSource: "space_creator",
          memberSourceLabel: "Creator",
          addedAt: "2026-03-06T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayName: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: "2026-03-06T00:00:00.000Z",
          lastEnteredAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenLabel: "seen just now",
          liveNow: true,
          ownerUserId: "owner-felix",
          ownerName: "Felix",
        },
      ],
      agents: [
        createOutputAgentSnapshot({
          profileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
          profileName: "ops-bot",
          profileKind: "agent",
          mentionAlias: null,
          status: "active",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by Felix",
          addedAt: "2026-03-06T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
          addedByProfileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
          addedByOwnerUserId: "owner-felix",
          addedByDisplayName: "Felix",
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          wakeabilityStatus: "ready",
          wakeabilityReasonCodes: [],
          wakeabilityReasonText: "This profile can be woken in Space",
          wakeState: "wakeable",
          agentControllerRef: "builtin:openclaw",
          agentControllerConversationId: "ctx_ops_bot",
          ownerUserId: "owner-felix",
          ownerName: "Felix",
          firstEnteredAt: "2026-03-06T00:00:00.000Z",
          lastEnteredAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenLabel: "seen just now",
          liveNow: true,
        }),
      ],
    });

    const humanMetadataLine = lines.find((line) =>
      stripAnsi(line).includes("space creator · live now · seen just now")
    );
    const agentStatusLine = lines.find((line) =>
      stripAnsi(line).includes(
        "mention: @ops-bot(wake) · via openclaw · live now · seen just now"
      )
    );

    expect(humanMetadataLine).toContain(LIVE_NOW_ACCENT);
    expect(agentStatusLine).toContain(LIVE_NOW_ACCENT);
  });

  it("shows manual participation guidance for unbound offline agents in Space Members", () => {
    const lines = formatConnectIntro({
      spaceId: "room-1",
      spaceName: "nebula",
      profileId: "profileIdentity-1",
      profileName: "Mira",
      profileKind: "human",
      gatewayUrl: "http://127.0.0.1:8787",
      stdio: false,
      spaceMembersSnapshot: {
        spaceId: "room-1",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: true,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
          },
        ],
        agents: [
          createOutputAgentSnapshot({
            profileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
            profileName: "ops-bot",
            profileKind: "agent",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            addedByOwnerUserId: "owner-felix",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
            agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
              agentProfileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
              displayState: "blocked",
              reasonCodes: ["agent_profile_binding.missing"],
            }),
            agentControllerRef: "builtin:ops-bot",
            agentControllerConversationId: null,
            wakeState: "offline",
            wakeabilityStatus: "blocked",
            wakeabilityReasonCodes: ["route.unavailable"],
            wakeabilityReasonText: "Legacy wakeability is unavailable",
          }),
        ],
      },
    });
    const plainLines = lines.map(stripAnsi);

    expect(
      plainLines.some((line) =>
        line.includes(
          "mention: @ops-bot(wake) · manual join/send only · via ops-bot · seen just now"
        )
      )
    ).toBe(true);
  });

  it("shows reply route unavailable for blocked agents in Space Members", () => {
    const lines = formatConnectIntro({
      spaceId: "room-1",
      spaceName: "nebula",
      profileId: "profileIdentity-1",
      profileName: "Mira",
      profileKind: "human",
      gatewayUrl: "http://127.0.0.1:8787",
      stdio: false,
      spaceMembersSnapshot: {
        spaceId: "room-1",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: true,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
          },
        ],
        agents: [
          createOutputAgentSnapshot({
            profileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
            profileName: "ops-bot",
            profileKind: "agent",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
            addedByOwnerUserId: "owner-felix",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
            agentControllerRef: "builtin:ops-bot",
            agentControllerConversationId: null,
            wakeState: "offline",
            wakeabilityStatus: "blocked",
            wakeabilityReasonCodes: ["route.unavailable"],
            wakeabilityReasonText: "Daemon route is unavailable right now",
            daemonRouteReasonCode: "lookup_failed",
            daemonRouteStatus: "unavailable",
          }),
        ],
      },
    });
    const plainLines = lines.map(stripAnsi);

    expect(
      plainLines.some((line) =>
        line.includes(
          "mention: @ops-bot(wake) · reply route unavailable · via ops-bot · seen just now"
        )
      )
    ).toBe(true);
  });

  it("keeps human profile names plain in Space Members", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const spaceMembersSnapshot: SpaceMembersSnapshot = {
        spaceId: "room-1",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 1,
          humanCount: 1,
          agentCount: 0,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
          },
        ],
        agents: [],
      };
      const prompt = formatInputPrompt(
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
          kind: "human",
          ownerUserId: "owner-felix",
          ownerName: "Felix",
        },
        {
          spaceMembersSnapshot,
        }
      );
      const lines = formatConnectIntro({
        spaceId: "room-1",
        profileId: "profileIdentity-1",
        profileName: "Mira",
        profileKind: "human",
        gatewayUrl: "http://127.0.0.1:8787",
        stdio: false,
        spaceMembersSnapshot,
      });

      const promptColorPrefix = extractFelixTrueColorPrefix(prompt);
      const memberLine = lines.find((line) =>
        stripAnsi(line).includes("Felix · 11111111-1111-4111-8111-111111111111")
      );
      const memberColorPrefix = memberLine
        ? extractFelixTrueColorPrefix(memberLine)
        : undefined;

      expect(promptColorPrefix).toBeUndefined();
      expect(memberColorPrefix).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });

  it("renders Space Members owner labels as dim metadata with human colors disabled", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const spaceMembersSnapshot: SpaceMembersSnapshot = {
        spaceId: "room-1",
        generatedAt: "2026-03-06T00:00:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [
          {
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Felix",
            profileKind: "human",
            mentionAlias: null,
            status: "active",
            memberSource: "space_creator",
            memberSourceLabel: "Creator",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayName: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: "2026-03-06T00:00:00.000Z",
            lastEnteredAt: "2026-03-06T00:00:00.000Z",
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
          },
        ],
        agents: [
          createOutputAgentSnapshot({
            profileId: "agt_33333333-3333-4333-8333-333333333333",
            profileName: "ops-bot",
            profileKind: "agent",
            mentionAlias: null,
            status: "active",
            memberSource: "added_by_member",
            memberSourceLabel: "Added by Felix",
            addedAt: "2026-03-06T00:00:00.000Z",
            removedAt: null,
            createdAt: "2026-03-06T00:00:00.000Z",
            updatedAt: "2026-03-06T00:00:00.000Z",
            addedByProfileId: "11111111-1111-4111-8111-111111111111",
            addedByOwnerUserId: "owner-felix",
            addedByDisplayName: "Felix",
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: null,
            lastEnteredAt: null,
            lastSeenAt: "2026-03-06T00:00:00.000Z",
            lastSeenLabel: "Seen just now",
            liveNow: false,
            ownerUserId: "owner-felix",
            ownerName: "Felix",
            agentControllerRef: "builtin:ops-bot",
            agentControllerConversationId: null,
            wakeState: "wakeable",
            wakeabilityStatus: "ready",
            wakeabilityReasonCodes: [],
            wakeabilityReasonText: "This profile can be woken in Space",
          }),
        ],
      };
      const prompt = formatInputPrompt(
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
          kind: "human",
          ownerUserId: "owner-felix",
          ownerName: "Felix",
        },
        {
          spaceMembersSnapshot,
        }
      );
      const lines = buildSpaceMembersCardLines(spaceMembersSnapshot);

      const promptColorPrefix = extractFelixTrueColorPrefix(prompt);
      const ownerLine = lines.find((line) =>
        stripAnsi(line).includes("owner: Felix")
      );
      const ownerColorPrefix = ownerLine
        ? extractFelixTrueColorPrefix(ownerLine)
        : undefined;

      expect(promptColorPrefix).toBeUndefined();
      expect(ownerLine).toContain(pc.dim("owner: Felix"));
      expect(ownerColorPrefix).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });

  it("colorizes the Space Members mention label with the same stable profile color", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const lines = formatConnectIntro({
        spaceId: "room-1",
        profileId: "profileIdentity-1",
        profileName: "Mira",
        profileKind: "human",
        gatewayUrl: "http://127.0.0.1:8787",
        stdio: false,
        spaceMembersSnapshot: {
          spaceId: "room-1",
          generatedAt: "2026-03-06T00:00:00.000Z",
          summary: {
            totalCount: 1,
            humanCount: 0,
            agentCount: 1,
            liveNowCount: 0,
          },
          humans: [],
          agents: [
            createOutputAgentSnapshot({
              profileId: AGENT_OPS_BOT_RUNTIME_PROFILE_ID,
              profileName: "ops-bot",
              profileKind: "agent",
              mentionAlias: null,
              status: "active",
              memberSource: "added_by_member",
              memberSourceLabel: "Added by Felix",
              addedAt: "2026-03-06T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-03-06T00:00:00.000Z",
              updatedAt: "2026-03-06T00:00:00.000Z",
              addedByProfileId: HUMAN_FELIX_RUNTIME_PROFILE_ID,
              addedByOwnerUserId: "owner-felix",
              addedByDisplayName: "Felix",
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: null,
              lastEnteredAt: null,
              lastSeenAt: "2026-03-06T00:00:00.000Z",
              lastSeenLabel: "Seen just now",
              liveNow: false,
              ownerUserId: "owner-felix",
              ownerName: "Felix",
              agentControllerRef: "builtin:ops-bot",
              agentControllerConversationId: null,
              wakeState: "wakeable",
              wakeabilityStatus: "ready",
              wakeabilityReasonCodes: [],
              wakeabilityReasonText: "This profile can be woken in Space",
            }),
          ],
        },
      });

      const profileLine = lines.find((line) =>
        stripAnsi(line).includes(
          `ops-bot · ${AGENT_OPS_BOT_RUNTIME_PROFILE_ID}`
        )
      );
      const badgeLine = lines.find((line) =>
        stripAnsi(line).includes("mention: @Ops Bot(wake)")
      );

      const profileColorPrefix = profileLine
        ? extractTrueColorPrefixForLabel(profileLine, "ops-bot")
        : undefined;
      const wakeBadgeColorPrefix = badgeLine
        ? extractTrueColorPrefixForLabel(badgeLine, "@Ops Bot(wake)")
        : undefined;

      expect(profileColorPrefix).toBeUndefined();
      expect(wakeBadgeColorPrefix).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });

  it("keeps human names plain in chat rows, system presence rows, and add-members notices", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      value: true,
      configurable: true,
      writable: true,
    });

    try {
      const snapshot = createRuntimeIdentityColorSnapshot();
      const humanProfile = {
        kind: "human" as const,
        profileId: "823a46d4-b711-45b2-933e-722ef5b3a8ee",
        profileName: "OpenMeld Dev Local Test",
      };

      const chatLine = formatTextEvent(
        {
          v: 1,
          id: "signal-text-human",
          spaceId: "demo",
          ts: 7,
          profile: humanProfile,
          type: "signal.text",
          data: {
            text: "hello",
          },
        },
        {
          view: "human",
          spaceMembersSnapshot: snapshot,
        }
      );

      const presenceLine = formatTextEvent(
        {
          v: 1,
          id: "presence-join-human",
          spaceId: "demo",
          ts: 8,
          profile: humanProfile,
          type: "presence.join",
          data: {},
        },
        {
          view: "human",
          spaceMembersSnapshot: snapshot,
        }
      );

      const systemNoticeLine = formatTextEvent(
        {
          v: 1,
          id: "signal-text-system-notice",
          spaceId: "demo",
          ts: 9,
          profile: humanProfile,
          type: "signal.text",
          data: {
            text: "OpenMeld Dev Local Test added 🤖 hi-agent to this space.",
            meta: {
              purpose: SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
              addedByDisplayName: "OpenMeld Dev Local Test",
              targetProfileId: "agt_46759e81-292c-4f7b-8108-95512ee2b2a1",
              targetProfileKind: "agent",
              targetProfileName: "hi-agent",
              targetMentionLabel: "hi-agent",
            },
          },
        },
        {
          view: "human",
          spaceMembersSnapshot: snapshot,
        }
      );

      const chatColor = extractTrueColorPrefixForLabel(
        chatLine ?? "",
        "OpenMeld Dev Local Test"
      );
      const presenceColor = extractTrueColorPrefixForLabel(
        presenceLine ?? "",
        "OpenMeld Dev Local Test"
      );
      const systemNoticeColor = extractTrueColorPrefixForLabel(
        systemNoticeLine ?? "",
        "OpenMeld Dev Local Test"
      );

      expect(chatColor).toBeUndefined();
      expect(presenceColor).toBeUndefined();
      expect(systemNoticeColor).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        value: originalColorSupport,
        configurable: true,
        writable: true,
      });
    }
  });
});

function createRuntimeIdentityColorSnapshot(): SpaceMembersSnapshot {
  return {
    spaceId: "demo",
    generatedAt: "2026-03-15T00:00:00.000Z",
    summary: {
      totalCount: 2,
      humanCount: 1,
      agentCount: 1,
      liveNowCount: 1,
    },
    humans: [
      {
        profileId: "823a46d4-b711-45b2-933e-722ef5b3a8ee",
        profileName: "OpenMeld Dev Local Test",
        profileKind: "human",
        mentionAlias: null,
        status: "active",
        memberSource: "space_creator",
        memberSourceLabel: "space creator",
        addedAt: "2026-03-15T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
        addedByProfileId: null,
        addedByOwnerUserId: null,
        addedByDisplayName: null,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: "2026-03-15T00:00:00.000Z",
        lastEnteredAt: "2026-03-15T00:00:00.000Z",
        lastSeenAt: "2026-03-15T00:00:00.000Z",
        lastSeenLabel: "seen now",
        liveNow: true,
        ownerUserId: "user_openmeld_dev_local_test",
        ownerName: "OpenMeld Dev Local Test",
      },
    ],
    agents: [
      createOutputAgentSnapshot({
        profileId: "agt_46759e81-292c-4f7b-8108-95512ee2b2a1",
        profileName: "hi-agent",
        profileKind: "agent",
        mentionAlias: null,
        status: "active",
        memberSource: "added_by_member",
        memberSourceLabel: "added by OpenMeld Dev Local Test",
        addedAt: "2026-03-15T00:00:00.000Z",
        removedAt: null,
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
        addedByProfileId: "823a46d4-b711-45b2-933e-722ef5b3a8ee",
        addedByOwnerUserId: "user_openmeld_dev_local_test",
        addedByDisplayName: "OpenMeld Dev Local Test",
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: "2026-03-15T00:00:00.000Z",
        lastEnteredAt: "2026-03-15T00:00:00.000Z",
        lastSeenAt: "2026-03-15T00:00:00.000Z",
        lastSeenLabel: "seen now",
        liveNow: true,
        ownerUserId: "user_openmeld_dev_local_test",
        ownerName: "OpenMeld Dev Local Test",
        agentControllerRef: "builtin:codex",
        agentControllerConversationId:
          "codex resume 019ce83f-a125-7113-904e-884f60de8fe1",
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "wakeable",
      }),
    ],
  };
}

function extractTrueColorPrefixForLabel(
  value: string,
  label: string
): string | undefined {
  const labelIndex = value.indexOf(label);
  if (labelIndex < 0) {
    return undefined;
  }
  const startIndex = value.lastIndexOf(TRUECOLOR_PREFIX_START, labelIndex);
  if (startIndex < 0) {
    return undefined;
  }
  return value.slice(startIndex, labelIndex);
}

function extractFelixTrueColorPrefix(value: string): string | undefined {
  return extractTrueColorPrefixForLabel(value, "Felix");
}

function extractInlineTrueColorPrefixForLabel(
  value: string | null,
  label: string
): string | undefined {
  if (!value) {
    return undefined;
  }
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(
    new RegExp(
      `(${TRUECOLOR_PREFIX_START}[0-9;]+m)${escapedLabel}\\u001B\\[39m`
    )
  );
  return match?.[1];
}
