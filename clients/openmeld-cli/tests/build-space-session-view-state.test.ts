import { stripVTControlCharacters } from "node:util";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { getCliVersionInfo } from "../src/runtime/cli-version";
import {
  buildHelpPanelBlocks,
  buildLogsPanelBlocks,
  buildMembersPanelBlocks,
  buildSpacePanelBlocks,
} from "../src/space/panel/space-panel-content";
import {
  createInitialSpaceScreenState,
  type SpaceScreenState,
} from "../src/space/state/space-screen-state";
import {
  buildHumanTranscriptProjection,
  buildTranscriptBlocks,
} from "../src/space/transcript/transcript-render";
import type { ComposerActivitySource } from "../src/space/view/build-composer-activity-view-state";
import { buildSpaceSessionViewState } from "../src/space/view/build-space-session-view-state";
import { buildSpaceSummaryViewState } from "../src/space/view/build-space-summary-view-state";
import type { SpaceSessionContext } from "../src/space/view/space-session-view-state";
import { renderOpenMeldLogo } from "../src/ui/brand";
import { colorizeDisplayProfileLabel } from "../src/ui/profile-label-color";

const OPS_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const WATCHER_AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("buildSpaceSessionViewState", () => {
  it("derives canonical visibility from the current surface", () => {
    const preSession = buildSpaceSessionViewState({
      context: createSessionContext({
        surface: "pre-session",
      }),
      screenState: createInitialSpaceScreenState(),
    });
    const activeSession = buildSpaceSessionViewState({
      context: createSessionContext(),
      screenState: createInitialSpaceScreenState(),
    });

    expect(preSession.surface).toBe("pre-session");
    expect(preSession.sessionDocument.visible).toBe(false);
    expect(preSession.transcript.visible).toBe(false);
    expect(preSession.composer.visible).toBe(false);
    expect(preSession.overlay.visible).toBe(false);
    expect(activeSession.surface).toBe("active-session");
    expect(activeSession.sessionDocument.visible).toBe(true);
    expect(activeSession.transcript.visible).toBe(true);
    expect(activeSession.composer.visible).toBe(true);
  });

  it("derives active-session document blocks from shared summary facts and transcript blocks", () => {
    const screenState = {
      ...createInitialSpaceScreenState(),
      connection: {
        ...createInitialSpaceScreenState().connection,
        status: "connected" as const,
      },
      members: {
        refreshError: null,
        snapshot: createMembersSnapshot(),
        updatedAtMs: null,
      },
      status: {
        overlayLine: "* 📣 system · sending: hello",
      },
    };
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      resources: {
        sessionDiagnostics: createSessionDiagnostics(),
      },
      screenState,
    });

    expect(viewState.sessionDocument.blocks).toEqual([
      {
        kind: "session_header",
        productLabel: "OPENMELD • https://openmeld.ai",
        tagline: "Connect with any agents and humans in real time",
        versionLabel: `v ${getCliVersionInfo().version}`,
        logoLines: renderOpenMeldLogo().split("\n"),
        summaryFacts: buildSpaceSummaryViewState({
          context: createSessionContext(),
          membersSnapshot: createMembersSnapshot(),
        }).facts,
        summaryHintText: "type /members to check",
      },
      {
        kind: "transcript",
        blocks: buildTranscriptBlocks(
          screenState.transcript.items,
          screenState.members.snapshot,
          createSessionContext().profile
        ),
      },
    ]);
    expect(viewState.resources.membersSnapshot).toEqual(
      createMembersSnapshot()
    );
    expect(viewState.spaceSummary).toEqual(
      buildSpaceSummaryViewState({
        context: createSessionContext(),
        membersSnapshot: createMembersSnapshot(),
      })
    );
    expect(viewState.resources.sessionDiagnostics).toEqual(
      createSessionDiagnostics()
    );
    expect(viewState.status.overlayLine).toBe("* 📣 system · sending: hello");
    expect(viewState.overlay.panel).toBeNull();
    expect(viewState.composer.basePrompt).toBe("- Felix (human): ");
    expect(stripVTControlCharacters(viewState.composer.helperText)).toBe(
      "connected as Felix · Enter sends · Shift+Enter newline · / commands · @ mentions"
    );
    expect(viewState.composer.helperText).toContain(
      colorizeDisplayProfileLabel({
        label: "Felix",
        profileIdentity: {
          kind: "human",
          ownerUserId: "user_felix",
          ownerName: "Felix",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
        },
        spaceMembersSnapshot: createMembersSnapshot(),
      })
    );
    expect(viewState.composer.placeholderText).toBe("Message the space...");
    expect(viewState.composer.showPlaceholder).toBe(true);
    expect(viewState.composerActivity).toEqual({
      visible: false,
      mode: "idle",
      rows: [],
      overflowCount: 0,
      actors: [],
      leadActor: null,
      elapsedSeconds: null,
      previewText: "",
      hint: null,
      spaceMembersSnapshot: createMembersSnapshot(),
    });
  });

  it("falls back to a compact summary when context or members data is incomplete", () => {
    const baseContext = createSessionContext();
    const viewState = buildSpaceSessionViewState({
      context: {
        ...baseContext,
        session: {
          ...baseContext.session,
          passwordProtected: null,
          spaceId: "short-room",
          spaceName: null,
        },
      },
      screenState: createInitialSpaceScreenState(),
    });

    expect(viewState.sessionDocument.blocks[0]).toEqual({
      kind: "session_header",
      productLabel: "OPENMELD • https://openmeld.ai",
      tagline: "Connect with any agents and humans in real time",
      versionLabel: `v ${getCliVersionInfo().version}`,
      logoLines: renderOpenMeldLogo().split("\n"),
      summaryFacts: buildSpaceSummaryViewState({
        context: {
          ...baseContext,
          session: {
            ...baseContext.session,
            passwordProtected: null,
            spaceId: "short-room",
            spaceName: null,
          },
        },
        membersSnapshot: null,
      }).facts,
      summaryHintText: "type /members to check",
    });
  });

  it("keeps storage summary in the composer footer but not the session summary", () => {
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext({
        session: {
          storageUsedBytes: 2_100_000,
          storageSoftLimitBytes: 9_000_000,
          storageUsagePercent: 24,
        },
      }),
      screenState: {
        ...createInitialSpaceScreenState(),
        members: {
          refreshError: null,
          snapshot: createMembersSnapshot(),
          updatedAtMs: null,
        },
      },
    });

    expect(viewState.spaceSummary.composerFooterSegments).toContainEqual({
      key: "storageUsage",
      text: "2.1 MB ( 24% used )",
    });
    expect(viewState.spaceSummary.sessionSummarySegments).not.toContainEqual({
      key: "storageUsage",
      text: "2.1 MB ( 24% used )",
    });
  });

  it("keeps transcript items and overlay kind aligned with the current screen state", () => {
    const screenState = {
      ...createInitialSpaceScreenState(),
      overlay: {
        kind: "space" as const,
        openedAtMs: null,
        interaction: {
          activeItemId: null,
          query: "",
        },
      },
      transcript: {
        items: [
          {
            groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
            kind: "message" as const,
            line: "- 👤 Felix 20260313 03:04: @ops-bot hey",
            ts: new Date(2026, 2, 14, 15, 40).getTime(),
          },
          {
            groupKey: "system",
            kind: "presence" as const,
            line: "* 📣 system: 👤 Mengyao Li joined the space.",
            ts: new Date(2026, 2, 14, 15, 42).getTime(),
            presenceAction: "join" as const,
            actorProfileId: "hum_mengyao",
            actorKind: "human" as const,
            actorLabel: "Mengyao Li",
            actorAvatar: "👤",
          },
          {
            groupKey: "system",
            kind: "presence" as const,
            line: "* 📣 system: 👤 Mengyao Li left the space.",
            ts: new Date(2026, 2, 14, 15, 44).getTime(),
            presenceAction: "left" as const,
            actorProfileId: "hum_mengyao",
            actorKind: "human" as const,
            actorLabel: "Mengyao Li",
            actorAvatar: "👤",
          },
        ],
      },
    };

    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      resources: {
        sessionDiagnostics: createSessionDiagnostics(),
      },
      screenState,
    });

    expect(viewState.transcript.items).toEqual(screenState.transcript.items);
    expect(viewState.transcript.blocks).toEqual(
      buildHumanTranscriptProjection({
        items: screenState.transcript.items,
        membersSnapshot: screenState.members.snapshot,
        sessionProfile: createSessionContext().profile,
      }).transcriptBlocks
    );
    expect(viewState.transcript.blocks).toContainEqual({
      kind: "presence_first_join_group",
      groupKey: "system",
      actorKey: "hum_mengyao",
      actorProfileId: "hum_mengyao",
      actorKind: "human",
      actorAvatar: "👤",
      actorLabel: "Mengyao Li",
      actorOwnerUserId: undefined,
      actorOwnerName: undefined,
      ts: new Date(2026, 2, 14, 15, 42).getTime(),
    });
    expect(viewState.sessionDocument.blocks[1]).toEqual({
      kind: "transcript",
      blocks: buildHumanTranscriptProjection({
        items: screenState.transcript.items,
        membersSnapshot: screenState.members.snapshot,
        sessionProfile: createSessionContext().profile,
      }).transcriptBlocks,
    });
    expect(viewState.overlay.kind).toBe("space");
    expect(viewState.overlay.panel).toMatchObject({
      contentAlign: "left",
      kind: "space",
      instructions: [
        {
          id: "close",
          keys: ["Esc"],
          label: "close",
        },
      ],
      layout: "centered_modal",
      mode: "readonly",
      surfaceVariant: "dark",
      title: "🛰️ Space Info",
      visible: true,
    });
    expect(
      stripAnsiPanelBlocks(viewState.overlay.panel?.body.blocks ?? [])
    ).toEqual(
      stripAnsiPanelBlocks(
        buildSpacePanelBlocks({
          context: createSessionContext(),
        })
      )
    );
  });

  it("builds the /logs panel from the same derived transcript source as the human view", () => {
    const transcriptItems: SpaceScreenState["transcript"]["items"] = [
      {
        groupKey: "system",
        kind: "presence",
        line: "* 📣 system: 👤 Mengyao Li joined the space.",
        ts: new Date(2026, 2, 14, 15, 42).getTime(),
        presenceAction: "join",
        actorProfileId: "hum_mengyao",
        actorKind: "human",
        actorLabel: "Mengyao Li",
        actorAvatar: "👤",
      },
      {
        groupKey: "system",
        kind: "presence",
        line: "* 📣 system: 👤 Mengyao Li left the space.",
        ts: new Date(2026, 2, 14, 15, 44).getTime(),
        presenceAction: "left",
        actorProfileId: "hum_mengyao",
        actorKind: "human",
        actorLabel: "Mengyao Li",
        actorAvatar: "👤",
      },
      {
        groupKey: "system",
        kind: "membership_notice",
        line: "Felix added 🤖 Ops Bot to this space. · Mention as `@Ops Bot(wake)`",
        ts: new Date(2026, 2, 14, 15, 45).getTime(),
        membershipNotice: {
          action: "member_added",
          actorProfileId: "11111111-1111-4111-8111-111111111111",
          actorKind: "human",
          actorLabel: "Felix",
          targetProfileId: OPS_AGENT_PROFILE_ID,
          targetProfileKind: "agent",
          targetProfileLabel: "Ops Bot",
          mentionLabel: "ops-bot",
          ts: new Date(2026, 2, 14, 15, 45).getTime(),
        },
      },
    ];
    const screenState = {
      ...createInitialSpaceScreenState(),
      overlay: {
        kind: "logs" as const,
        openedAtMs: null,
        interaction: {
          activeItemId: null,
          query: "",
        },
      },
      transcript: {
        items: transcriptItems,
      },
    };
    const projection = buildHumanTranscriptProjection({
      items: screenState.transcript.items,
      membersSnapshot: screenState.members.snapshot,
      sessionProfile: createSessionContext().profile,
    });
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      screenState,
    });

    expect(
      stripAnsiPanelBlocks(viewState.overlay.panel?.body.blocks ?? [])
    ).toEqual(
      stripAnsiPanelBlocks(
        buildLogsPanelBlocks({
          sections: projection.logsSections,
        })
      )
    );
    expect(viewState.overlay.panel?.mode).toBe("searchable_list");
    expect(viewState.overlay.panel?.searchableList?.activeItemId).toBeTruthy();
  });

  it("projects member-added notices into membership trace blocks for the active transcript", () => {
    const firstTs = new Date(2026, 2, 14, 23, 31).getTime();
    const secondTs = new Date(2026, 2, 14, 23, 33).getTime();
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      screenState: {
        ...createInitialSpaceScreenState(),
        members: {
          refreshError: null,
          snapshot: createMembersSnapshot(),
          updatedAtMs: null,
        },
        transcript: {
          items: [
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
                targetProfileId: OPS_AGENT_PROFILE_ID,
                targetProfileKind: "agent",
                targetProfileLabel: "Ops Bot",
                mentionLabel: "ops-bot",
                ts: firstTs,
              },
            },
            {
              groupKey: "system",
              kind: "membership_notice",
              line: "Felix added Watcher to this space.",
              ts: secondTs,
              membershipNotice: {
                action: "member_added",
                actorProfileId: "11111111-1111-4111-8111-111111111111",
                actorKind: "human",
                actorLabel: "Felix",
                targetProfileId: WATCHER_AGENT_PROFILE_ID,
                targetProfileKind: "agent",
                targetProfileLabel: "Watcher",
                mentionLabel: null,
                ts: secondTs,
              },
            },
          ],
        },
      },
    });

    expect(viewState.transcript.blocks).toContainEqual({
      kind: "membership_trace_group",
      groupKey: "system",
      action: "member_added",
      actorKey: "11111111-1111-4111-8111-111111111111",
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      actorKind: "human",
      actorAvatar: "👤",
      actorLabel: "Felix",
      actorOwnerUserId: null,
      actorOwnerName: null,
      spaceMembersSnapshot: createMembersSnapshot(),
      startTs: firstTs,
      endTs: secondTs,
      targets: [
        {
          profileId: OPS_AGENT_PROFILE_ID,
          kind: "agent",
          label: "Ops Bot",
          mentionLabel: "Ops Bot",
          ownerUserId: "user_felix",
          ownerName: "Felix",
        },
        {
          profileId: WATCHER_AGENT_PROFILE_ID,
          kind: "agent",
          label: "Watcher",
          mentionLabel: "Watcher",
          ownerUserId: "user_felix",
          ownerName: "Felix",
        },
      ],
    });
  });

  it("hides the composer placeholder when the buffer already has text", () => {
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      screenState: {
        ...createInitialSpaceScreenState(),
        composer: {
          bufferText: "hello",
        },
      },
    });

    expect(viewState.composer.placeholderText).toBe("Message the space...");
    expect(viewState.composer.showPlaceholder).toBe(false);
    expect(viewState.composer.hasDraft).toBe(true);
  });

  it("passes owner identity through the session context so owned agents stay highlighted", () => {
    const screenState = {
      ...createInitialSpaceScreenState(),
      members: {
        refreshError: null,
        snapshot: createMembersSnapshot(),
        updatedAtMs: null,
      },
      transcript: {
        items: [
          {
            groupKey: `profile-id:${OPS_AGENT_PROFILE_ID}`,
            kind: "message" as const,
            line: "- 🤖 Ops Bot 20260313 03:06: owned",
            ts: new Date(2026, 2, 14, 15, 49).getTime(),
          },
        ],
      },
    } satisfies SpaceScreenState;

    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      screenState,
    });

    expect(viewState.context.profile.ownerUserId).toBe("user_felix");
    expect(viewState.context.profile.ownerName).toBe("Felix");
    expect(viewState.transcript.blocks).toContainEqual(
      expect.objectContaining({
        kind: "plain_text_group",
        highlightKind: "owned_agent",
      })
    );
  });

  it("derives structured composer activity from dispatch rows", () => {
    const composerActivity: ComposerActivitySource = {
      nowMs: 10_000,
      rows: [
        {
          rowId: "dispatch:dispatch-claude",
          dispatchId: "dispatch-claude",
          sourceEventId: null,
          sourceClientMessageId: null,
          targetProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          targetMentionLabel: null,
          targetLabel: "oh-my-claude",
          stage: "replying",
          createdAtMs: 5000,
          updatedAtMs: 8000,
          latestPreviewText: "Working on it",
          latestPreviewUpdatedAtMs: 8000,
          expiresAtMs: 100_000,
          statusText: "",
          warningText: "",
        },
        {
          rowId: "dispatch:dispatch-codex",
          dispatchId: "dispatch-codex",
          sourceEventId: null,
          sourceClientMessageId: null,
          targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          targetMentionLabel: null,
          targetLabel: "hi-agent",
          stage: "replying",
          createdAtMs: 6000,
          updatedAtMs: 7000,
          latestPreviewText: "",
          latestPreviewUpdatedAtMs: null,
          expiresAtMs: 100_000,
          statusText: "",
          warningText: "",
        },
      ],
    };
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      resources: {
        composerActivity,
        sessionDiagnostics: createSessionDiagnostics(),
      },
      screenState: createInitialSpaceScreenState(),
    });

    expect(viewState.composerActivity.visible).toBe(true);
    expect(viewState.composerActivity.mode).toBe("streaming");
    expect(viewState.composerActivity.leadActor?.label).toBe("oh-my-claude");
    expect(
      viewState.composerActivity.rows.map((row) => row.leadActor?.label)
    ).toEqual(["hi-agent", "oh-my-claude"]);
    expect(viewState.composerActivity.elapsedSeconds).toBe(5);
    expect(viewState.composerActivity.previewText).toBe("Working on it");
  });

  it("builds the members panel from the original Space Members card body without the outer frame", () => {
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      resources: {
        sessionDiagnostics: createSessionDiagnostics(),
      },
      screenState: {
        ...createInitialSpaceScreenState(),
        members: {
          refreshError: null,
          snapshot: createMembersSnapshot(),
          updatedAtMs: new Date(2026, 2, 14, 22, 25).getTime(),
        },
        overlay: {
          kind: "members",
          openedAtMs: new Date(2026, 2, 14, 22, 25).getTime(),
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      },
    });

    expect(viewState.overlay.panel).toMatchObject({
      contentAlign: "left",
      kind: "members",
      instructions: [
        {
          id: "close",
          keys: ["Esc"],
          label: "close",
        },
      ],
      layout: "centered_modal",
      mode: "searchable_list",
      surfaceVariant: "dark",
      title: "👥 Space Members",
      visible: true,
      headerMetaText: "UpdatedAt 20260314 22:25",
    });
    expect(viewState.overlay.panel?.searchableList?.control.query).toBe("");
    expect(
      stripAnsiPanelBlocks(viewState.overlay.panel?.body.blocks ?? [])
    ).toEqual(
      stripAnsiPanelBlocks(
        buildMembersPanelBlocks({
          refreshError: null,
          snapshot: createMembersSnapshot(),
        })
      )
    );
  });

  it("shows a simple members failure message when no snapshot is available", () => {
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      resources: {
        sessionDiagnostics: createSessionDiagnostics(),
      },
      screenState: {
        ...createInitialSpaceScreenState(),
        members: {
          refreshError: "fetch failed",
          snapshot: null,
          updatedAtMs: null,
        },
        overlay: {
          kind: "members",
          openedAtMs: new Date(2026, 2, 14, 22, 25).getTime(),
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      },
    });

    expect(
      stripAnsiPanelBlocks(viewState.overlay.panel?.body.blocks ?? [])
    ).toEqual(
      stripAnsiPanelBlocks(
        buildMembersPanelBlocks({
          refreshError: "fetch failed",
          snapshot: null,
        })
      )
    );
  });

  it("updates help descriptions to reflect the new members and status semantics", () => {
    const viewState = buildSpaceSessionViewState({
      context: createSessionContext(),
      resources: {
        sessionDiagnostics: createSessionDiagnostics(),
      },
      screenState: {
        ...createInitialSpaceScreenState(),
        overlay: {
          kind: "help",
          openedAtMs: null,
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      },
    });

    expect(viewState.overlay.panel).toMatchObject({
      contentAlign: "left",
      surfaceVariant: "dark",
      title: "Space Commands",
    });
    expect(
      stripAnsiPanelBlocks(viewState.overlay.panel?.body.blocks ?? [])
    ).toEqual(stripAnsiPanelBlocks(buildHelpPanelBlocks()));
    expect(
      flattenPanelBlockLines(viewState.overlay.panel?.body.blocks ?? [])
    ).toContain("/space  Show current Space info");
    expect(
      flattenPanelBlockLines(viewState.overlay.panel?.body.blocks ?? [])
    ).toContain("/members  Show current Space members");
    expect(
      flattenPanelBlockLines(viewState.overlay.panel?.body.blocks ?? [])
    ).toContain("/logs  Show current Space logs");
    expect(
      flattenPanelBlockLines(viewState.overlay.panel?.body.blocks ?? []).join(
        "\n"
      )
    ).not.toContain("/cancel");
  });
});

