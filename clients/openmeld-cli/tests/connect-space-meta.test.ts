import {
  createSpaceMemberAgentSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  applyDispatchActivityEventToStatusMap,
  clearDispatchActivitiesForSignal,
} from "../src/space/connect-dispatch-activity";
import {
  buildSpaceCursorPatch,
  resolveSessionMentionAlias,
  resolveSessionMeta,
  resolveSessionRoleContext,
} from "../src/space/connect-session-meta";
import { toSpaceMetaUpsertInput } from "../src/space/space-meta-upsert-input";
import { resolveEnrichedTextRenderEvent } from "../src/space/transcript/transcript-owner-enrichment";

type DispatchRowMap = Parameters<
  typeof clearDispatchActivitiesForSignal
>[0]["rowsById"];

type SpaceMetaInput = Parameters<typeof toSpaceMetaUpsertInput>[0];

const createRemoteSpaceMeta = (
  input: Partial<SpaceMetaInput> = {}
): SpaceMetaInput => ({
  spaceId: "room-1",
  organizationId: "org-1",
  visibility: "private",
  ...input,
});

describe("connect space meta handling", () => {
  it("does not clear local fields when remote meta omits them", () => {
    expect(toSpaceMetaUpsertInput(createRemoteSpaceMeta())).toEqual({});
  });

  it("maps remote fields when present", () => {
    expect(
      toSpaceMetaUpsertInput(
        createRemoteSpaceMeta({
          name: "starship-01",
          createdAt: "2026-02-13T20:12:00.000Z",
          updatedAt: "2026-02-13T20:13:00.000Z",
          guide: "stay concise",
        })
      )
    ).toEqual({
      name: "starship-01",
      spaceCreatedAt: "2026-02-13T20:12:00.000Z",
      spaceUpdatedAt: "2026-02-13T20:13:00.000Z",
      guide: "stay concise",
    });
  });

  it("falls back to local name when remote name is missing", () => {
    expect(
      resolveSessionMeta("room-1", createRemoteSpaceMeta(), "starship-01")
    ).toEqual({
      spaceId: "room-1",
      spaceName: "starship-01",
    });
  });

  it("prefers remote name over local fallback", () => {
    expect(
      resolveSessionMeta(
        "room-1",
        createRemoteSpaceMeta({
          name: "nebula",
        }),
        "starship-01"
      )
    ).toEqual({
      spaceId: "room-1",
      spaceName: "nebula",
    });
  });

  it("prefers remote createdAt and falls back to local value when missing", () => {
    expect(
      resolveSessionMeta(
        "room-1",
        createRemoteSpaceMeta({
          createdAt: "2026-02-13T20:12:00.000Z",
        }),
        "nebula",
        "2026-02-12T10:00:00.000Z"
      )
    ).toEqual({
      spaceId: "room-1",
      spaceName: "nebula",
      spaceCreatedAt: "2026-02-13T20:12:00.000Z",
    });

    expect(
      resolveSessionMeta(
        "room-1",
        createRemoteSpaceMeta(),
        "nebula",
        "2026-02-12T10:00:00.000Z"
      )
    ).toEqual({
      spaceId: "room-1",
      spaceName: "nebula",
      spaceCreatedAt: "2026-02-12T10:00:00.000Z",
    });
  });

  it("extracts creator profile name and id from remote meta", () => {
    expect(
      resolveSessionMeta(
        "room-1",
        createRemoteSpaceMeta({
          creator: {
            profileId: "hum_creator_01",
            profileName: "Felix",
          },
        })
      )
    ).toEqual({
      spaceId: "room-1",
      spaceCreatorName: "Felix",
      spaceCreatorId: "hum_creator_01",
    });
  });

  it("maps storage usage from remote meta when present", () => {
    expect(
      resolveSessionMeta(
        "room-1",
        createRemoteSpaceMeta({
          storageUsage: {
            usedBytes: 2_100_000,
            softLimitBytes: 9_000_000,
            usagePercent: 23.6,
          },
        })
      )
    ).toEqual({
      spaceId: "room-1",
      storageUsedBytes: 2_100_000,
      storageSoftLimitBytes: 9_000_000,
      storageUsagePercent: 23.6,
    });
  });

  it("fills a missing ownerName from the current session identity for self events", () => {
    const result = resolveEnrichedTextRenderEvent({
      event: {
        v: 1,
        id: "evt-self-owner",
        ts: 1,
        spaceId: "room-1",
        profile: {
          kind: "human",
          profileId: "hum-self",
          profileName: "workspace-felix",
          owner: "user-1",
        },
        type: "signal.text",
        data: {
          text: "hello",
        },
      },
      sessionProfileIdentity: {
        kind: "human",
        openMeldProfileId: "hum-self",
        ownerUserId: "user-1",
        ownerName: "Felix",
      },
      ownerDisplayNameByUserId: new Map(),
      spaceMembersSnapshot: null,
    });

    expect(result).toMatchObject({
      profile: {
        ownerUserId: "user-1",
        ownerName: "Felix",
      },
    });
  });

  it("fills a missing ownerName from the matching space members snapshot", () => {
    const ownerDisplayNameByUserId = new Map<string, string>();

    const result = resolveEnrichedTextRenderEvent({
      event: {
        v: 1,
        id: "evt-agent-owner",
        ts: 2,
        spaceId: "room-1",
        profile: {
          kind: "agent",
          profileId: "agt-target",
          profileName: "owner-bot",
          owner: "user-1",
        },
        type: "signal.text",
        data: {
          text: "hello",
        },
      },
      sessionProfileIdentity: {
        kind: "human",
        openMeldProfileId: "hum-self",
      },
      ownerDisplayNameByUserId,
      spaceMembersSnapshot: createOwnerLookupSnapshot("Felix"),
    });

    expect(result).toMatchObject({
      profile: {
        ownerUserId: "user-1",
        ownerName: "Felix",
      },
    });
    expect(ownerDisplayNameByUserId.get("user-1")).toBe("Felix");
  });

  it("keeps the current ownerName when the event already carries one", () => {
    const event: Parameters<typeof resolveEnrichedTextRenderEvent>[0]["event"] =
      {
        v: 1,
        id: "evt-owner-present",
        ts: 3,
        spaceId: "room-1",
        profile: {
          kind: "agent",
          profileId: "agt-target",
          profileName: "owner-bot",
          owner: "user-1",
          ownerName: "Felix Owner",
        },
        type: "signal.text",
        data: {
          text: "hello",
        },
      };

    const result = resolveEnrichedTextRenderEvent({
      event,
      sessionProfileIdentity: {
        kind: "human",
        openMeldProfileId: "hum-self",
        ownerUserId: "user-1",
        ownerName: "Felix Account",
      },
      ownerDisplayNameByUserId: new Map([["user-1", "Felix Account"]]),
      spaceMembersSnapshot: createOwnerLookupSnapshot("Felix Snapshot"),
    });

    expect(result).toBe(event);
  });

  it("prefers an explicit role over local and cloud values", () => {
    expect(
      resolveSessionRoleContext({
        inputRole: "Spaceship Engineer",
        localRole: "Code Reviewer",
        cloudRole: "Architect",
      })
    ).toEqual({
      role: "Spaceship Engineer",
    });
  });

  it("falls back to a cloud role when local values are missing", () => {
    expect(
      resolveSessionRoleContext({
        cloudRole: "Technical Support",
      })
    ).toEqual({
      role: "Technical Support",
    });
  });

  it("builds role-only cursor patch without synthetic lastSeenTs", () => {
    expect(
      buildSpaceCursorPatch({
        lastSeenTs: null,
        shouldSyncRole: true,
        shouldSyncMentionAlias: false,
        role: "Incident Triage Bot",
      })
    ).toEqual({
      role: "Incident Triage Bot",
    });
  });

  it("includes lastSeenTs only when it exists", () => {
    expect(
      buildSpaceCursorPatch({
        lastSeenTs: 123,
        shouldSyncRole: false,
        shouldSyncMentionAlias: false,
      })
    ).toEqual({
      lastSeenTs: 123,
    });
  });

  it("prefers explicit mentionAlias over cloud/local values", () => {
    expect(
      resolveSessionMentionAlias({
        inputMentionAlias: "ops-bot",
        cloudMentionAlias: "cloud-bot",
        localMentionAlias: "local-bot",
      })
    ).toBe("ops-bot");
  });

  it("ignores legacy auto-generated cloud mentionAlias when profile identity is known", () => {
    expect(
      resolveSessionMentionAlias({
        cloudMentionAlias: "claude-code-aaaaaaaa",
        profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
        profileName: "Claude Code",
        profileKind: "agent",
      })
    ).toBeUndefined();
  });

  it("keeps explicit mentionAlias even when it matches a legacy auto-generated pattern", () => {
    expect(
      resolveSessionMentionAlias({
        inputMentionAlias: "claude-code-aaaaaaaa",
        cloudMentionAlias: "claude-code-aaaaaaaa",
        profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
        profileName: "Claude Code",
        profileKind: "agent",
      })
    ).toBe("claude-code-aaaaaaaa");
  });

  it("keeps replying status when non-target profile sends a normal message", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-a",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-a",
          dispatchId: "dispatch-a",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
    ]);

    const statusChanged = clearDispatchActivitiesForSignal({
      rowsById,
      event: {
        v: 1,
        id: "evt-self",
        ts: 11,
        spaceId: "room-1",
        profile: {
          kind: "human",
          profileId: "hum-self",
          profileName: "felix",
        },
        type: "signal.text",
        data: {
          text: "@other-agent what is the date",
        },
      },
    });

    expect(statusChanged).toBe(false);
    expect(rowsById.size).toBe(1);
  });

  it("clears replying status when target profile sends a normal message", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-a",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-a",
          dispatchId: "dispatch-a",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
      [
        "dispatch:dispatch-b",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-b",
          dispatchId: "dispatch-b",
          targetProfileId: "agt-other",
          targetLabel: "@other",
          updatedAtMs: 20,
          expiresAtMs: 200,
          statusText: "@other is replying...",
        }),
      ],
    ]);

    const statusChanged = clearDispatchActivitiesForSignal({
      rowsById,
      event: {
        v: 1,
        id: "evt-target",
        ts: 21,
        spaceId: "room-1",
        profile: {
          kind: "agent",
          profileId: "agt-target",
          profileName: "my-codex",
        },
        type: "signal.text",
        data: {
          text: "I am here.",
        },
      },
    });

    expect(statusChanged).toBe(true);
    expect(rowsById.size).toBe(1);
    expect(rowsById.has("dispatch:dispatch-a")).toBe(false);
    expect(rowsById.has("dispatch:dispatch-b")).toBe(true);
  });

  it("clears replying status by dispatchId when event carries dispatchId meta", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-a",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-a",
          dispatchId: "dispatch-a",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
    ]);

    const statusChanged = clearDispatchActivitiesForSignal({
      rowsById,
      event: {
        v: 1,
        id: "evt-target",
        ts: 21,
        spaceId: "room-1",
        profile: {
          kind: "human",
          profileId: "hum-self",
          profileName: "Felix",
        },
        type: "signal.text",
        data: {
          text: "I am here.",
          meta: {
            dispatchId: "dispatch-a",
          },
        },
      },
    });

    expect(statusChanged).toBe(true);
    expect(rowsById.size).toBe(0);
  });

  it("falls back to clearing only the latest target profile status when dispatchId is missing", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-a",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-a",
          dispatchId: "dispatch-a",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
      [
        "dispatch:dispatch-b",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-b",
          dispatchId: "dispatch-b",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 20,
          expiresAtMs: 200,
          statusText: "@target is also replying...",
        }),
      ],
    ]);

    const statusChanged = clearDispatchActivitiesForSignal({
      rowsById,
      event: {
        v: 1,
        id: "evt-target",
        ts: 21,
        spaceId: "room-1",
        profile: {
          kind: "agent",
          profileId: "agt-target",
          profileName: "my-codex",
        },
        type: "signal.text",
        data: {
          text: "I am here.",
          meta: {},
        },
      },
    });

    expect(statusChanged).toBe(true);
    expect(rowsById.size).toBe(1);
    expect(rowsById.has("dispatch:dispatch-a")).toBe(true);
    expect(rowsById.has("dispatch:dispatch-b")).toBe(false);
  });

  it("clears replying status when a terminal signal.status arrives", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-status-1",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-status-1",
          dispatchId: "dispatch-status-1",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
    ]);

    const statusChanged = clearDispatchActivitiesForSignal({
      rowsById,
      event: {
        v: 1,
        id: "evt-status",
        ts: 21,
        spaceId: "room-1",
        profile: {
          kind: "agent",
          profileId: "agt-target",
          profileName: "Target",
        },
        type: "signal.status",
        data: {
          actorProfileId: "agt-target",
          dispatchId: "dispatch-status-1",
          generatedBy: "openmeld",
          status: "done",
          text: "Done.",
        },
      },
    });

    expect(statusChanged).toBe(true);
    expect(rowsById.size).toBe(0);
  });

  it("clears replying status when a terminal signal.system_notice arrives", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-notice-1",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-notice-1",
          dispatchId: "dispatch-notice-1",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
    ]);

    const statusChanged = clearDispatchActivitiesForSignal({
      rowsById,
      event: {
        v: 1,
        id: "evt-notice",
        ts: 21,
        spaceId: "room-1",
        profile: {
          kind: "system",
          profileId: "system",
          profileName: "system",
        },
        type: "signal.system_notice",
        data: {
          actorProfileId: "agt-target",
          actorName: "target",
          dispatchId: "dispatch-notice-1",
          generatedBy: "openmeld",
          noticeType: "stay_silent",
          text: "target chose to stay silent: private",
        },
      },
    });

    expect(statusChanged).toBe(true);
    expect(rowsById.size).toBe(0);
  });

  it("keeps a replying actor available for composer activity when a continuity warning arrives", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-a",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-a",
          dispatchId: "dispatch-a",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
    ]);

    const changed = applyDispatchActivityEventToStatusMap({
      rowsById,
      event: {
        v: 1,
        id: "evt-warning",
        ts: 11,
        spaceId: "room-1",
        profile: {
          kind: "agent",
          profileId: "agt-target",
          profileName: "target-agent",
        },
        type: "signal.text",
        data: {
          text: "Target context may be stale.",
          meta: {
            transient: true,
            purpose: "conversation_continuity_warning",
            status: "info",
            dispatchId: "dispatch-a",
            targetProfileId: "agt-target",
            targetProfileName: "@target",
          },
        },
      } as Parameters<typeof applyDispatchActivityEventToStatusMap>[0]["event"],
      nowMs: 11,
    });

    expect(changed).toBe(true);
    expect(rowsById.get("dispatch:dispatch-a")).toMatchObject({
      stage: "replying",
      warningText: "Target context may be stale.",
      statusText: "Target context may be stale.",
      targetProfileId: "agt-target",
      targetLabel: "@target",
    });
  });

  it("creates a dispatching activity from a dispatch activity transient signal", () => {
    const rowsById: DispatchRowMap = new Map();

    const changed = applyDispatchActivityEventToStatusMap({
      rowsById,
      event: {
        v: 1,
        id: "evt-dispatching",
        ts: 11,
        spaceId: "room-1",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: "Dispatching to @target...",
          meta: {
            transient: true,
            purpose: "dispatch_activity_dispatching",
            dispatchId: "dispatch-dispatching",
            targetProfileId: "agt-target",
            targetProfileName: "target",
          },
        },
      } as Parameters<typeof applyDispatchActivityEventToStatusMap>[0]["event"],
      nowMs: 11,
    });

    expect(changed).toBe(true);
    expect(rowsById.get("dispatch:dispatch-dispatching")).toMatchObject({
      stage: "dispatching",
      targetProfileId: "agt-target",
      targetLabel: "target",
      statusText: "Dispatching to @target...",
      warningText: "",
    });
  });

  it("ignores malformed dispatch activity signals that omit dispatchId", () => {
    const existingRow = {
      rowId: "legacy:no-dispatch",
      dispatchId: null,
      sourceEventId: null,
      sourceClientMessageId: null,
      sourceTextSnapshot: null,
      targetProfileId: "agt-target",
      targetMentionLabel: null,
      targetLabel: "legacy-target",
      stage: "dispatching" as const,
      createdAtMs: 5,
      updatedAtMs: 5,
      expiresAtMs: null,
      latestPreviewText: "",
      latestPreviewUpdatedAtMs: null,
      statusText: "Legacy dispatching row",
      warningText: "",
    };
    const rowsById: DispatchRowMap = new Map([
      [existingRow.rowId, existingRow],
    ]);

    const changed = applyDispatchActivityEventToStatusMap({
      rowsById,
      event: {
        v: 1,
        id: "evt-dispatching-missing-id",
        ts: 11,
        spaceId: "room-1",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: "Dispatching to @target...",
          meta: {
            transient: true,
            purpose: "dispatch_activity_dispatching",
            targetProfileId: "agt-target",
            targetProfileName: "target",
          },
        },
      } as Parameters<typeof applyDispatchActivityEventToStatusMap>[0]["event"],
      nowMs: 11,
    });

    expect(changed).toBe(false);
    expect(rowsById.size).toBe(1);
    expect(rowsById.get(existingRow.rowId)).toEqual(existingRow);
  });

  it("replaces the active status with a warning when a dispatch fails terminally", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-a",
        createReplyingStatusState({
          rowId: "dispatch:dispatch-a",
          dispatchId: "dispatch-a",
          targetProfileId: "agt-target",
          targetLabel: "@target",
          updatedAtMs: 10,
          expiresAtMs: 100,
          statusText: "@target is replying...",
        }),
      ],
    ]);

    const changed = applyDispatchActivityEventToStatusMap({
      rowsById,
      event: {
        v: 1,
        id: "evt-warning-terminal",
        ts: 12,
        spaceId: "room-1",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: "Couldn't route @target right now",
          meta: {
            transient: true,
            purpose: "dispatch_activity_failed",
            dispatchId: "dispatch-a",
            targetProfileId: "agt-target",
            targetProfileName: "target",
          },
        },
      } as Parameters<typeof applyDispatchActivityEventToStatusMap>[0]["event"],
      nowMs: 12,
    });

    expect(changed).toBe(true);
    expect(rowsById.get("dispatch:dispatch-a")).toMatchObject({
      stage: "warning",
      targetProfileId: "agt-target",
      targetLabel: "target",
      warningText: "Couldn't route @target right now",
      statusText: "Couldn't route @target right now",
    });
  });

  it("creates a replying status from a preview hint without a prior start event", () => {
    const rowsById: DispatchRowMap = new Map();

    const changed = applyDispatchActivityEventToStatusMap({
      rowsById,
      event: {
        v: 1,
        id: "evt-preview",
        ts: 11,
        spaceId: "room-1",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: "This is a preview text\nthat keeps growing.",
          meta: {
            transient: true,
            purpose: "agent_reply_preview",
            dispatchId: "dispatch-preview",
            targetProfileId: "agt-target",
            targetProfileName: "Hey Bot",
          },
        },
      } as Parameters<typeof applyDispatchActivityEventToStatusMap>[0]["event"],
      nowMs: 11,
    });

    expect(changed).toBe(true);
    expect(rowsById.get("dispatch:dispatch-preview")).toMatchObject({
      stage: "replying",
      targetProfileId: "agt-target",
      targetLabel: "Hey Bot",
      latestPreviewText: "This is a preview text that keeps growing.",
      latestPreviewUpdatedAtMs: 11,
      warningText: "",
    });
  });

  it("clears only the preview text when a preview-end hint arrives", () => {
    const rowsById: DispatchRowMap = new Map([
      [
        "dispatch:dispatch-preview",
        {
          ...createReplyingStatusState({
            rowId: "dispatch:dispatch-preview",
            dispatchId: "dispatch-preview",
            targetProfileId: "agt-target",
            targetLabel: "Hey Bot",
            updatedAtMs: 10,
            expiresAtMs: 100,
            statusText: "",
          }),
          latestPreviewText: "Partial preview",
          latestPreviewUpdatedAtMs: 10,
        },
      ],
    ]);

    const changed = applyDispatchActivityEventToStatusMap({
      rowsById,
      event: {
        v: 1,
        id: "evt-preview-end",
        ts: 12,
        spaceId: "room-1",
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: "preview ended",
          meta: {
            transient: true,
            purpose: "agent_reply_preview_end",
            dispatchId: "dispatch-preview",
            targetProfileId: "agt-target",
            targetProfileName: "Hey Bot",
          },
        },
      } as Parameters<typeof applyDispatchActivityEventToStatusMap>[0]["event"],
      nowMs: 12,
    });

    expect(changed).toBe(true);
    expect(rowsById.get("dispatch:dispatch-preview")).toMatchObject({
      stage: "replying",
      targetProfileId: "agt-target",
      targetLabel: "Hey Bot",
      latestPreviewText: "",
      latestPreviewUpdatedAtMs: null,
      warningText: "",
    });
  });
});

