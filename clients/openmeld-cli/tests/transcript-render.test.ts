import { stripVTControlCharacters } from "node:util";
import type { SignalEnvelope, SignalTextReplyTo } from "@openmeld/protocol";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  MessageEnvelope,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import pc from "picocolors";
import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import type { SpaceTranscriptItem } from "../src/space/state/space-screen-state";
import { buildHumanTranscriptItemFromEvent } from "../src/space/transcript/transcript-item-builder";
import {
  buildHumanTranscriptProjection,
  buildTranscriptBlocks,
  renderTranscriptBlocks,
} from "../src/space/transcript/transcript-render";
import { OPENMELD_COMPOSER_SURFACE_BG_RGB } from "../src/ui/brand";
import { renderPositiveAccentText } from "../src/ui/positive-accent";
import {
  colorizeProfileLabel,
  resolveAgentSurfaceRgb,
  resolvePersonColorIdentity,
} from "../src/ui/profile-label-color";

const FELIX_RUNTIME_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OPENMELD_DEV_LOCAL_TEST_PROFILE_ID =
  "823a46d4-b711-45b2-933e-722ef5b3a8ee";
const AGENT_OPS_RUNTIME_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const AGENT_GUEST_RUNTIME_PROFILE_ID =
  "agt_33333333-3333-4333-8333-333333333333";
const HI_AGENT_RUNTIME_PROFILE_ID = "agt_44444444-4444-4444-8444-444444444444";
const AGENT_MISSING_RUNTIME_PROFILE_ID =
  "agt_55555555-5555-4555-8555-555555555555";
const AGENT_UNKNOWN_TARGET_RUNTIME_PROFILE_ID =
  "agt_66666666-6666-4666-8666-666666666666";

