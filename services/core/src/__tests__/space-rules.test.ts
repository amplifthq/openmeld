import { MENTION_DISPATCH_ERROR_CODES } from "@openmeld/schemas";
import type { OpenMeldDaemonMentionDispatchResultPayload } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { SpaceMemberRecord } from "../space/infrastructure/sql/space-member-repo";
import { authorizeSpaceDeletion } from "../space/rules/access/space-deletion-policy";
import { authorizeSpaceMemberRemoval } from "../space/rules/access/space-member-management-policy";
import {
  applyDirectMessageDispatchPromptContext,
  buildDirectMessageDispatchReadyDecisions,
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
} from "../space/rules/dispatch/direct-message-dispatch";
import {
  buildMentionFailureHintText,
  isSpaceHistoryEligibleMentionFailureDecision,
  resolveDispatchPlannerDecisionsForSignal,
  stripDispatchTargetMentionsFromText,
} from "../space/rules/mention/mention-dispatch-rules";
import { shouldEmitRetentionWarning } from "../space/rules/policy/retention-warning-policy";

const NOW_ISO = "2026-03-04T00:00:00.000Z";
const LEGACY_OPENMELD_WELCOMING_SPACE_PURPOSE = "openmeld_welcoming_space";

const createContext = (input: {
  profileId: string;
  profileKind: "human" | "agent";
  ownerUserId?: string;
}) => ({
  actorContext: {
    requestId: "req-test",
    openMeldProfileId: input.profileId,
    profileKind: input.profileKind,
    ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
  },
});

const createMeta = (creator: {
  kind: "human" | "agent";
  profileId: string;
  ownerUserId?: string;
}) => ({
  v: 1 as const,
  spaceId: "space-1",
  organizationId: "org-1",
  visibility: "private" as const,
  accessMode: "public" as const,
  creator,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
});

const createMentionSqlStub = (options?: {
  spaceMemberRows?: Record<string, unknown>[];
}): SqlStorage => {
  const spaceMemberRows = options?.spaceMemberRows ?? [];
  const exec = vi.fn((query: string, ...params: unknown[]) => {
    if (query.includes("space_dispatch_rules")) {
      return {
        toArray: () => [
          {
            mode: "all_members",
            allow: 1,
            rule_id: "space.default.all_members.v1",
            rule_reason: "default allow all members mention",
            rule_set_version: 1,
            updated_by: "system",
            updated_at_ms: Date.UTC(2026, 2, 4, 0, 0, 0),
          },
        ],
      };
    }
    if (
      query.includes("FROM space_members") &&
      query.includes("profile_kind_snapshot")
    ) {
      const statusFilter = String(params[0] ?? "").trim();
      return {
        toArray: () =>
          statusFilter.length > 0
            ? spaceMemberRows.filter(
                (row) => String(row.status ?? "").trim() === statusFilter
              )
            : spaceMemberRows,
      };
    }
    return {
      rowsWritten: 1,
      toArray: () => [],
    };
  });

  return {
    exec,
    databaseSize: 0,
  } as unknown as SqlStorage;
};

const createDispatchRulesSpaceMemberRow = (input: {
  profileId: string;
  profileName: string;
  agentControllerRef?: string | null;
  profileKind?: "human" | "agent";
  status?: "active" | "removed";
}) => ({
  space_id: "space-1",
  profile_id: input.profileId,
  profile_kind_snapshot: input.profileKind ?? "agent",
  profile_name_snapshot: input.profileName,
  owner_user_id_snapshot: "owner-1",
  owner_name_snapshot: "Owner One",
  controller_ref_snapshot:
    input.agentControllerRef === undefined
      ? "builtin:codex"
      : input.agentControllerRef,
  status: input.status ?? "active",
  member_source: "joined_directly",
  added_at: Date.parse(NOW_ISO),
  removed_at: null,
  added_by_profile_id: null,
  added_by_owner_user_id: null,
  added_by_display_name_snapshot: null,
  removed_by_profile_id: null,
  removed_by_owner_user_id: null,
  removal_reason: null,
  first_entered_at: Date.parse(NOW_ISO),
  last_entered_at: Date.parse(NOW_ISO),
  created_at: Date.parse(NOW_ISO),
  updated_at: Date.parse(NOW_ISO),
});