function createSessionContext(
  overrides?: Omit<Partial<SpaceSessionContext>, "profile" | "session"> & {
    profile?: Partial<SpaceSessionContext["profile"]>;
    session?: Partial<SpaceSessionContext["session"]>;
  }
): SpaceSessionContext {
  const {
    profile: profileOverrides,
    session: sessionOverrides,
    ...rest
  } = overrides ?? {};

  return {
    surface: "active-session",
    connectionMode: "join",
    gatewayUrl: "http://localhost:8080",
    profile: {
      kind: "human",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Felix",
      ownerUserId: "user_felix",
      ownerName: "Felix",
      ...profileOverrides,
    },
    session: {
      spaceCreatedAt: "2026-03-13T00:00:00.000Z",
      spaceCreatorId: "11111111-1111-4111-8111-111111111111",
      spaceCreatorName: "Felix",
      passwordProtected: false,
      spaceId:
        "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
      spaceName: "Ops Room",
      ...sessionOverrides,
    },
    ...rest,
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
        profileId: OPS_AGENT_PROFILE_ID,
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
        profileId: WATCHER_AGENT_PROFILE_ID,
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

function createSessionDiagnostics() {
  return {
    openMeldServiceLabel: "running",
    canWakeLocalAgentsLabel: "likely available",
  };
}

function flattenPanelBlockLines(
  blocks: readonly {
    kind: "facts" | "lines";
    items?: readonly {
      label: string;
      value: string;
      span: "full" | "column";
    }[];
    lines?: readonly string[];
  }[]
): string[] {
  return blocks.flatMap((block) => {
    if (block.kind === "lines") {
      return [...(block.lines ?? [])];
    }
    return (block.items ?? []).map(
      (item) => `${item.label}|${item.value}|${item.span}`
    );
  });
}

function stripAnsiPanelBlocks(
  blocks: readonly {
    kind: "facts" | "lines";
    items?: readonly {
      label: string;
      value: string;
      span: "full" | "column";
    }[];
    lines?: readonly string[];
  }[]
): string[] {
  return flattenPanelBlockLines(blocks).map(stripAnsi);
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value);
}