describe("transcript render helpers", () => {
  it("counts hidden system notices by source notice, not rendered line count", () => {
    const projection = buildHumanTranscriptProjection({
      items: [
        {
          groupKey: "system",
          kind: "system_notice",
          line: "* 📣 system: First line.\nSecond line.",
          ts: new Date(2026, 2, 14, 15, 38).getTime(),
        },
        {
          groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
          kind: "message",
          line: "- 👤 Felix 20260313 03:04: hello\nhuman · space creator · seen now",
          ts: new Date(2026, 2, 14, 15, 40).getTime(),
        },
      ],
      membersSnapshot: createMembersSnapshot(),
      sessionProfile: createHumanSessionProfile(),
    });

    expect(projection.hiddenSummary.hiddenSystemNoticeCount).toBe(1);
  });

  it("groups contiguous messages and compacts same-actor presence churn", () => {
    const firstTs = new Date(2026, 2, 14, 15, 42).getTime();
    const secondTs = new Date(2026, 2, 14, 15, 47).getTime();
    const items: SpaceTranscriptItem[] = [
      {
        groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
        kind: "message",
        line: "- 👤 Felix 20260313 03:04: hello\nhuman · space creator · seen now",
        ts: new Date(2026, 2, 14, 15, 40).getTime(),
      },
      {
        groupKey: "system",
        kind: "presence",
        line: "* 📣 system: 👤 Felix joined the space.",
        ts: firstTs,
        presenceAction: "join",
        actorProfileId: "11111111-1111-4111-8111-111111111111",
        actorKind: "human",
        actorLabel: "Felix",
        actorAvatar: "👤",
      },
      {
        groupKey: "system",
        kind: "presence",
        line: "* 📣 system: 👤 Felix left the space.",
        ts: secondTs,
        presenceAction: "left",
        actorProfileId: "11111111-1111-4111-8111-111111111111",
        actorKind: "human",
        actorLabel: "Felix",
        actorAvatar: "👤",
      },
      {
        groupKey: "system",
        kind: "system_notice",
        line: '* 📣 system: Agent "ops-bot" is offline.',
        ts: new Date(2026, 2, 14, 15, 48).getTime(),
      },
      {
        groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
        kind: "message",
        line: "- 🤖 Ops Bot 20260313 03:06: I’m here.\nagent via codex · owner: Felix",
        ts: new Date(2026, 2, 14, 15, 49).getTime(),
      },
    ];

    expect(
      buildTranscriptBlocks(
        items,
        createMembersSnapshot(),
        createHumanSessionProfile()
      )
    ).toMatchObject([
      {
        kind: "plain_text_group",
        groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
        speakerKind: "human",
        highlightKind: "self_human",
        speakerProfileId: "11111111-1111-4111-8111-111111111111",
        speakerProfileName: "Felix",
        speakerOwnerUserId: "user_felix",
        speakerOwnerName: "Felix",
        speakerControllerDisplay: null,
        speakerOwnerDisplay: null,
        messages: [
          {
            primaryLine: "- 👤 Felix 20260313 03:04: hello",
            headerLeading: "👤 Felix",
            headerTrailing: pc.dim("20260314 15:40:00"),
            relationLines: [],
            bodyLines: ["hello"],
            bodyDetailLines: [],
            metaLines: ["human · space creator · seen now"],
            detailLines: ["human · space creator · seen now"],
            rawLines: [
              "- 👤 Felix 20260313 03:04: hello",
              "human · space creator · seen now",
            ],
          },
        ],
      },
      {
        kind: "presence_trace_group",
        groupKey: "system",
        actorKey: "11111111-1111-4111-8111-111111111111",
        actorProfileId: "11111111-1111-4111-8111-111111111111",
        actorKind: "human",
        actorAvatar: "👤",
        actorLabel: "Felix",
        actorOwnerUserId: "user_felix",
        actorOwnerName: "Felix",
        startTs: firstTs,
        endTs: secondTs,
        joinCount: 1,
        leftCount: 1,
        count: 2,
      },
      {
        kind: "system_group",
        groupKey: "system",
        lines: ['* 📣 system: Agent "ops-bot" is offline.'],
        purposes: [null],
        sourceNoticeCount: 1,
      },
      {
        kind: "plain_text_group",
        groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
        speakerKind: "agent",
        highlightKind: "owned_agent",
        speakerProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
        speakerProfileName: "Ops Bot",
        speakerOwnerUserId: "user_felix",
        speakerOwnerName: "Felix",
        speakerControllerDisplay: "codex",
        speakerOwnerDisplay: "Felix",
        messages: [
          {
            primaryLine: "- 🤖 Ops Bot 20260313 03:06: I’m here.",
            headerLeading: `🤖 Ops Bot${pc.dim(" · ")}${pc.dim("codex")}${pc.dim(" · ")}${pc.dim("by ")}${colorizeProfileLabel(
              "Felix",
              {
                ...resolvePersonColorIdentity({
                  ownerUserId: "user_felix",
                  ownerName: "Felix",
                  profileName: "Felix",
                }),
              }
            )}`,
            headerTrailing: pc.dim("20260314 15:49:00"),
            relationLines: [],
            bodyLines: ["I’m here."],
            bodyDetailLines: [],
            metaLines: ["agent via codex · owner: Felix"],
            detailLines: ["agent via codex · owner: Felix"],
            rawLines: [
              "- 🤖 Ops Bot 20260313 03:06: I’m here.",
              "agent via codex · owner: Felix",
            ],
          },
        ],
      },
    ]);
  });

  it("groups contiguous member-added notices from the same actor into a membership trace block", () => {
    const firstTs = new Date(2026, 2, 14, 23, 31).getTime();
    const secondTs = new Date(2026, 2, 14, 23, 33).getTime();
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: "system",
          kind: "membership_notice",
          line: "Felix added 🤖 Ops Bot to this space. · Mention as `@Ops Bot(wake)`",
          ts: firstTs,
          membershipNotice: {
            action: "member_added",
            actorProfileId: "11111111-1111-4111-8111-111111111111",
            actorKind: "human",
            actorLabel: "Felix",
            targetProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            targetProfileKind: "agent",
            targetProfileLabel: "Ops Bot",
            mentionLabel: "Ops Bot",
            ts: firstTs,
          },
        },
        {
          groupKey: "system",
          kind: "membership_notice",
          line: "Felix added Guest Bot to this space.",
          ts: secondTs,
          membershipNotice: {
            action: "member_added",
            actorProfileId: "11111111-1111-4111-8111-111111111111",
            actorKind: "human",
            actorLabel: "Felix",
            targetProfileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            targetProfileKind: "agent",
            targetProfileLabel: "Guest Bot",
            mentionLabel: null,
            ts: secondTs,
          },
        },
      ],
      createMembersSnapshot(),
      createHumanSessionProfile()
    );

    expect(blocks).toContainEqual(
      expect.objectContaining({
        kind: "membership_trace_group",
        groupKey: "system",
        actorKey: "11111111-1111-4111-8111-111111111111",
        actorProfileId: "11111111-1111-4111-8111-111111111111",
        actorKind: "human",
        actorAvatar: "👤",
        actorLabel: "Felix",
        actorOwnerUserId: "user_felix",
        actorOwnerName: "Felix",
        startTs: firstTs,
        endTs: secondTs,
        targets: [
          expect.objectContaining({
            profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            kind: "agent",
            label: "Ops Bot",
            mentionLabel: "Ops Bot",
          }),
          expect.objectContaining({
            profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            kind: "agent",
            label: "Guest Bot",
            mentionLabel: "Guest Bot",
          }),
        ],
      })
    );
  });

  it("renders member-added traces as a summary plus a compact target list", () => {
    const firstTs = new Date(2026, 2, 14, 23, 31).getTime();
    const secondTs = new Date(2026, 2, 14, 23, 33).getTime();
    const output = stripVTControlCharacters(
      renderTranscriptBlocks(
        buildTranscriptBlocks(
          [
            {
              groupKey: "system",
              kind: "membership_notice",
              line: "Felix added 🤖 Ops Bot to this space. · Mention as `@Ops Bot(wake)`",
              ts: firstTs,
              membershipNotice: {
                action: "member_added",
                actorProfileId: "11111111-1111-4111-8111-111111111111",
                actorKind: "human",
                actorLabel: "Felix",
                targetProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
                targetProfileKind: "agent",
                targetProfileLabel: "Ops Bot",
                mentionLabel: "Ops Bot",
                ts: firstTs,
              },
            },
            {
              groupKey: "system",
              kind: "membership_notice",
              line: "Felix added cancel-removal-human to this space.",
              ts: secondTs,
              membershipNotice: {
                action: "member_added",
                actorProfileId: "11111111-1111-4111-8111-111111111111",
                actorKind: "human",
                actorLabel: "Felix",
                targetProfileId: "hum_cancel",
                targetProfileKind: "human",
                targetProfileLabel: "cancel-removal-human",
                mentionLabel: null,
                ts: secondTs,
              },
            },
          ],
          createMembersSnapshot(),
          createHumanSessionProfile()
        ),
        120
      ).join("\n")
    );

    expect(output).toContain("23:31–23:33 · 👤 Felix · added 2 members");
    expect(output).toContain("@Ops Bot(wake) · cancel-removal-human");
    expect(output).not.toContain("Wake with");
    expect(output).not.toContain("to this space");
    expect(output).not.toContain("+ 1 more");
  });

  it("renders member-removed traces with a symmetric removal summary", () => {
    const firstTs = new Date(2026, 2, 16, 9, 44).getTime();
    const secondTs = new Date(2026, 2, 16, 9, 45).getTime();
    const output = stripVTControlCharacters(
      renderTranscriptBlocks(
        buildTranscriptBlocks(
          [
            {
              groupKey: "system",
              kind: "membership_notice",
              line: "Felix removed 🤖 Ops Bot from this space.",
              ts: firstTs,
              membershipNotice: {
                action: "member_removed",
                actorProfileId: "11111111-1111-4111-8111-111111111111",
                actorKind: "human",
                actorLabel: "Felix",
                targetProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
                targetProfileKind: "agent",
                targetProfileLabel: "Ops Bot",
                mentionLabel: "Ops Bot",
                ts: firstTs,
              },
            },
            {
              groupKey: "system",
              kind: "membership_notice",
              line: "Felix removed Guest Bot from this space.",
              ts: secondTs,
              membershipNotice: {
                action: "member_removed",
                actorProfileId: "11111111-1111-4111-8111-111111111111",
                actorKind: "human",
                actorLabel: "Felix",
                targetProfileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
                targetProfileKind: "agent",
                targetProfileLabel: "Guest Bot",
                mentionLabel: "guest-bot",
                ts: secondTs,
              },
            },
          ],
          createMembersSnapshot(),
          createHumanSessionProfile()
        ),
        120
      ).join("\n")
    );

    expect(output).toContain("09:44–09:45 · 👤 Felix · removed 2 agents");
    expect(output).toContain("@Ops Bot(wake) · @Guest Bot(wake)");
  });

  it("does not merge member-added notices across a foreign transcript block", () => {
    const firstTs = new Date(2026, 2, 14, 23, 31).getTime();
    const secondTs = new Date(2026, 2, 14, 23, 33).getTime();
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: "system",
          kind: "membership_notice",
          line: "Felix added 🤖 Ops Bot to this space.",
          ts: firstTs,
          membershipNotice: {
            action: "member_added",
            actorProfileId: "11111111-1111-4111-8111-111111111111",
            actorKind: "human",
            actorLabel: "Felix",
            targetProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            targetProfileKind: "agent",
            targetProfileLabel: "Ops Bot",
            mentionLabel: "ops-bot",
            ts: firstTs,
          },
        },
        {
          groupKey: "profile-id:hum_other",
          kind: "message",
          line: "- 👤 Other 20260314 23:32: hello",
          ts: new Date(2026, 2, 14, 23, 32).getTime(),
        },
        {
          groupKey: "system",
          kind: "membership_notice",
          line: "Felix added Guest Bot to this space.",
          ts: secondTs,
          membershipNotice: {
            action: "member_added",
            actorProfileId: "11111111-1111-4111-8111-111111111111",
            actorKind: "human",
            actorLabel: "Felix",
            targetProfileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            targetProfileKind: "agent",
            targetProfileLabel: "Guest Bot",
            mentionLabel: null,
            ts: secondTs,
          },
        },
      ],
      createMembersSnapshot(),
      createHumanSessionProfile()
    );

    expect(
      blocks.filter((block) => block.kind === "membership_trace_group")
    ).toHaveLength(2);
  });

  it("strips the legacy human header from body lines even when the timestamp is ANSI-dimmed", () => {
    const ansiColoredName =
      "\u001B[38;2;174;255;80mATS Dev Local Test\u001B[39m";
    const ansiDimmedTimestamp = "\u001B[2m20260315 00:11\u001B[22m";
    const selfMembersSnapshot = createMembersSnapshot();
    const selfMember = selfMembersSnapshot.humans[0];
    if (!selfMember) {
      throw new Error("Expected seeded human member in members snapshot");
    }
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: "profile-id:hum_self",
          kind: "message",
          line: `- 👤 ${ansiColoredName} ${ansiDimmedTimestamp}: yo\nhuman · space creator · seen now`,
          ts: new Date(2026, 2, 15, 0, 11, 50).getTime(),
        },
      ],
      {
        ...selfMembersSnapshot,
        humans: [
          {
            ...selfMember,
            profileId: "hum_self",
            profileName: "OpenMeld Dev Local Test",
          },
        ],
      },
      {
        profileId: "hum_self",
        profileName: "OpenMeld Dev Local Test",
        kind: "human",
        ownerUserId: "user_felix",
        ownerName: "OpenMeld Dev Local Test",
      }
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "plain_text_group",
        messages: [
          expect.objectContaining({
            bodyLines: ["yo"],
          }),
        ],
      }),
    ]);
  });

  it("strips the legacy self header even when members snapshot is unavailable", () => {
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: "profile-id:823a46d4-b711-45b2-933e-722ef5b3a8ee",
          kind: "message",
          line: "- 👤 OpenMeld Dev Local Test 20260315 00:11: yo\nhuman · space creator · seen now",
          ts: new Date(2026, 2, 15, 0, 11, 50).getTime(),
        },
      ],
      null,
      {
        profileId: "823a46d4-b711-45b2-933e-722ef5b3a8ee",
        profileName: "OpenMeld Dev Local Test",
        kind: "human",
        ownerUserId: "user_openmeld_dev_local_test",
        ownerName: "OpenMeld Dev Local Test",
      }
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "plain_text_group",
        speakerKind: "human",
        speakerProfileName: "OpenMeld Dev Local Test",
        messages: [
          expect.objectContaining({
            bodyLines: ["yo"],
          }),
        ],
      }),
    ]);
  });

  it("prefers structured formatted message content over reparsing the rendered line", () => {
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: "profile-id:hum_self",
          kind: "message",
          line: "- 👤 OpenMeld Dev Local Test 20260315 00:11: stale body\nhuman · stale meta",
          formattedMessage: {
            bodyLines: ["fresh body", "second paragraph"],
            relationLines: [],
            metaLines: ["human · space creator · seen now"],
          },
          ts: new Date(2026, 2, 15, 0, 11, 50).getTime(),
        },
      ],
      null,
      {
        profileId: "hum_self",
        profileName: "OpenMeld Dev Local Test",
        kind: "human",
        ownerUserId: "user_felix",
        ownerName: "OpenMeld Dev Local Test",
      }
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "plain_text_group",
        messages: [
          expect.objectContaining({
            bodyLines: ["fresh body", "second paragraph"],
            metaLines: ["human · space creator · seen now"],
          }),
        ],
      }),
    ]);
  });

  it("keeps presence compaction across a 15 minute gap but breaks at 16 minutes", () => {
    const joinTs = new Date(2026, 2, 14, 15, 42).getTime();
    const withinGapTs = new Date(2026, 2, 14, 15, 57).getTime();
    const overGapTs = new Date(2026, 2, 14, 16, 13).getTime();

    const blocks = buildTranscriptBlocks(
      [
        createPresenceItem({
          ts: joinTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: withinGapTs,
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: overGapTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
      ],
      createMembersSnapshot(),
      createHumanSessionProfile()
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "presence_trace_group",
        startTs: joinTs,
        endTs: withinGapTs,
        count: 2,
      }),
      expect.objectContaining({
        kind: "presence_trace_group",
        startTs: overGapTs,
        endTs: overGapTs,
        count: 1,
      }),
    ]);
  });

  it("breaks presence compaction across actor changes and non-presence rows", () => {
    const joinTs = new Date(2026, 2, 14, 15, 42).getTime();
    const leftTs = new Date(2026, 2, 14, 15, 43).getTime();
    const laterJoinTs = new Date(2026, 2, 14, 16, 13).getTime();
    const items: SpaceTranscriptItem[] = [
      createPresenceItem({
        ts: joinTs,
        action: "join",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        mentionAlias: null,
        profileName: "Felix",
      }),
      createPresenceItem({
        ts: leftTs,
        action: "left",
        profileId: "hum_amy",
        profileKind: "human",
        mentionAlias: null,
        profileName: "Amy",
      }),
      {
        groupKey: "system",
        kind: "system_notice",
        line: "* 📣 system: connected as Felix.",
        ts: new Date(2026, 2, 14, 15, 44).getTime(),
      },
      createPresenceItem({
        ts: laterJoinTs,
        action: "join",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        mentionAlias: null,
        profileName: "Felix",
      }),
    ];

    expect(
      buildTranscriptBlocks(
        items,
        createMembersSnapshot(),
        createHumanSessionProfile()
      ).map((block) => block.kind)
    ).toEqual([
      "presence_trace_group",
      "presence_trace_group",
      "system_group",
      "presence_trace_group",
    ]);
  });

  it("breaks presence compaction when the same-actor cluster span exceeds 60 minutes", () => {
    const startTs = new Date(2026, 2, 14, 15, 42).getTime();
    const secondTs = new Date(2026, 2, 14, 15, 57).getTime();
    const thirdTs = new Date(2026, 2, 14, 16, 12).getTime();
    const fourthTs = new Date(2026, 2, 14, 16, 27).getTime();
    const withinSpanTs = new Date(2026, 2, 14, 16, 42).getTime();
    const overSpanTs = new Date(2026, 2, 14, 16, 43).getTime();

    const blocks = buildTranscriptBlocks(
      [
        createPresenceItem({
          ts: startTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: secondTs,
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: thirdTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: fourthTs,
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: withinSpanTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: overSpanTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
      ],
      createMembersSnapshot(),
      createHumanSessionProfile()
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "presence_trace_group",
        startTs,
        endTs: withinSpanTs,
        count: 5,
      }),
      expect.objectContaining({
        kind: "presence_trace_group",
        startTs: overSpanTs,
        endTs: overSpanTs,
        count: 1,
      }),
    ]);
  });

  it("coalesces same-actor presence clusters across exactly one foreign presence row", () => {
    const firstJoinTs = new Date(2026, 2, 14, 19, 44).getTime();
    const firstLeftTs = new Date(2026, 2, 14, 19, 46).getTime();
    const foreignLeftTs = new Date(2026, 2, 14, 19, 53).getTime();
    const secondJoinTs = new Date(2026, 2, 14, 19, 57).getTime();
    const secondLeftTs = new Date(2026, 2, 14, 20, 3).getTime();

    const blocks = buildTranscriptBlocks(
      [
        createPresenceItem({
          ts: firstJoinTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: firstLeftTs,
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: foreignLeftTs,
          action: "left",
          profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
          profileKind: "agent",
          mentionAlias: null,
          profileName: "Ops Bot",
        }),
        createPresenceItem({
          ts: secondJoinTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: secondLeftTs,
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
      ],
      createMembersSnapshot(),
      createHumanSessionProfile()
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "presence_trace_group",
        actorKey: "11111111-1111-4111-8111-111111111111",
        startTs: firstJoinTs,
        endTs: secondLeftTs,
        joinCount: 2,
        leftCount: 2,
        count: 4,
      }),
      expect.objectContaining({
        kind: "presence_trace_group",
        actorKey: AGENT_OPS_RUNTIME_PROFILE_ID,
        startTs: foreignLeftTs,
        endTs: foreignLeftTs,
        count: 1,
      }),
    ]);
  });

  it("does not coalesce same-actor presence clusters across more than one foreign presence row", () => {
    const blocks = buildTranscriptBlocks(
      [
        createPresenceItem({
          ts: new Date(2026, 2, 14, 19, 44).getTime(),
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: new Date(2026, 2, 14, 19, 53).getTime(),
          action: "left",
          profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
          profileKind: "agent",
          mentionAlias: null,
          profileName: "Ops Bot",
        }),
        createPresenceItem({
          ts: new Date(2026, 2, 14, 19, 54).getTime(),
          action: "join",
          profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
          profileKind: "agent",
          mentionAlias: null,
          profileName: "Guest Bot",
        }),
        createPresenceItem({
          ts: new Date(2026, 2, 14, 19, 57).getTime(),
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
      ],
      createMembersSnapshot(),
      createHumanSessionProfile()
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "presence_trace_group",
      "presence_trace_group",
      "presence_trace_group",
      "presence_trace_group",
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "presence_trace_group",
      actorKey: "11111111-1111-4111-8111-111111111111",
      count: 1,
    });
    expect(blocks[3]).toMatchObject({
      kind: "presence_trace_group",
      actorKey: "11111111-1111-4111-8111-111111111111",
      count: 1,
    });
  });

  it("renders presence trace rows without legacy system prefixes while keeping system lines plain", () => {
    const firstTs = new Date(2026, 2, 14, 15, 42).getTime();
    const secondTs = new Date(2026, 2, 14, 15, 47).getTime();
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260313 03:04: @ops-bot hey there this is a much longer line that should wrap cleanly inside the bubble\nhuman · space creator · seen now\nowns: @ops-bot",
            ts: new Date(2026, 2, 14, 15, 40).getTime(),
          },
          createPresenceItem({
            ts: firstTs,
            action: "join",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            mentionAlias: null,
            profileName: "Felix",
          }),
          createPresenceItem({
            ts: secondTs,
            action: "left",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            mentionAlias: null,
            profileName: "Felix",
          }),
          {
            groupKey: "system",
            kind: "system_notice",
            line: '* 📣 system: Agent "ops-bot" is offline.',
            ts: new Date(2026, 2, 14, 15, 48).getTime(),
          },
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Ops Bot 20260313 03:06: I’m here.\nagent via codex · owner: Felix",
            ts: new Date(2026, 2, 14, 15, 49).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      48
    );

    const strippedLines = renderedLines.map(stripAnsi);
    const strippedOutput = strippedLines.join("\n");
    expect(renderedLines.some((line) => line.includes("\u001B[48;2;"))).toBe(
      true
    );
    expect(strippedOutput).not.toContain("📣 System");
    expect(strippedOutput).toContain(
      "20260314 15:42–15:47 · 👤 Felix · join/left ×2"
    );
    expect(strippedOutput).not.toContain(
      "* 📣 system: 👤 Felix joined the space."
    );
    expect(strippedOutput).not.toContain(
      "* 📣 system: 👤 Felix left the space."
    );
    expect(strippedOutput).toContain('Agent "ops-bot" is offline.');
    expect(strippedOutput).toContain('* 📣 system: Agent "ops-bot"');
    expect(normalizeWhitespace(strippedOutput)).toContain(
      "human · space creator · seen now"
    );
    expect(normalizeWhitespace(strippedOutput)).not.toContain("owns: @ops-bot");
    expect(strippedOutput).toContain("owner: Felix");
    expect(strippedOutput).not.toContain("agent via codex · owner: Felix");
    const rawPresenceLine = renderedLines.find((line) =>
      stripAnsi(line).includes("20260314 15:42–15:47 · 👤 Felix · join/left ×2")
    );
    expect(rawPresenceLine).toBeDefined();
    expect(rawPresenceLine).not.toContain("\u001B[38;2;");
    const rawSystemNoticeLine = renderedLines.find((line) =>
      stripAnsi(line).includes('Agent "ops-bot" is offline.')
    );
    expect(rawSystemNoticeLine).toBeDefined();
    expect(rawSystemNoticeLine).not.toContain("\u001B[38;2;");
    const centeredPresenceLine = strippedLines.find((line) =>
      line.includes("20260314 15:42–15:47 · 👤 Felix · join/left ×2")
    );
    expect(centeredPresenceLine).toBeDefined();
    expect(centeredPresenceLine?.startsWith(" ")).toBe(true);
  });

  it("fills the available transcript width for bubble lines", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260313 03:04: this bubble should expand to the full available transcript width\nhuman · space creator · seen now\nowns: @ops-bot",
            ts: new Date(2026, 2, 14, 15, 40).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      64
    );

    const bubbleLines = renderedLines.filter((line) => line.length > 0);

    expect(bubbleLines.length).toBeGreaterThan(0);
    for (const line of bubbleLines) {
      expect(stringWidth(stripAnsi(line))).toBe(64);
    }
  });

  it("renders bubble header with left profile info, right timestamp, and blank lines around body and meta", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:hum_history",
            kind: "message",
            line: "- 👤 history-debug-human 20260314 16:19: hello-fix-check\nhuman · member · seen 2h ago",
            ts: new Date(2026, 2, 14, 16, 19).getTime(),
          },
        ],
        {
          ...createMembersSnapshot(),
          summary: {
            totalCount: 1,
            humanCount: 1,
            agentCount: 0,
            liveNowCount: 0,
          },
          humans: [
            {
              profileId: "hum_history",
              profileName: "history-debug-human",
              profileKind: "human",
              mentionAlias: null,
              status: "active",
              memberSource: "joined_directly",
              memberSourceLabel: "member",
              addedAt: "2026-03-14T00:00:00.000Z",
              removedAt: null,
              createdAt: "2026-03-14T00:00:00.000Z",
              updatedAt: "2026-03-14T00:00:00.000Z",
              addedByProfileId: null,
              addedByOwnerUserId: null,
              addedByDisplayName: null,
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: "2026-03-14T00:00:00.000Z",
              lastEnteredAt: "2026-03-14T00:00:00.000Z",
              lastSeenAt: "2026-03-14T14:19:00.000Z",
              lastSeenLabel: "seen 2h ago",
              liveNow: false,
              ownerUserId: "user_history",
              ownerName: "history-debug-human",
            },
          ],
          agents: [],
        },
        createHumanSessionProfile()
      ),
      80
    );

    const strippedLines = renderedLines.map(stripAnsi);

    expect(strippedLines).toHaveLength(7);
    expect(
      strippedLines[1]?.trimStart().startsWith("👤 history-debug-human")
    ).toBe(true);
    expect(strippedLines[1]?.trimEnd().endsWith("20260314 16:19:00")).toBe(
      true
    );
    expect(strippedLines[2]?.trim()).toBe("");
    expect(strippedLines[3]?.trim()).toBe("› hello-fix-check");
    expect(strippedLines[4]?.trim()).toBe("");
    expect(strippedLines[5]?.trim()).toBe("human · member · seen 2h ago");
  });

  it("coalesces adjacent human message groups after hidden presence churn is removed from the human transcript", () => {
    const firstJoinTs = new Date(2026, 2, 14, 23, 52).getTime();
    const firstMessageTs = new Date(2026, 2, 14, 23, 58, 47).getTime();
    const hiddenPresenceTs = new Date(2026, 2, 14, 23, 58, 47).getTime();
    const secondMessageTs = new Date(2026, 2, 14, 23, 58, 48).getTime();

    const projection = buildHumanTranscriptProjection({
      items: [
        createPresenceItem({
          ts: firstJoinTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        {
          groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
          kind: "message",
          line: "- 👤 Felix 20260314 23:58: yo\nhuman · member · seen now",
          ts: firstMessageTs,
        },
        createPresenceItem({
          ts: hiddenPresenceTs,
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: hiddenPresenceTs + 500,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        {
          groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
          kind: "message",
          line: "- 👤 Felix 20260314 23:58: clear\nhuman · member · seen now",
          ts: secondMessageTs,
        },
      ],
      membersSnapshot: createMembersSnapshot({
        humans: [
          {
            profileId: "11111111-1111-4111-8111-111111111111",
            firstEnteredAt: new Date(firstJoinTs).toISOString(),
          },
        ],
      }),
      sessionProfile: createHumanSessionProfile(),
    });

    expect(projection.transcriptBlocks).toEqual([
      expect.objectContaining({
        kind: "presence_first_join_group",
        actorKey: "11111111-1111-4111-8111-111111111111",
      }),
      expect.objectContaining({
        kind: "plain_text_group",
        speakerProfileId: "11111111-1111-4111-8111-111111111111",
        messages: [
          expect.objectContaining({
            bodyLines: ["yo"],
          }),
          expect.objectContaining({
            bodyLines: ["clear"],
            headerPresenceBadge: "live now",
          }),
        ],
      }),
    ]);
  });

  it("does not render first joined when the actor already spoke earlier in the transcript", () => {
    const earlierMessageTs = new Date(2026, 2, 14, 13, 1, 46).getTime();
    const reconnectJoinTs = new Date(2026, 2, 14, 13, 30).getTime();

    const projection = buildHumanTranscriptProjection({
      items: [
        {
          groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
          kind: "message",
          line: "- 🤖 Ops Bot 20260314 13:01: hey\nagent via codex · owner: Felix",
          ts: earlierMessageTs,
        },
        createPresenceItem({
          ts: reconnectJoinTs,
          action: "join",
          profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
          profileKind: "agent",
          mentionAlias: null,
          profileName: "Ops Bot",
        }),
      ],
      membersSnapshot: createMembersSnapshot({
        agents: [
          {
            profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            firstEnteredAt: new Date(reconnectJoinTs).toISOString(),
            liveNow: true,
            lastSeenLabel: "seen now",
          },
        ],
      }),
      sessionProfile: createHumanSessionProfile(),
    });

    expect(
      projection.transcriptBlocks.some(
        (block) => block.kind === "presence_first_join_group"
      )
    ).toBe(false);
    expect(projection.transcriptBlocks).toEqual([
      expect.objectContaining({
        kind: "plain_text_group",
        speakerProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
        messages: [
          expect.objectContaining({
            bodyLines: ["hey"],
            headerPresenceBadge: "live now",
          }),
        ],
      }),
    ]);
  });

  it("does not render first joined when members snapshot already records an earlier entry", () => {
    const historicalFirstEnteredAt = new Date(
      2026,
      2,
      14,
      0,
      39,
      8
    ).toISOString();
    const reconnectJoinTs = new Date(2026, 2, 14, 13, 30).getTime();
    const messageTs = reconnectJoinTs + 1000;

    const projection = buildHumanTranscriptProjection({
      items: [
        createPresenceItem({
          ts: reconnectJoinTs,
          action: "join",
          profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
          profileKind: "agent",
          mentionAlias: null,
          profileName: "Ops Bot",
        }),
        {
          groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
          kind: "message",
          line: "- 🤖 Ops Bot 20260314 13:30: back again\nagent via codex · owner: Felix",
          ts: messageTs,
        },
      ],
      membersSnapshot: createMembersSnapshot({
        agents: [
          {
            profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            firstEnteredAt: historicalFirstEnteredAt,
            lastEnteredAt: historicalFirstEnteredAt,
            liveNow: true,
            lastSeenLabel: "seen now",
          },
        ],
      }),
      sessionProfile: createHumanSessionProfile(),
    });

    expect(
      projection.transcriptBlocks.some(
        (block) => block.kind === "presence_first_join_group"
      )
    ).toBe(false);
    expect(projection.transcriptBlocks).toEqual([
      expect.objectContaining({
        kind: "plain_text_group",
        speakerProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
        messages: [
          expect.objectContaining({
            bodyLines: ["back again"],
            headerPresenceBadge: "live now",
          }),
        ],
      }),
    ]);
  });

  it("includes the calendar date in presence logs rows", () => {
    const firstJoinTs = new Date(2026, 2, 14, 15, 42).getTime();
    const secondJoinTs = new Date(2026, 2, 14, 15, 47).getTime();

    const projection = buildHumanTranscriptProjection({
      items: [
        createPresenceItem({
          ts: firstJoinTs,
          action: "join",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
        createPresenceItem({
          ts: secondJoinTs,
          action: "left",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          mentionAlias: null,
          profileName: "Felix",
        }),
      ],
      membersSnapshot: createMembersSnapshot({
        humans: [
          {
            profileId: "11111111-1111-4111-8111-111111111111",
            firstEnteredAt: new Date(firstJoinTs).toISOString(),
          },
        ],
      }),
      sessionProfile: createHumanSessionProfile(),
    });

    expect(projection.logsSections).toContainEqual(
      expect.objectContaining({
        kind: "presence",
        lines: [
          "20260314 15:42 · 👤 Felix · first joined",
          "20260314 15:42–15:47 · 👤 Felix · join/left ×2",
        ],
      })
    );
  });

  it("keeps structured important system notices in the human transcript even when the text itself is generic", () => {
    const projection = buildHumanTranscriptProjection({
      items: [
        {
          groupKey: "system",
          kind: "system_notice",
          line: "* 📣 system: continuity sentinel",
          systemPurpose: "conversation_continuity_warning",
        },
        {
          groupKey: "system",
          kind: "system_notice",
          line: "* 📣 system: routine refresh completed",
          systemPurpose: "routine_refresh_completed",
        },
      ],
    });

    expect(projection.transcriptBlocks).toEqual([
      {
        kind: "system_group",
        groupKey: "system",
        lines: ["* 📣 system: continuity sentinel"],
        purposes: ["conversation_continuity_warning"],
        sourceNoticeCount: 2,
      },
    ]);
    expect(projection.logsSections).toEqual([
      {
        kind: "system",
        items: [
          {
            id: "system:0",
            lines: [
              "* 📣 system: continuity sentinel",
              "* 📣 system: routine refresh completed",
            ],
          },
        ],
        title: "System",
        lines: [
          "* 📣 system: continuity sentinel",
          "* 📣 system: routine refresh completed",
        ],
      },
      {
        kind: "membership",
        items: [],
        title: "Membership",
        lines: [],
      },
      {
        kind: "presence",
        items: [],
        title: "Presence",
        lines: [],
      },
    ]);
  });

  it("keeps durable mention reject notices in the human transcript as important system notices", () => {
    const projection = buildHumanTranscriptProjection({
      items: [
        {
          groupKey: "system",
          kind: "system_notice",
          line: '* 📣 system: Mention skipped for "ghost" (may be expected).',
          systemPurpose: "space_mention_reject_notice",
        },
      ],
    });

    expect(projection.transcriptBlocks).toEqual([
      {
        kind: "system_group",
        groupKey: "system",
        lines: ['* 📣 system: Mention skipped for "ghost" (may be expected).'],
        purposes: ["space_mention_reject_notice"],
        sourceNoticeCount: 1,
      },
    ]);
  });

  it("falls back to important text patterns for human transcript system notices when no structured purpose is present", () => {
    const projection = buildHumanTranscriptProjection({
      items: [
        {
          groupKey: "system",
          kind: "system_notice",
          line: "* 📣 system: connection closed before the last reply was confirmed",
        },
        {
          groupKey: "system",
          kind: "system_notice",
          line: "* 📣 system: routine refresh completed",
        },
      ],
    });

    expect(projection.transcriptBlocks).toEqual([
      {
        kind: "system_group",
        groupKey: "system",
        lines: [
          "* 📣 system: connection closed before the last reply was confirmed",
        ],
        purposes: [null],
        sourceNoticeCount: 2,
      },
    ]);
    expect(projection.logsSections).toEqual([
      {
        kind: "system",
        items: [
          {
            id: "system:0",
            lines: [
              "* 📣 system: connection closed before the last reply was confirmed",
              "* 📣 system: routine refresh completed",
            ],
          },
        ],
        title: "System",
        lines: [
          "* 📣 system: connection closed before the last reply was confirmed",
          "* 📣 system: routine refresh completed",
        ],
      },
      {
        kind: "membership",
        items: [],
        title: "Membership",
        lines: [],
      },
      {
        kind: "presence",
        items: [],
        title: "Presence",
        lines: [],
      },
    ]);
  });

  it("shows the timestamp only on the right side and prefixes only the first body line", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: `profile-id:${HI_AGENT_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: `- ${pc.cyan("🤖 hi-agent")} 20260314 22:18: 你指出的是核心问题，而且判断是对的：\n如果把 Space 当成所有 agent 的共享 prompt buffer，这个系统一定会失控。\n真正可行的做法，是让 agent 协作而不是共享上下文。\nagent via codex · owner: OpenMeld Dev Local Test`,
            ts: new Date(2026, 2, 14, 22, 18).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      96
    );

    const strippedLines = renderedLines.map(stripAnsi);
    const normalizedOutput = strippedLines.join("\n");

    expect(
      strippedLines.some(
        (line) =>
          line.includes("🤖 hi-agent") &&
          line.trimEnd().endsWith("20260314 22:18:00")
      )
    ).toBe(true);
    expect(normalizedOutput).not.toContain("🤖 hi-agent 20260314 22:18:00:");
    expect(normalizedOutput).not.toContain("› :");
    expect(
      strippedLines.some((line) =>
        line.trimStart().startsWith("› 你指出的是核心问题")
      )
    ).toBe(true);
    expect(
      strippedLines.some((line) =>
        line.trimStart().startsWith("› 如果把 Space")
      )
    ).toBe(false);
    expect(
      strippedLines.some((line) => line.trimStart().startsWith("› 真正可行"))
    ).toBe(false);
    expect(normalizedOutput).toContain("owner: OpenMeld Dev Local Test");
    expect(normalizedOutput).not.toContain(
      "agent via codex · owner: OpenMeld Dev Local Test"
    );
  });

  it("adds agent controller and owner info next to the profile name in the header", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Ops Bot 20260314 22:18: hello",
            ts: new Date(2026, 2, 14, 22, 18).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      96
    );
    const strippedLines = renderedLines.map(stripAnsi);

    expect(
      strippedLines.some(
        (line) =>
          line.includes("🤖 Ops Bot · codex · by Felix") &&
          line.trimEnd().endsWith("20260314 22:18:00")
      )
    ).toBe(true);
    expect(
      renderedLines.some((line) =>
        line.includes(
          colorizeProfileLabel("Felix", {
            profileId: "user_felix",
            profileName: "Felix",
            kind: "human",
          })
        )
      )
    );
  });

  it("keeps agent header metadata on the header row when the primary line uses a colored profile name", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: `- 🤖 ${pc.magenta("Ops Bot")} 20260314 22:18: 你指出的是核心问题，而且判断是对的`,
            ts: new Date(2026, 2, 14, 22, 18, 12).getTime(),
          },
        ],
        createMembersSnapshot({
          agents: [
            {
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              profileName: "Ops Bot",
              ownerUserId: "user_felix",
              ownerName: "OpenMeld Dev Local Test",
              agentControllerRef: "builtin:codex",
            },
          ],
        }),
        createHumanSessionProfile()
      ),
      120
    ).map(stripAnsi);
    const normalizedOutput = renderedLines
      .map((line) => normalizeWhitespace(line))
      .join("\n");

    expect(normalizedOutput).toContain(
      "🤖 Ops Bot · codex · by OpenMeld Dev Local Test 20260314 22:18:12"
    );
    expect(
      renderedLines.some((line) =>
        line.includes("› 🤖 Ops Bot 20260314 22:18:")
      )
    ).toBe(false);
    expect(
      renderedLines.some(
        (line) =>
          line.includes("· codex · by OpenMeld Dev Local Test") &&
          !line.includes("🤖 Ops Bot")
      )
    ).toBe(false);
    expect(
      renderedLines.some((line) =>
        line.trimStart().startsWith("› 你指出的是核心问题，而且判断是对的")
      )
    ).toBe(true);
  });

  it("omits offline presence badges from message bubble headers", () => {
    const renderedLines = renderTranscriptBlocks(
      buildHumanTranscriptProjection({
        items: [
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Ops Bot 20260314 22:18: hello",
            ts: new Date(2026, 2, 14, 22, 18, 12).getTime(),
          },
        ],
        membersSnapshot: createMembersSnapshot({
          agents: [
            {
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              ownerName: "OpenMeld Dev Local Test",
              liveNow: false,
            },
          ],
        }),
        sessionProfile: createHumanSessionProfile(),
      }).transcriptBlocks,
      120
    ).map(stripAnsi);

    const normalizedOutput = renderedLines
      .map((line) => normalizeWhitespace(line))
      .join("\n");

    expect(normalizedOutput).toContain(
      "🤖 Ops Bot · codex · by OpenMeld Dev Local Test 20260314 22:18:12"
    );
    expect(normalizedOutput).not.toContain("· left");
  });

  it("omits left as a historical member seen label in message metadata", () => {
    const renderedLines = renderTranscriptBlocks(
      buildHumanTranscriptProjection({
        items: [
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Ops Bot 20260314 22:18: hello",
            ts: new Date(2026, 2, 14, 22, 18, 12).getTime(),
          },
        ],
        membersSnapshot: createMembersSnapshot({
          agents: [
            {
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              ownerName: "OpenMeld Dev Local Test",
              liveNow: false,
              lastSeenLabel: "Left",
            },
          ],
        }),
        sessionProfile: createHumanSessionProfile(),
      }).transcriptBlocks,
      120
    ).map(stripAnsi);

    const normalizedOutput = renderedLines
      .map((line) => normalizeWhitespace(line))
      .join("\n");

    expect(normalizedOutput).toContain(
      "🤖 Ops Bot · codex · by OpenMeld Dev Local Test 20260314 22:18:12"
    );
    expect(normalizedOutput).not.toContain("· left");
  });

  it("renders live now with a green accent in bubble headers", () => {
    const renderedLines = renderTranscriptBlocks(
      buildHumanTranscriptProjection({
        items: [
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Ops Bot 20260314 22:18: hello",
            ts: new Date(2026, 2, 14, 22, 18, 12).getTime(),
          },
        ],
        membersSnapshot: createMembersSnapshot({
          agents: [
            {
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              ownerName: "OpenMeld Dev Local Test",
              liveNow: true,
            },
          ],
        }),
        sessionProfile: createHumanSessionProfile(),
      }).transcriptBlocks,
      120
    );

    const headerLine = renderedLines.find((line) =>
      stripAnsi(line).includes("🤖 Ops Bot")
    );

    expect(headerLine).toBeDefined();
    expect(headerLine).toContain(renderPositiveAccentText("live now"));
    expect(normalizeWhitespace(stripAnsi(headerLine ?? ""))).toContain(
      "🤖 Ops Bot · codex · by OpenMeld Dev Local Test · live now 20260314 22:18:12"
    );
  });

  it("fills the available transcript width for system cluster lines", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          createPresenceItem({
            ts: new Date(2026, 2, 14, 17, 18).getTime(),
            action: "join",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            mentionAlias: null,
            profileName: "Felix",
          }),
          {
            groupKey: "system",
            kind: "system_notice",
            line: '* 📣 system: Agent "ops-bot" is offline.',
            ts: new Date(2026, 2, 14, 17, 19).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      64
    );

    const systemLines = renderedLines.filter((line) => line.length > 0);

    expect(systemLines.length).toBeGreaterThan(0);
    for (const line of systemLines) {
      expect(stringWidth(stripAnsi(line))).toBe(64);
    }
  });

  it("keeps multiline message body lines out of the flattened meta line", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260313 03:04: first line\nsecond body line\nthird body line\nhuman · space creator · seen now\nowns: @ops-bot",
            ts: new Date(2026, 2, 14, 15, 40).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    );

    const strippedOutput = renderLinesToPlainText(renderedLines);
    expect(normalizeWhitespace(strippedOutput)).toContain("first line");
    expect(normalizeWhitespace(strippedOutput)).toContain("second body line");
    expect(normalizeWhitespace(strippedOutput)).toContain("third body line");
    expect(normalizeWhitespace(strippedOutput)).toContain(
      "human · space creator · seen now"
    );
    expect(normalizeWhitespace(strippedOutput)).not.toContain("owns: @ops-bot");
    expect(normalizeWhitespace(strippedOutput)).not.toContain(
      "second body line · third body line · human · space creator"
    );
  });

  it("keeps the gap above meta and restores the bubble bottom padding", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260313 03:04: hello\nhuman · space creator · seen now\nowns: @ops-bot",
            ts: new Date(2026, 2, 14, 15, 40).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    );

    const bubbleLines = renderedLines.map(stripAnsi);
    const metaLineIndex = bubbleLines.findIndex((line) =>
      line.includes("human · space creator · seen now")
    );

    expect(metaLineIndex).toBeGreaterThan(0);
    expect(bubbleLines.some((line) => line.includes("owns: @ops-bot"))).toBe(
      false
    );
    expect(bubbleLines[metaLineIndex - 1]?.trim()).toBe("");
    expect(bubbleLines[metaLineIndex + 1]?.trim()).toBe("");
    const rawMetaLine = renderedLines[metaLineIndex] ?? "";
    expect(rawMetaLine).not.toContain("\u001B[38;2;");
  });

  it("renders origin on its own footer line without inserting a hard wrap", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile:agent:agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            kind: "message",
            line: "- 🤖 OpenClaw Agent 20260325 11:29: Reply body\nagent via openclaw · owner: Felix · added by: felix\norigin: openclaw tui --session agent:openmeld-my-openclaw-25-agt-02b0-e7254b16:openmeld-space:felix-test-space--52178d43",
            ts: new Date(2026, 2, 25, 11, 29).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    );

    const bubbleLines = renderedLines.map(stripAnsi);
    const originLines = bubbleLines.filter((line) => line.includes("origin:"));

    expect(originLines).toHaveLength(1);
    expect(originLines[0]).toContain(
      "origin: openclaw tui --session agent:openmeld-my-openclaw-25-agt-02b0-e7254b16:openmeld-space:felix-test-space--52178d43"
    );
    expect(
      bubbleLines.some(
        (line) =>
          line.includes("owner: Felix · added by: felix") &&
          !line.includes("origin:")
      )
    ).toBe(true);
  });

  it("renders the reply line tightly above the body with a connected prefix", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: `profile-id:${AGENT_GUEST_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Guest Bot 20260314 20:10: Reply body\nagent via guest · owner: Other Owner",
            ts: new Date(2026, 2, 14, 20, 10).getTime(),
            replyRef: createReplyRef({
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              profileName: "Old Ops Name",
              previewText: "1234567890123456789012345678901234567890",
            }),
          },
        ],
        createMembersSnapshot({
          agents: [
            {
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              profileName: "Ops Bot Live",
            },
          ],
        }),
        createHumanSessionProfile()
      ),
      80
    ).map(stripAnsi);

    const headerLineIndex = renderedLines.findIndex((line) =>
      line.includes("🤖 Guest Bot")
    );

    expect(headerLineIndex).toBeGreaterThanOrEqual(0);
    expect(renderedLines[headerLineIndex + 1]?.trim()).toBe("");
    expect(normalizeWhitespace(renderedLines[headerLineIndex + 2] ?? "")).toBe(
      "reply to Ops Bot Live · 1234567890123456789012345678901…"
    );
    expect(normalizeWhitespace(renderedLines[headerLineIndex + 3] ?? "")).toBe(
      "╰─› Reply body"
    );
  });

  it("renders relation lines above the exact body text for canonical messages", () => {
    const sessionProfile = createHumanSessionProfile({
      profileId: FELIX_RUNTIME_PROFILE_ID,
    });
    const item = buildHumanTranscriptItemFromEvent({
      event: createSignalEnvelope({
        id: "sig-canonical-relations",
        profile: {
          kind: "human",
          profileId: FELIX_RUNTIME_PROFILE_ID,
          profileName: "Felix",
        },
        text: "@Phase 2a Agent(wake) @Ops Bot(reference)",
        messageEnvelope: {
          text: "@Phase 2a Agent(wake) @Ops Bot(reference)",
          activationTargets: [AGENT_OPS_RUNTIME_PROFILE_ID],
          referenceTargets: [AGENT_GUEST_RUNTIME_PROFILE_ID],
        },
      }),
      mentionHighlightIndex: null,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: FELIX_RUNTIME_PROFILE_ID,
      sessionProfileIdentity: sessionProfile,
      spaceMembersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
        agents: [
          {
            profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            profileName: "Phase 2a Agent",
          },
          {
            profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            profileName: "Ops Bot",
          },
        ],
      }),
    });

    const renderedLines = renderTranscriptBlocks(
      buildHumanTranscriptProjection({
        items: item ? [item] : [],
        membersSnapshot: createMembersSnapshot({
          runtimeCompatibleIds: true,
          agents: [
            {
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              profileName: "Phase 2a Agent",
            },
            {
              profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
              profileName: "Ops Bot",
            },
          ],
        }),
        sessionProfile,
      }).transcriptBlocks,
      100
    ).map(stripAnsi);

    expect(renderedLines.join("\n")).toContain("wake: Phase 2a Agent");
    expect(renderedLines.join("\n")).toContain("reference: Ops Bot");
    expect(renderedLines.join("\n")).toContain(
      "@Phase 2a Agent(wake) @Ops Bot(reference)"
    );
  });

  it("prefers semantic reply previews over raw canonical authoring syntax", () => {
    const sessionProfile = createHumanSessionProfile({
      profileId: FELIX_RUNTIME_PROFILE_ID,
    });
    const source = createSignalEnvelope({
      id: "sig-source-semantic",
      profile: {
        kind: "human",
        profileId: FELIX_RUNTIME_PROFILE_ID,
        profileName: "Felix",
      },
      text: "@Phase 2a Agent(wake) Please help",
      messageEnvelope: {
        text: "@Phase 2a Agent(wake) Please help",
        activationTargets: [AGENT_OPS_RUNTIME_PROFILE_ID],
        referenceTargets: [],
      },
    });
    const reply = buildHumanTranscriptItemFromEvent({
      event: createSignalEnvelope({
        id: "sig-reply-semantic",
        profile: {
          kind: "agent",
          profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
          profileName: "Guest Bot",
        },
        text: "Reply body",
        messageEnvelope: {
          text: "Reply body",
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: "sig-source-semantic",
        },
        replyTo: {
          signalId: "sig-source-semantic",
          profileId: FELIX_RUNTIME_PROFILE_ID,
          profileKind: "human",
          profileName: "Felix",
          previewText: "@Phase 2a Agent(wake) Please help",
        },
      }),
      mentionHighlightIndex: null,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: FELIX_RUNTIME_PROFILE_ID,
      sessionProfileIdentity: sessionProfile,
      signalIndex: new Map([["sig-source-semantic", source]]),
      spaceMembersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
        agents: [
          {
            profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            profileName: "Phase 2a Agent",
          },
        ],
      }),
    });

    const renderedLines = renderTranscriptBlocks(
      buildHumanTranscriptProjection({
        items: reply ? [reply] : [],
        membersSnapshot: createMembersSnapshot({
          runtimeCompatibleIds: true,
          agents: [
            {
              profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
              profileName: "Phase 2a Agent",
            },
          ],
        }),
        sessionProfile,
      }).transcriptBlocks,
      100
    ).map(stripAnsi);

    expect(renderedLines.join("\n")).toContain(
      "reply to Felix · wake: Phase 2a Agent"
    );
    expect(renderedLines.join("\n")).not.toContain(
      "reply to Felix · @Phase 2a Agent(wake) Please help"
    );
  });

  it("removes the leading mention before truncating the reply preview body", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: `profile-id:${AGENT_GUEST_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Guest Bot 20260314 20:10: Reply body\nagent via guest · owner: Other Owner",
            ts: new Date(2026, 2, 14, 20, 10).getTime(),
            replyRef: createReplyRef({
              profileId: "11111111-1111-4111-8111-111111111111",
              profileKind: "human",
              mentionAlias: null,
              profileName: "Felix",
              previewText:
                "@felix-claude-code what is your current working directory",
            }),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    ).map(stripAnsi);

    const replyLine = renderedLines.find((line) => line.includes("reply to"));

    expect(normalizeWhitespace(replyLine ?? "")).toBe(
      "reply to Felix · what is your current working di…"
    );
  });

  it("falls back to reply profile name and hides an empty preview", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260314 20:11: Plain reply",
            ts: new Date(2026, 2, 14, 20, 11).getTime(),
            replyRef: createReplyRef({
              profileId: AGENT_MISSING_RUNTIME_PROFILE_ID,
              profileName: "Legacy Agent Name",
              previewText: "   ",
            }),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    ).map(stripAnsi);

    const replyLine = renderedLines.find((line) =>
      line.includes("reply to Legacy Agent Name")
    );

    expect(normalizeWhitespace(replyLine ?? "")).toBe(
      "reply to Legacy Agent Name"
    );
  });

  it("falls back to the reply profile id when no current or stored name exists", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260314 20:12: Plain reply",
            ts: new Date(2026, 2, 14, 20, 12).getTime(),
            replyRef: createReplyRef({
              profileId: AGENT_UNKNOWN_TARGET_RUNTIME_PROFILE_ID,
              profileName: "",
              previewText: "   ",
            }),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    ).map(stripAnsi);

    const replyLine = renderedLines.find((line) =>
      line.includes(`reply to ${AGENT_UNKNOWN_TARGET_RUNTIME_PROFILE_ID}`)
    );

    expect(normalizeWhitespace(replyLine ?? "")).toBe(
      `reply to ${AGENT_UNKNOWN_TARGET_RUNTIME_PROFILE_ID}`
    );
  });

  it("keeps each reply line on its own coalesced message bubble", () => {
    const projection = buildHumanTranscriptProjection({
      items: [
        {
          groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
          kind: "message",
          line: "- 👤 Felix 20260314 20:12: first reply",
          ts: new Date(2026, 2, 14, 20, 12).getTime(),
          replyRef: createReplyRef({
            signalId: "sig-a",
            profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            profileName: "Ops Bot",
            previewText: "first preview",
          }),
        },
        {
          groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
          kind: "message",
          line: "- 👤 Felix 20260314 20:13: second reply",
          ts: new Date(2026, 2, 14, 20, 13).getTime(),
          replyRef: createReplyRef({
            signalId: "sig-b",
            profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            profileName: "Guest Bot",
            previewText: "second preview",
          }),
        },
      ],
      membersSnapshot: createMembersSnapshot(),
      sessionProfile: createHumanSessionProfile(),
    });

    expect(projection.transcriptBlocks).toEqual([
      expect.objectContaining({
        kind: "plain_text_group",
        messages: [
          expect.objectContaining({
            replyLine: "reply to Ops Bot · first preview",
          }),
          expect.objectContaining({
            replyLine: "reply to Guest Bot · second preview",
          }),
        ],
      }),
    ]);

    const renderedLines = renderTranscriptBlocks(
      projection.transcriptBlocks,
      80
    )
      .map(stripAnsi)
      .map(normalizeWhitespace);

    expect(renderedLines).toContain("reply to Ops Bot · first preview");
    expect(renderedLines).toContain("reply to Guest Bot · second preview");
  });

  it("renders reply lines for signal.status transcript items", () => {
    const sessionProfile = createHumanSessionProfile({
      profileId: OPENMELD_DEV_LOCAL_TEST_PROFILE_ID,
      profileName: "OpenMeld Dev Local Test",
      ownerUserId: "user_openmeld_dev_local_test",
      ownerName: "OpenMeld Dev Local Test",
    });
    const item = buildHumanTranscriptItemFromEvent({
      event: {
        v: 1,
        id: "status-1",
        spaceId: "space-1",
        ts: new Date(2026, 2, 19, 13, 53, 50).getTime(),
        profile: {
          kind: "agent",
          profileId: HI_AGENT_RUNTIME_PROFILE_ID,
          profileName: "hi-agent",
          ownerName: "OpenMeld Dev Local Test",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "sess-hi-1",
        },
        type: "signal.status",
        data: {
          actorProfileId: HI_AGENT_RUNTIME_PROFILE_ID,
          status: "done",
          dispatchId: "dispatch-1",
          text: "I shipped the first pass.",
          generatedBy: "openmeld",
          replyTo: {
            signalId: "sig-66666666-6666-4666-8666-666666666666",
            profileId: OPENMELD_DEV_LOCAL_TEST_PROFILE_ID,
            profileName: "OpenMeld Dev Local Test",
            profileKind: "human",
            previewText: "@hi-agent wake up",
          },
        },
      },
      mentionHighlightIndex: null,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: OPENMELD_DEV_LOCAL_TEST_PROFILE_ID,
      sessionProfileIdentity: sessionProfile,
      spaceMembersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
      }),
    });

    expect(item).not.toBeNull();
    expect(item?.replyRef).toEqual(
      expect.objectContaining({
        signalId: "sig-66666666-6666-4666-8666-666666666666",
        profileId: OPENMELD_DEV_LOCAL_TEST_PROFILE_ID,
        profileName: "OpenMeld Dev Local Test",
        previewText: "@hi-agent wake up",
      })
    );

    const projection = buildHumanTranscriptProjection({
      items: item ? [item] : [],
      membersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
        agents: [
          {
            profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            agentControllerConversationId: null,
          },
        ],
      }),
      sessionProfile,
    });

    expect(projection.transcriptBlocks).toHaveLength(1);
    expect(projection.transcriptBlocks[0]).toMatchObject({
      kind: "plain_text_group",
      messages: [
        expect.objectContaining({
          replyLine: "reply to OpenMeld Dev Local Test",
        }),
      ],
    });

    const renderedLines = renderTranscriptBlocks(
      projection.transcriptBlocks,
      100
    ).map(stripAnsi);
    expect(renderedLines.join("\n")).toContain("status: done");
    expect(renderedLines.join("\n")).toContain(
      "reply to OpenMeld Dev Local Test"
    );
  });

  it("renders OpenMeld system signal.status on the system rail without reply lines", () => {
    const sessionProfile = createHumanSessionProfile({
      profileId: OPENMELD_DEV_LOCAL_TEST_PROFILE_ID,
      profileName: "OpenMeld Dev Local Test",
      ownerUserId: "user_openmeld_dev_local_test",
      ownerName: "OpenMeld Dev Local Test",
    });
    const item = buildHumanTranscriptItemFromEvent({
      event: {
        v: 1,
        id: "system-status-1",
        spaceId: "space-1",
        ts: new Date(2026, 2, 19, 13, 54, 50).getTime(),
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.status",
        data: {
          actorProfileId: HI_AGENT_RUNTIME_PROFILE_ID,
          status: "blocked",
          dispatchId: "dispatch-1",
          text: "Permission denied while finalizing the reply.",
          generatedBy: "openmeld",
          replyTo: {
            signalId: "sig-66666666-6666-4666-8666-666666666666",
            profileId: OPENMELD_DEV_LOCAL_TEST_PROFILE_ID,
            profileName: "OpenMeld Dev Local Test",
            profileKind: "human",
            previewText: "@hi-agent wake up",
          },
        },
      },
      mentionHighlightIndex: null,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: OPENMELD_DEV_LOCAL_TEST_PROFILE_ID,
      sessionProfileIdentity: sessionProfile,
      spaceMembersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
      }),
    });

    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      kind: "system_notice",
    });
    expect(item?.replyRef).toBeUndefined();

    const projection = buildHumanTranscriptProjection({
      items: item ? [item] : [],
      membersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
      }),
      sessionProfile,
    });

    expect(projection.transcriptBlocks).toHaveLength(1);
    expect(projection.transcriptBlocks[0]).toMatchObject({
      kind: "system_group",
      lines: [
        expect.stringContaining(
          "Permission denied while finalizing the reply."
        ),
      ],
    });

    const renderedLines = renderTranscriptBlocks(
      projection.transcriptBlocks,
      100
    ).map(stripAnsi);
    expect(renderedLines.join("\n")).toContain(
      "Permission denied while finalizing the reply."
    );
    expect(renderedLines.join("\n")).not.toContain(
      "reply to OpenMeld Dev Local Test"
    );
  });

  it("renders signal.system_notice on the system rail with reply and actor metadata", () => {
    const sessionProfile = createHumanSessionProfile({
      profileId: FELIX_RUNTIME_PROFILE_ID,
    });
    const item = buildHumanTranscriptItemFromEvent({
      event: {
        v: 1,
        id: "system-notice-1",
        spaceId: "space-1",
        ts: new Date(2026, 2, 19, 13, 53, 50).getTime(),
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
          dispatchId: "dispatch-system-notice-1",
          resultRef: "dispatch-result:dispatch-system-notice-1",
          reason: "Keeping this private.",
          text: "Ops Bot chose to stay silent.",
          generatedBy: "openmeld",
          replyTo: {
            signalId: "sig-66666666-6666-4666-8666-666666666666",
            profileId: FELIX_RUNTIME_PROFILE_ID,
            profileName: "Felix",
            profileKind: "human",
            previewText:
              '@ops-bot wake up\n```openmeld-space-action\n{"type":"stay_silent","reason":"Keeping this private."}\n```',
          },
        },
      },
      mentionHighlightIndex: null,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: FELIX_RUNTIME_PROFILE_ID,
      sessionProfileIdentity: sessionProfile,
      spaceMembersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
      }),
    });

    expect(item).not.toBeNull();
    expect(item?.kind).toBe("system_notice");

    const projection = buildHumanTranscriptProjection({
      items: item ? [item] : [],
      membersSnapshot: createMembersSnapshot({
        runtimeCompatibleIds: true,
      }),
      sessionProfile,
    });

    expect(projection.transcriptBlocks).toHaveLength(1);
    expect(projection.transcriptBlocks[0]).toMatchObject({
      kind: "system_group",
      lines: expect.arrayContaining([
        "* 📣 system: Ops Bot chose to stay silent.",
        "agent reason: Keeping this private.",
        "reply to Felix",
        "agent via codex · owner: Felix · added by: Felix",
      ]),
    });

    const renderedLines = renderTranscriptBlocks(
      projection.transcriptBlocks,
      100
    ).map(stripAnsi);
    expect(renderedLines.join("\n")).toContain(
      "📣 system: Ops Bot chose to stay silent."
    );
    expect(renderedLines.join("\n")).toContain(
      "agent reason: Keeping this private."
    );
    expect(renderedLines.join("\n")).toContain("reply to Felix");
    expect(renderedLines.join("\n")).toContain(
      "agent via codex · owner: Felix · added by: Felix"
    );
    expect(renderedLines.join("\n")).not.toContain("origin:");
  });

  it("does not render origin for non-owner system notices when the actor snapshot is redacted", () => {
    const item = buildHumanTranscriptItemFromEvent({
      event: {
        v: 1,
        id: "system-notice-redacted-1",
        spaceId: "space-1",
        ts: new Date(2026, 2, 19, 14, 0, 0).getTime(),
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
          dispatchId: "dispatch-system-notice-redacted-1",
          reason: "Keeping this private.",
          text: "Guest Bot chose to stay silent.",
          generatedBy: "openmeld",
        },
      },
      mentionHighlightIndex: null,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: "22222222-2222-4222-8222-222222222222",
      sessionProfileIdentity: createHumanSessionProfile(),
      spaceMembersSnapshot: createMembersSnapshot({
        agents: [
          {
            profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            agentControllerConversationId: null,
          },
        ],
      }),
    });

    const projection = buildHumanTranscriptProjection({
      items: item ? [item] : [],
      membersSnapshot: createMembersSnapshot({
        agents: [
          {
            profileId: AGENT_GUEST_RUNTIME_PROFILE_ID,
            agentControllerConversationId: null,
          },
        ],
      }),
      sessionProfile: createHumanSessionProfile(),
    });

    const renderedLines = renderTranscriptBlocks(
      projection.transcriptBlocks,
      100
    ).map(stripAnsi);

    expect(renderedLines.join("\n")).toContain(
      "Guest Bot chose to stay silent."
    );
    expect(renderedLines.join("\n")).toContain(
      "agent reason: Keeping this private."
    );
    expect(renderedLines.join("\n")).not.toContain("origin:");
    expect(renderedLines.join("\n")).not.toContain("ctx_guest");
  });

  it("renders stay_silent system notices without a reason when the public notice omits it", () => {
    const item = buildHumanTranscriptItemFromEvent({
      event: {
        v: 1,
        id: "system-notice-no-reason-1",
        spaceId: "space-1",
        ts: new Date(2026, 2, 19, 14, 1, 0).getTime(),
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: AGENT_OPS_RUNTIME_PROFILE_ID,
          dispatchId: "dispatch-system-notice-no-reason-1",
          text: "Ops Bot chose to stay silent.",
          generatedBy: "openmeld",
        },
      },
      mentionHighlightIndex: null,
      ownerDisplayNameByUserId: new Map(),
      selfProfileId: "11111111-1111-4111-8111-111111111111",
      sessionProfileIdentity: createHumanSessionProfile(),
      spaceMembersSnapshot: createMembersSnapshot(),
    });

    const projection = buildHumanTranscriptProjection({
      items: item ? [item] : [],
      membersSnapshot: createMembersSnapshot(),
      sessionProfile: createHumanSessionProfile(),
    });

    const renderedLines = renderTranscriptBlocks(
      projection.transcriptBlocks,
      100
    ).map(stripAnsi);

    expect(renderedLines.join("\n")).toContain("Ops Bot chose to stay silent.");
    expect(renderedLines.join("\n")).not.toContain("Keeping this private.");
  });

  it("renders profile info on the left, timestamp on the right, and keeps body/meta separated by gaps", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:hum_history",
            kind: "message",
            line: "- 👤 history-debug-human 20260314 16:19: hello-fix-check\nhuman · member · seen 2h ago",
            ts: new Date(2026, 2, 14, 16, 19).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    ).map(stripAnsi);

    const headerLineIndex = renderedLines.findIndex((line) =>
      line.includes("👤 history-debug-human")
    );
    expect(headerLineIndex).toBeGreaterThanOrEqual(0);
    const headerLine = renderedLines[headerLineIndex] ?? "";
    expect(headerLine).toContain("20260314 16:19:00");
    expect(headerLine.indexOf("20260314 16:19:00")).toBeGreaterThan(
      headerLine.indexOf("history-debug-human")
    );
    expect(renderedLines[headerLineIndex + 1]?.trim()).toBe("");
    expect(renderedLines[headerLineIndex + 2]).toContain("hello-fix-check");
    expect(renderedLines[headerLineIndex + 3]?.trim()).toBe("");
    expect(renderedLines[headerLineIndex + 4]).toContain(
      "human · member · seen 2h ago"
    );
  });

  it("renders a centered separator between adjacent message sections from different speakers", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260314 16:19: hello\nhuman · member · seen now",
            ts: new Date(2026, 2, 14, 16, 19).getTime(),
          },
          {
            groupKey: "profile-id:hum_ops",
            kind: "message",
            line: "- 👤 Ops 20260314 16:20: hi\nhuman · member · seen now",
            ts: new Date(2026, 2, 14, 16, 20).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    ).map(stripAnsi);

    const separatorIndex = renderedLines.findIndex(
      (line) => line.trim() === "-"
    );
    const separatorLine =
      separatorIndex >= 0 ? renderedLines[separatorIndex] : undefined;

    expect(separatorLine).toBeDefined();
    expect(separatorLine?.startsWith(" ")).toBe(true);
  });

  it("marks current human, owned agents, and all other messages with the correct highlight kind", () => {
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
          kind: "message",
          line: "- 👤 Felix 20260313 03:04: hello",
          ts: new Date(2026, 2, 14, 15, 40).getTime(),
        },
        {
          groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
          kind: "message",
          line: "- 🤖 Ops Bot 20260313 03:06: owned",
          ts: new Date(2026, 2, 14, 15, 49).getTime(),
        },
        {
          groupKey: `profile-id:${AGENT_GUEST_RUNTIME_PROFILE_ID}`,
          kind: "message",
          line: "- 🤖 Guest Bot 20260313 03:07: guest",
          ts: new Date(2026, 2, 14, 15, 50).getTime(),
        },
        {
          groupKey: "profile-id:hum_amy",
          kind: "message",
          line: "- 👤 Amy 20260313 03:08: other",
          ts: new Date(2026, 2, 14, 15, 51).getTime(),
        },
      ],
      createMembersSnapshot(),
      createHumanSessionProfile()
    );

    expect(blocks[0]).toMatchObject({
      kind: "plain_text_group",
      highlightKind: "self_human",
    });
    expect(blocks[1]).toMatchObject({
      kind: "plain_text_group",
      highlightKind: "owned_agent",
    });
    expect(blocks[2]).toMatchObject({
      kind: "plain_text_group",
      highlightKind: "neutral",
    });
    expect(blocks[3]).toMatchObject({
      kind: "plain_text_group",
      highlightKind: "neutral",
    });
  });

  it("renders all human bubbles with the composer surface while preserving agent surfaces", () => {
    const renderedLines = renderTranscriptBlocks(
      buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260313 03:04: self",
            ts: new Date(2026, 2, 14, 15, 40).getTime(),
          },
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Ops Bot 20260313 03:06: owned",
            ts: new Date(2026, 2, 14, 15, 49).getTime(),
          },
          {
            groupKey: `profile-id:${AGENT_GUEST_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Guest Bot 20260313 03:07: guest",
            ts: new Date(2026, 2, 14, 15, 50).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      ),
      80
    );

    const ownedAgentSurface = resolveAgentSurfaceRgb(
      "Ops Bot",
      {
        agentControllerRef: "builtin:codex",
        profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
        profileName: "Ops Bot",
      },
      {
        spaceMembersSnapshot: createMembersSnapshot(),
      }
    );

    const ownedAgentBackgroundPrefix = `\u001B[48;2;${String(ownedAgentSurface.r)};${String(ownedAgentSurface.g)};${String(ownedAgentSurface.b)}m`;
    const humanBackgroundPrefix = `\u001B[48;2;${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[0])};${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[1])};${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[2])}m`;
    expect(
      renderedLines.some(
        (line) =>
          line.includes("Ops Bot") && line.includes(ownedAgentBackgroundPrefix)
      )
    ).toBe(true);
    expect(
      renderedLines.some(
        (line) => line.includes("Felix") && line.includes(humanBackgroundPrefix)
      )
    ).toBe(true);
    expect(
      renderedLines.some((line) => line.includes("\u001B[48;2;33;33;33m"))
    ).toBe(true);
  });

  it("falls back to ownerName for owned-agent detection only when ownerUserId is missing", () => {
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
          kind: "message",
          line: "- 🤖 Ops Bot 20260313 03:06: fallback",
          ts: new Date(2026, 2, 14, 15, 49).getTime(),
        },
      ],
      createMembersSnapshot({
        agents: [
          {
            profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
            ownerUserId: null,
            ownerName: "Felix Account",
          },
        ],
      }),
      createHumanSessionProfile({
        ownerUserId: null,
        ownerName: "Felix Account",
      })
    );

    expect(blocks[0]).toMatchObject({
      kind: "plain_text_group",
      highlightKind: "owned_agent",
    });
  });

  it("keeps human speaker and owned-agent owner labels plain while system rows stay uncolored", () => {
    const originalColorSupport = pc.isColorSupported;
    Object.defineProperty(pc, "isColorSupported", {
      configurable: true,
      value: true,
    });

    try {
      const blocks = buildTranscriptBlocks(
        [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message",
            line: "- 👤 Felix 20260313 03:04: self",
            ts: new Date(2026, 2, 14, 15, 40).getTime(),
          },
          createPresenceItem({
            ts: new Date(2026, 2, 14, 15, 42).getTime(),
            action: "join",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            mentionAlias: null,
            profileName: "Felix",
          }),
          {
            groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
            kind: "message",
            line: "- 🤖 Ops Bot 20260313 03:06: owned",
            ts: new Date(2026, 2, 14, 15, 49).getTime(),
          },
        ],
        createMembersSnapshot(),
        createHumanSessionProfile()
      );

      const humanBlock = blocks[0];
      const presenceBlock = blocks[1];
      const agentBlock = blocks[2];

      expect(humanBlock?.kind).toBe("plain_text_group");
      expect(presenceBlock?.kind).toBe("presence_trace_group");
      expect(agentBlock?.kind).toBe("plain_text_group");

      if (
        humanBlock?.kind !== "plain_text_group" ||
        presenceBlock?.kind !== "presence_trace_group" ||
        agentBlock?.kind !== "plain_text_group"
      ) {
        return;
      }

      const humanColor = extractTrueColorPrefixForLabel(
        humanBlock.messages[0]?.headerLeading ?? "",
        "Felix"
      );
      const presenceColor = extractTrueColorPrefixForLabel(
        renderTranscriptBlocks([presenceBlock], 80).join("\n"),
        "Felix"
      );
      const ownerColor = extractTrueColorPrefixForLabel(
        agentBlock.messages[0]?.headerLeading ?? "",
        "Felix"
      );

      expect(humanColor).toBeUndefined();
      expect(presenceColor).toBeUndefined();
      expect(ownerColor).toBeUndefined();
    } finally {
      Object.defineProperty(pc, "isColorSupported", {
        configurable: true,
        value: originalColorSupport,
      });
    }
  });

  it("marks the current agent profile as owned_agent", () => {
    const blocks = buildTranscriptBlocks(
      [
        {
          groupKey: `profile-id:${AGENT_OPS_RUNTIME_PROFILE_ID}`,
          kind: "message",
          line: "- 🤖 Ops Bot 20260313 03:06: self",
          ts: new Date(2026, 2, 14, 15, 49).getTime(),
        },
      ],
      createMembersSnapshot(),
      createAgentSessionProfile()
    );

    expect(blocks[0]).toMatchObject({
      kind: "plain_text_group",
      highlightKind: "owned_agent",
    });
  });
});