const createDispatchRulesSpaceMemberRecord = (input: {
  profileId: string;
  profileName: string;
  agentControllerRef?: string | null;
  profileKind?: "human" | "agent";
  status?: "active" | "removed";
}): SpaceMemberRecord => ({
  spaceId: "space-1",
  profileId: input.profileId,
  profileKindSnapshot: input.profileKind ?? "agent",
  profileNameSnapshot: input.profileName,
  ownerUserIdSnapshot: "owner-1",
  ownerNameSnapshot: "Owner One",
  controllerRefSnapshot:
    input.agentControllerRef === undefined
      ? "builtin:codex"
      : input.agentControllerRef,
  status: input.status ?? "active",
  memberSource: "joined_directly",
  addedAt: NOW_ISO,
  removedAt: null,
  addedByProfileId: null,
  addedByOwnerUserId: null,
  addedByDisplayNameSnapshot: null,
  removedByProfileId: null,
  removedByOwnerUserId: null,
  removalReason: null,
  firstEnteredAt: NOW_ISO,
  lastEnteredAt: NOW_ISO,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
});

const createMessageEnvelope = (input: {
  text: string;
  activationTargets?: string[];
  referenceTargets?: string[];
}) => ({
  activationTargets: input.activationTargets ?? [],
  referenceTargets: input.referenceTargets ?? [],
  text: input.text,
});

const createDmSignal = (input: {
  profileId: string;
  profileKind: "human" | "agent";
  profileName?: string;
}) => ({
  v: 1 as const,
  id: `evt-${input.profileId}`,
  spaceId: "space-1",
  ts: Date.UTC(2026, 2, 4, 0, 0, 0),
  profile: {
    kind: input.profileKind,
    profileId: input.profileId,
    profileName: input.profileName ?? input.profileId,
  },
  type: "signal.text" as const,
  data: {
    text: "Can you help me plan this?",
    messageEnvelope: createMessageEnvelope({
      text: "Can you help me plan this?",
    }),
  },
});