function createReplyingStatusState(input: {
  rowId: string;
  dispatchId: string;
  targetProfileId: string;
  targetLabel: string;
  updatedAtMs: number;
  expiresAtMs: number;
  statusText: string;
}): DispatchRowMap extends Map<string, infer TValue> ? TValue : never {
  return {
    rowId: input.rowId,
    dispatchId: input.dispatchId,
    sourceEventId: null,
    sourceClientMessageId: null,
    targetProfileId: input.targetProfileId,
    targetMentionLabel: null,
    targetLabel: input.targetLabel,
    stage: "replying",
    createdAtMs: input.updatedAtMs,
    updatedAtMs: input.updatedAtMs,
    expiresAtMs: input.expiresAtMs,
    latestPreviewText: "",
    latestPreviewUpdatedAtMs: null,
    statusText: input.statusText,
    warningText: "",
  };
}

function createOwnerLookupSnapshot(ownerName: string): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: [
      createSpaceMemberAgentSnapshot({
        addedAt: "2026-03-15T00:00:00.000Z",
        addedByDisplayName: "Felix",
        addedByOwnerUserId: "user-1",
        addedByProfileId: "hum-self",
        agentControllerRef: "builtin:owner-bot",
        createdAt: "2026-03-15T00:00:00.000Z",
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: "2026-03-15T00:00:00.000Z",
        lastSeenLabel: "Seen now",
        ownerName,
        ownerUserId: "user-1",
        profileId: "agt-target",
        profileName: "owner-bot",
        updatedAt: "2026-03-15T00:00:00.000Z",
      }),
    ],
    generatedAt: "2026-03-15T00:00:00.000Z",
    humans: [],
    spaceId: "room-1",
  });
}