function createPresenceItem(input: {
  ts: number;
  action: "join" | "left";
  profileId: string;
  profileKind: "human" | "agent";
  mentionAlias?: string | null;
  profileName: string;
}): SpaceTranscriptItem {
  const avatar = input.profileKind === "agent" ? "🤖" : "👤";
  const verb = input.action === "join" ? "joined" : "left";
  return {
    groupKey: "system",
    kind: "presence",
    line: `* 📣 system: ${avatar} ${input.profileName} ${verb} the space.`,
    ts: input.ts,
    presenceAction: input.action,
    actorProfileId: input.profileId,
    actorKind: input.profileKind,
    actorLabel: input.profileName,
    actorAvatar: avatar,
  };
}

function createSignalEnvelope(input: {
  id: string;
  profile: SignalEnvelope["profile"];
  text: string;
  messageEnvelope?: MessageEnvelope;
  replyTo?: SignalTextReplyTo;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 2, 19, 12, 0, 0),
    profile: input.profile,
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.messageEnvelope
        ? { messageEnvelope: input.messageEnvelope }
        : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
  };
}

function createMembersSnapshot(input?: {
  runtimeCompatibleIds?: boolean;
  humans?: Array<
    Partial<SpaceMembersSnapshot["humans"][number]> &
      Pick<SpaceMembersSnapshot["humans"][number], "profileId">
  >;
  agents?: Array<
    Partial<SpaceMembersSnapshot["agents"][number]> &
      Pick<SpaceMembersSnapshot["agents"][number], "profileId">
  >;
}): SpaceMembersSnapshot {
  const now = "2026-03-14T00:00:00.000Z";
  const runtimeCompatibleIds = input?.runtimeCompatibleIds ?? false;
  const felixProfileId = runtimeCompatibleIds
    ? FELIX_RUNTIME_PROFILE_ID
    : "11111111-1111-4111-8111-111111111111";
  const otherProfileId = runtimeCompatibleIds
    ? "22222222-2222-4222-8222-222222222222"
    : "hum_other";
  const opsProfileId = AGENT_OPS_RUNTIME_PROFILE_ID;
  const guestProfileId = AGENT_GUEST_RUNTIME_PROFILE_ID;
  const baseSnapshot = createSpaceMembersSnapshot({
    agents: [
      createSpaceMemberAgentSnapshot({
        addedAt: now,
        addedByDisplayName: "Felix",
        addedByOwnerUserId: null,
        addedByProfileId: felixProfileId,
        agentControllerConversationId: "ctx_ops",
        createdAt: now,
        lastSeenLabel: "seen 2m ago",
        memberSourceLabel: "added by member",
        ownerName: "Felix",
        ownerUserId: "user_felix",
        profileId: opsProfileId,
        profileName: "Ops Bot",
        updatedAt: now,
        wakeabilityReasonText: "route not registered",
        wakeabilityStatus: "blocked",
      }),
      createSpaceMemberAgentSnapshot({
        addedAt: now,
        addedByDisplayName: "Other",
        addedByOwnerUserId: null,
        addedByProfileId: otherProfileId,
        agentControllerConversationId: "ctx_guest",
        agentControllerRef: "builtin:guest",
        createdAt: now,
        lastSeenLabel: "seen 1m ago",
        memberSourceLabel: "added by member",
        ownerName: "Other Owner",
        ownerUserId: "user_other",
        profileId: guestProfileId,
        profileName: "Guest Bot",
        updatedAt: now,
        wakeabilityReasonText: "ready",
      }),
    ],
    generatedAt: now,
    humans: [
      createSpaceMemberHumanSnapshot({
        addedAt: now,
        createdAt: now,
        firstEnteredAt: now,
        lastEnteredAt: now,
        lastSeenAt: now,
        lastSeenLabel: "seen now",
        liveNow: true,
        memberSourceLabel: "space creator",
        ownerName: "Felix",
        ownerUserId: "user_felix",
        profileId: felixProfileId,
        profileName: "Felix",
        updatedAt: now,
      }),
    ],
    spaceId: "ops-room",
  });

  const humans = baseSnapshot.humans.map((human) => {
    const override = input?.humans?.find(
      (candidate) => candidate.profileId === human.profileId
    );
    return override ? { ...human, ...override } : human;
  });
  const agents = baseSnapshot.agents.map((agent) => {
    const override = input?.agents?.find(
      (candidate) => candidate.profileId === agent.profileId
    );
    return override ? { ...agent, ...override } : agent;
  });

  if (!(input?.humans?.length || input?.agents?.length)) {
    return baseSnapshot;
  }

  return {
    ...baseSnapshot,
    humans,
    agents,
    summary: {
      ...baseSnapshot.summary,
      totalCount: humans.length + agents.length,
      humanCount: humans.length,
      agentCount: agents.length,
      liveNowCount:
        humans.filter((human) => human.liveNow).length +
        agents.filter((agent) => agent.liveNow).length,
    },
  };
}