describe("Direct Message dispatch rules", () => {
  const humanMember = createDispatchRulesSpaceMemberRecord({
    profileId: "human-felix",
    profileKind: "human",
    profileName: "Felix",
  });
  const agentMember = createDispatchRulesSpaceMemberRecord({
    profileId: "agt-center",
    profileKind: "agent",
    profileName: "Center Agent",
  });

  it("auto-dispatches a human-authored 1:1 human-agent Direct Message with prompt context", () => {
    const decisions = buildDirectMessageDispatchReadyDecisions({
      activeMemberRecords: [humanMember, agentMember],
      senderProfileId: "human-felix",
      signal: createDmSignal({
        profileId: "human-felix",
        profileKind: "human",
        profileName: "Felix",
      }),
      spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
    });

    expect(decisions).toHaveLength(1);
    const decision = decisions[0];
    if (!decision) {
      throw new Error("Expected one Direct Message dispatch decision.");
    }
    expect(decision).toMatchObject({
      ruleId: "space_direct_message.auto_agent.v1",
      targetProfileId: "agt-center",
    });
    expect(
      applyDirectMessageDispatchPromptContext({
        decision,
        sourceText: "Can you help me plan this?",
      })
    ).toContain("This is a direct message with Felix");
  });

  it("does not auto-dispatch agent-authored messages in a Direct Message", () => {
    const decisions = buildDirectMessageDispatchReadyDecisions({
      activeMemberRecords: [humanMember, agentMember],
      senderProfileId: "agt-center",
      signal: createDmSignal({
        profileId: "agt-center",
        profileKind: "agent",
        profileName: "Center Agent",
      }),
      spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
    });

    expect(decisions).toEqual([]);
  });

  it("does not auto-dispatch human-human Direct Messages", () => {
    const decisions = buildDirectMessageDispatchReadyDecisions({
      activeMemberRecords: [
        humanMember,
        createDispatchRulesSpaceMemberRecord({
          profileId: "human-ada",
          profileKind: "human",
          profileName: "Ada",
        }),
      ],
      senderProfileId: "human-felix",
      signal: createDmSignal({
        profileId: "human-felix",
        profileKind: "human",
      }),
      spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
    });

    expect(decisions).toEqual([]);
  });

  it("stops when a third member joins and resumes when the Space returns to 1:1", () => {
    const thirdMember = createDispatchRulesSpaceMemberRecord({
      profileId: "human-third",
      profileKind: "human",
      profileName: "Third",
    });
    const signal = createDmSignal({
      profileId: "human-felix",
      profileKind: "human",
    });

    expect(
      buildDirectMessageDispatchReadyDecisions({
        activeMemberRecords: [humanMember, agentMember, thirdMember],
        senderProfileId: "human-felix",
        signal,
        spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      })
    ).toEqual([]);

    expect(
      buildDirectMessageDispatchReadyDecisions({
        activeMemberRecords: [humanMember, agentMember],
        senderProfileId: "human-felix",
        signal,
        spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      })
    ).toHaveLength(1);
  });

  it("never auto-dispatches ordinary two-member Spaces without Direct Message origin", () => {
    const decisions = buildDirectMessageDispatchReadyDecisions({
      activeMemberRecords: [humanMember, agentMember],
      senderProfileId: "human-felix",
      signal: createDmSignal({
        profileId: "human-felix",
        profileKind: "human",
      }),
      spacePurpose: "ordinary_private_space",
    });

    expect(decisions).toEqual([]);
  });

  it("does not auto-dispatch a legacy Welcoming Space", () => {
    const decisions = buildDirectMessageDispatchReadyDecisions({
      activeMemberRecords: [humanMember, agentMember],
      senderProfileId: "human-felix",
      signal: createDmSignal({
        profileId: "human-felix",
        profileKind: "human",
        profileName: "Felix",
      }),
      spacePurpose: LEGACY_OPENMELD_WELCOMING_SPACE_PURPOSE,
    });

    expect(decisions).toEqual([]);
  });
});