function renderLinesToPlainText(lines: readonly string[]): string {
  return lines.map(stripAnsi).join("\n");
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value);
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function extractTrueColorPrefixForLabel(
  value: string,
  label: string
): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(
    new RegExp(`(\\u001B\\[38;2;\\d+;\\d+;\\d+m)${escapedLabel}`)
  );
  return match?.[1];
}

function createHumanSessionProfile(input?: {
  profileId?: string;
  profileName?: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
}) {
  return {
    openMeldProfileId:
      input?.profileId ?? "11111111-1111-4111-8111-111111111111",
    profileId: input?.profileId ?? "11111111-1111-4111-8111-111111111111",
    profileName: input?.profileName ?? "Felix",
    kind: "human" as const,
    ownerUserId: input?.ownerUserId ?? "user_felix",
    ownerName: input?.ownerName ?? input?.profileName ?? "Felix",
  };
}

function createReplyRef(input?: {
  signalId?: string;
  profileId?: string;
  profileKind?: "human" | "agent" | "system" | null;
  mentionAlias?: string | null;
  profileName?: string;
  previewText?: string;
}) {
  return {
    signalId: input?.signalId ?? "sig-reply",
    profileId: input?.profileId ?? AGENT_OPS_RUNTIME_PROFILE_ID,
    profileKind: input?.profileKind ?? "agent",
    profileName: input?.profileName ?? "Ops Bot",
    previewText: input?.previewText ?? "Earlier preview",
  };
}

function createAgentSessionProfile() {
  return {
    profileId: AGENT_OPS_RUNTIME_PROFILE_ID,
    profileName: "Ops Bot",
    kind: "agent" as const,
    ownerUserId: "user_felix",
    ownerName: "Felix",
  };
}