describe("space deletion policy", () => {
  it("allows human creator deleting their own space", () => {
    const result = authorizeSpaceDeletion({
      meta: createMeta({
        kind: "human",
        profileId: "human-owner",
      }),
      context: createContext({
        profileId: "human-owner",
        profileKind: "human",
      }),
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects non-creator deleting a human-created space", () => {
    const result = authorizeSpaceDeletion({
      meta: createMeta({
        kind: "human",
        profileId: "human-owner",
      }),
      context: createContext({
        profileId: "human-other",
        profileKind: "human",
      }),
    });
    expect(result).toEqual({
      ok: false,
      code: "space.forbidden",
      message: "only space creator can delete this space",
    });
  });

  it("allows owner human deleting agent-created space", () => {
    const result = authorizeSpaceDeletion({
      meta: createMeta({
        kind: "agent",
        profileId: "agt-owner",
        ownerUserId: "owner-1",
      }),
      context: createContext({
        profileId: "human-owner",
        profileKind: "human",
        ownerUserId: "owner-1",
      }),
    });
    expect(result).toEqual({ ok: true });
  });

  it("requires human confirmation when requester is an agent", () => {
    const result = authorizeSpaceDeletion({
      meta: createMeta({
        kind: "agent",
        profileId: "agt-owner",
        ownerUserId: "owner-1",
      }),
      context: createContext({
        profileId: "agt-other",
        profileKind: "agent",
      }),
    });
    expect(result).toEqual({
      ok: false,
      code: "space.human_confirmation_required",
      message: "agent-created spaces require owner human confirmation",
    });
  });
});

describe("space member management policy", () => {
  it("allows a human creator account to remove members from a human-created space", () => {
    const result = authorizeSpaceMemberRemoval({
      meta: createMeta({
        kind: "human",
        ownerUserId: "owner-1",
        profileId: "human-owner",
      }),
      context: createContext({
        ownerUserId: "owner-1",
        profileId: "human-owner",
        profileKind: "human",
      }),
    });

    expect(result).toEqual({ ok: true });
  });

  it("allows the owner human to remove members from an agent-created space", () => {
    const result = authorizeSpaceMemberRemoval({
      meta: createMeta({
        kind: "agent",
        ownerUserId: "owner-1",
        profileId: "agt-owner",
      }),
      context: createContext({
        ownerUserId: "owner-1",
        profileId: "human-owner",
        profileKind: "human",
      }),
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects agents even when they belong to the creator account", () => {
    const result = authorizeSpaceMemberRemoval({
      meta: createMeta({
        kind: "agent",
        ownerUserId: "owner-1",
        profileId: "agt-owner",
      }),
      context: createContext({
        ownerUserId: "owner-1",
        profileId: "agt-owner",
        profileKind: "agent",
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "space.forbidden",
      message: "member removal is only allowed for the owner human",
    });
  });

  it("rejects humans outside the creator account", () => {
    const result = authorizeSpaceMemberRemoval({
      meta: createMeta({
        kind: "human",
        ownerUserId: "owner-1",
        profileId: "human-owner",
      }),
      context: createContext({
        ownerUserId: "owner-2",
        profileId: "human-other",
        profileKind: "human",
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "space.forbidden",
      message: "member removal is only allowed for the creator account human",
    });
  });

  it("fails closed when the creator owner is missing", () => {
    const result = authorizeSpaceMemberRemoval({
      meta: createMeta({
        kind: "human",
        profileId: "human-owner",
      }),
      context: createContext({
        ownerUserId: "owner-1",
        profileId: "human-owner",
        profileKind: "human",
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "space.forbidden",
      message: "member removal is only allowed for the creator account human",
    });
  });
});

describe("retention warning policy", () => {
  it("triggers only when threshold reached and debounce window passed", () => {
    expect(
      shouldEmitRetentionWarning({
        createOutboxRecord: true,
        signalType: "signal.text",
        finalDatabaseSizeBytes: 100,
        thresholdBytes: 100,
        nowMs: 7200,
        lastRetentionWarningAtMs: 0,
        debounceMs: 3600,
      })
    ).toBe(true);
  });

  it("does not trigger for non-text, below-threshold, or debounce window", () => {
    expect(
      shouldEmitRetentionWarning({
        createOutboxRecord: false,
        signalType: "signal.text",
        finalDatabaseSizeBytes: 100,
        thresholdBytes: 100,
        nowMs: 7200,
        lastRetentionWarningAtMs: 0,
        debounceMs: 3600,
      })
    ).toBe(false);
    expect(
      shouldEmitRetentionWarning({
        createOutboxRecord: true,
        signalType: "presence.join",
        finalDatabaseSizeBytes: 100,
        thresholdBytes: 100,
        nowMs: 7200,
        lastRetentionWarningAtMs: 0,
        debounceMs: 3600,
      })
    ).toBe(false);
    expect(
      shouldEmitRetentionWarning({
        createOutboxRecord: true,
        signalType: "signal.text",
        finalDatabaseSizeBytes: 99,
        thresholdBytes: 100,
        nowMs: 7200,
        lastRetentionWarningAtMs: 0,
        debounceMs: 3600,
      })
    ).toBe(false);
    expect(
      shouldEmitRetentionWarning({
        createOutboxRecord: true,
        signalType: "signal.text",
        finalDatabaseSizeBytes: 100,
        thresholdBytes: 100,
        nowMs: 3500,
        lastRetentionWarningAtMs: 0,
        debounceMs: 3600,
      })
    ).toBe(false);
  });
});

describe("mention dispatch rules", () => {
  it("plans activationTargets from messageEnvelope and keeps self-trigger blocked", () => {
    const sql = createMentionSqlStub({
      spaceMemberRows: [
        createDispatchRulesSpaceMemberRow({
          profileId: "agt-self",
          profileName: "self-agent",
        }),
        createDispatchRulesSpaceMemberRow({
          profileId: "agt-target",
          profileName: "target-agent",
        }),
      ],
    });
    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      sql,
      signal: {
        v: 1,
        id: "evt-1",
        spaceId: "space-1",
        ts: Date.UTC(2026, 2, 4, 0, 0, 0),
        profile: {
          kind: "agent",
          profileId: "agt-self",
          profileName: "self-agent",
        },
        type: "signal.text",
        data: {
          text: "@self-agent ping @target-agent",
          messageEnvelope: createMessageEnvelope({
            text: "@self-agent ping @target-agent",
            activationTargets: ["agt-self", "agt-target"],
          }),
        },
      },
    });

    expect(
      decisions.some(
        (decision) =>
          decision.status === "blocked" &&
          decision.errorCode === MENTION_DISPATCH_ERROR_CODES.selfTrigger &&
          decision.targetProfileId === "agt-self"
      )
    ).toBe(true);
    expect(
      decisions.some(
        (decision) =>
          decision.status === "dispatch_ready" &&
          decision.targetProfileId === "agt-target"
      )
    ).toBe(true);
  });

  it("fails activationTargets that are not active agent members in this space", () => {
    const sql = createMentionSqlStub();
    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      sql,
      signal: {
        v: 1,
        id: "evt-profile-id-missing",
        spaceId: "space-1",
        ts: Date.UTC(2026, 2, 4, 0, 0, 0),
        profile: {
          kind: "human",
          profileId: "human-sender",
          profileName: "felix",
        },
        type: "signal.text",
        data: {
          text: "@agt-missing-agent please reply",
          messageEnvelope: createMessageEnvelope({
            text: "@agt-missing-agent please reply",
            activationTargets: ["agt-missing-agent"],
          }),
        },
      },
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        status: "failed",
        targetProfileId: "agt-missing-agent",
        errorCode: MENTION_DISPATCH_ERROR_CODES.invalidTarget,
      }),
    ]);
  });

  it("dispatches activationTargets when the target is an active agent member", () => {
    const sql = createMentionSqlStub({
      spaceMemberRows: [
        createDispatchRulesSpaceMemberRow({
          profileId: "agt-live-agent",
          profileName: "live-agent",
        }),
      ],
    });
    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      sql,
      signal: {
        v: 1,
        id: "evt-profile-id-ready",
        spaceId: "space-1",
        ts: Date.UTC(2026, 2, 4, 0, 0, 0),
        profile: {
          kind: "human",
          profileId: "human-sender",
          profileName: "felix",
        },
        type: "signal.text",
        data: {
          text: "@agt-live-agent please reply",
          messageEnvelope: createMessageEnvelope({
            text: "@agt-live-agent please reply",
            activationTargets: ["agt-live-agent"],
          }),
        },
      },
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        status: "dispatch_ready",
        targetProfileId: "agt-live-agent",
      }),
    ]);
  });

  it("keeps Binding readiness out of active Agent Wake authoring", () => {
    const sql = createMentionSqlStub({
      spaceMemberRows: [
        createDispatchRulesSpaceMemberRow({
          agentControllerRef: null,
          profileId: "agt-binding-not-ready",
          profileName: "binding-not-ready-agent",
        }),
      ],
    });
    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      sql,
      signal: {
        v: 1,
        id: "evt-binding-not-ready",
        spaceId: "space-1",
        ts: Date.UTC(2026, 2, 4, 0, 0, 0),
        profile: {
          kind: "human",
          profileId: "human-sender",
          profileName: "felix",
        },
        type: "signal.text",
        data: {
          text: "@agt-binding-not-ready please reply",
          messageEnvelope: createMessageEnvelope({
            text: "@agt-binding-not-ready please reply",
            activationTargets: ["agt-binding-not-ready"],
          }),
        },
      },
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        status: "dispatch_ready",
        targetProfileId: "agt-binding-not-ready",
      }),
    ]);
    expect(
      decisions.some(
        (decision) =>
          decision.status === "failed" &&
          (decision.errorCode === MENTION_DISPATCH_ERROR_CODES.bindingMissing ||
            decision.errorCode === MENTION_DISPATCH_ERROR_CODES.bindingDisabled)
      )
    ).toBe(false);
  });

  it("does not dispatch Reference targets", () => {
    const sql = createMentionSqlStub({
      spaceMemberRows: [
        createDispatchRulesSpaceMemberRow({
          profileId: "agt-budget-agent",
          profileName: "Budget Analyst",
        }),
      ],
    });
    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      sql,
      signal: {
        v: 1,
        id: "evt-canonical-ignored",
        spaceId: "space-1",
        ts: Date.UTC(2026, 2, 4, 0, 0, 0),
        profile: {
          kind: "human",
          profileId: "human-sender",
          profileName: "felix",
        },
        type: "signal.text",
        data: {
          text: "@Budget Analyst(reference) keep this as context.",
          messageEnvelope: createMessageEnvelope({
            text: "@Budget Analyst(reference) keep this as context.",
            referenceTargets: ["agt-budget-agent"],
          }),
        },
      },
    });

    expect(decisions).toEqual([]);
  });

  it("does not create mention-driven dispatch decisions for body-only legacy text", () => {
    const sql = createMentionSqlStub({
      spaceMemberRows: [
        createDispatchRulesSpaceMemberRow({
          profileId: "agt-live-agent",
          profileName: "live-agent",
        }),
      ],
    });

    expect(
      resolveDispatchPlannerDecisionsForSignal({
        dispatchPolicy: "mention_only",
        sessions: null,
        sql,
        signal: {
          v: 1,
          id: "evt-legacy-prose-only",
          spaceId: "space-1",
          ts: Date.UTC(2026, 2, 4, 0, 0, 0),
          profile: {
            kind: "human",
            profileId: "human-sender",
            profileName: "felix",
          },
          type: "signal.text",
          data: { text: "@agt-live-agent please reply" },
        },
      })
    ).toEqual([]);
  });

  it("omits self-trigger from public hint text while keeping ambiguous target guidance", () => {
    const decisions: OpenMeldDaemonMentionDispatchResultPayload[] = [
      {
        dispatchId: "dispatch-1",
        sourceEventId: "evt-1",
        status: "blocked",
        targetProfileId: "agt-self",
        errorCode: MENTION_DISPATCH_ERROR_CODES.selfTrigger,
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
      {
        dispatchId: "dispatch-2",
        sourceEventId: "evt-1",
        status: "failed",
        targetProfileId: "my-codex",
        errorCode: MENTION_DISPATCH_ERROR_CODES.invalidTarget,
        ruleSource: "system",
        ruleId: "system.target_resolution.invalid",
        ruleReason: "mention target cannot be resolved",
      },
    ];

    const hint = buildMentionFailureHintText({
      decisions,
      mentionTargetAliases: new Map([
        ["my-codex", new Set(["agt-a", "agt-b"])],
      ]),
    });

    expect(hint).not.toContain("You mentioned yourself");
    expect(hint).toContain(
      'Mention label "my-codex" matches multiple profiles'
    );
  });

  it("does not emit mention-skipped hint for known human mention tokens", () => {
    const decisions: OpenMeldDaemonMentionDispatchResultPayload[] = [
      {
        dispatchId: "dispatch-human-1",
        sourceEventId: "evt-human-1",
        status: "failed",
        targetProfileId: "felix",
        errorCode: MENTION_DISPATCH_ERROR_CODES.invalidTarget,
        ruleSource: "system",
        ruleId: "system.target_resolution.invalid",
        ruleReason: "mention target cannot be resolved",
      },
    ];

    const hint = buildMentionFailureHintText({
      decisions,
      mentionTargetAliases: new Map(),
      suppressInvalidTargetMentionTokens: new Set(["felix"]),
    });

    expect(hint).toBeNull();
  });

  it("strips only target mentions while keeping others", () => {
    const stripped = stripDispatchTargetMentionsFromText({
      mentionTargetAliases: new Map([
        ["my-codex", new Set(["agt-my-codex"])],
        ["other-agent", new Set(["agt-other-agent"])],
      ]),
      targetProfileId: "agt-my-codex",
      text: "ping @my-codex(wake) and keep @other-agent(wake)",
    });

    expect(stripped).toBe("ping and keep @other-agent(wake)");
  });

  it("marks only shared-semantic mention failures as space-history eligible", () => {
    const eligibleDecisions: OpenMeldDaemonMentionDispatchResultPayload[] = [
      {
        dispatchId: "dispatch-invalid",
        sourceEventId: "evt-invalid",
        status: "failed",
        targetProfileId: "ghost",
        errorCode: MENTION_DISPATCH_ERROR_CODES.invalidTarget,
        ruleSource: "system",
        ruleId: "system.target_resolution.invalid",
        ruleReason: "mention target cannot be resolved",
      },
      {
        dispatchId: "dispatch-rules",
        sourceEventId: "evt-rules",
        status: "blocked",
        targetProfileId: "ops-bot",
        errorCode: MENTION_DISPATCH_ERROR_CODES.dispatchRulesDenied,
        ruleSource: "space",
        ruleId: "space.rules.denied",
        ruleReason: "space mention rule denied target",
      },
      {
        dispatchId: "dispatch-policy",
        sourceEventId: "evt-policy",
        status: "blocked",
        targetProfileId: "ops-bot",
        errorCode: MENTION_DISPATCH_ERROR_CODES.dispatchPolicyUnsupported,
        ruleSource: "system",
        ruleId: "system.dispatch_policy.unsupported",
        ruleReason: "unsupported dispatch policy",
      },
    ];

    const ineligibleDecisions: OpenMeldDaemonMentionDispatchResultPayload[] = [
      {
        dispatchId: "dispatch-self",
        sourceEventId: "evt-self",
        status: "blocked",
        targetProfileId: "agt-self",
        errorCode: MENTION_DISPATCH_ERROR_CODES.selfTrigger,
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
      {
        dispatchId: "dispatch-binding-disabled",
        sourceEventId: "evt-binding-disabled",
        status: "failed",
        targetProfileId: "ops-bot",
        errorCode: MENTION_DISPATCH_ERROR_CODES.bindingDisabled,
        ruleSource: "system",
        ruleId: "system.binding.disabled",
        ruleReason: "target binding exists but is disabled",
      },
      {
        dispatchId: "dispatch-binding-missing",
        sourceEventId: "evt-binding-missing",
        status: "failed",
        targetProfileId: "ops-bot",
        errorCode: MENTION_DISPATCH_ERROR_CODES.bindingMissing,
        ruleSource: "system",
        ruleId: "system.binding.missing",
        ruleReason: "target profile has no controller binding",
      },
    ];

    for (const decision of eligibleDecisions) {
      expect(isSpaceHistoryEligibleMentionFailureDecision(decision)).toBe(true);
    }
    for (const decision of ineligibleDecisions) {
      expect(isSpaceHistoryEligibleMentionFailureDecision(decision)).toBe(
        false
      );
    }
  });
});
