import type { SignalEnvelope } from "@openmeld/protocol";
import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { truncateInboxText } from "../inbox/application/inbox-text";
import { buildSpaceInboxProjectionOutboxRecord } from "../space/application/space-inbox-projection";
import {
  attemptSpaceInboxProjectionOutboxRecord,
  resolveSpaceInboxRecipientEligibility,
} from "../space/application/space-inbox-projection-outbox-service";
import type { SpaceInboxProjectionOutboxRecord } from "../space/infrastructure/sql/space-inbox-projection-outbox-repo";
import type { SpaceMemberRecord } from "../space/infrastructure/sql/space-member-repo";
import { Space } from "../space/transport/do/space";

const publishTextSignal = (
  Space.prototype as unknown as {
    publishTextSignal(
      this: {
        agentStreamProjectionStorage: unknown;
        assertRemoteAgentFinalReplyWasNotStopped(): void;
        broadcastSignal: (signal: SignalEnvelope) => void;
        ctx: {
          storage: {
            getAlarm(): Promise<number | null>;
            setAlarm(atMs: number): Promise<void>;
          };
          waitUntil(promise: Promise<void>): void;
        };
        durableObjectId: string;
        flushPendingDispatchOutbox(): Promise<void>;
        flushPendingSpaceInboxProjectionOutbox(): Promise<void>;
        persistTextSignalWithOptionalOutbox(signal: SignalEnvelope): Promise<{
          dispatchMessages: [];
          duplicateFinalReplyBlocked: false;
          persistedSignal: true;
        }>;
        spaceId: string;
        syncSpaceBackgroundAlarm(): Promise<void>;
      },
      signal: SignalEnvelope
    ): Promise<void>;
  }
).publishTextSignal;

describe("Space Inbox projection", () => {
  it("truncates Inbox copy without splitting a surrogate pair", () => {
    const truncated = truncateInboxText("aa😀tail", 4);

    expect(truncated).toBe("aa…");
    expect(truncated.length).toBeLessThanOrEqual(4);
  });

  it("projects exact thread targets, reference priority, and active human visibility without notifying the author", () => {
    const signal = textSignal({
      authorKind: "human",
      authorName: "Alex Author",
      authorProfileId: "profile-author",
      referenceTargets: ["profile-referenced"],
      text: "Please review the updated launch notes.",
    });
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-author", "user-author", "human"),
        member("profile-referenced", "user-referenced", "human"),
        member("profile-second", "user-second", "human"),
        member("profile-agent", "user-agent-owner", "agent"),
        {
          ...member("profile-removed", "user-removed", "human"),
          status: "removed",
        },
        member("profile-second-alias", "user-second", "human"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal,
      signalContext: {
        threadContext: {
          rootSignalId: "signal-root",
          threadId: "thread-1",
        },
        threadPlacement: "thread",
      },
      spaceName: "Launch Room",
    });

    expect(record?.candidates).toHaveLength(2);
    expect(record?.candidates).toEqual([
      expect.objectContaining({
        kind: "space_reference",
        recipientUserId: "user-referenced",
        sourceKey: "signal-1",
        sourceTarget: {
          kind: "space",
          signalId: "signal-1",
          spaceId: "space-1",
          threadRootSignalId: "signal-root",
        },
        title: "Alex Author referenced you in Launch Room",
      }),
      expect.objectContaining({
        kind: "space_message",
        recipientUserId: "user-second",
      }),
    ]);
    expect(
      record?.candidates.some(
        (candidate) => candidate.recipientUserId === "user-author"
      )
    ).toBe(false);
    expect(
      record?.candidates.some(
        (candidate) => candidate.recipientUserId === "user-agent-owner"
      )
    ).toBe(false);
    expect(
      record?.candidates.some(
        (candidate) => candidate.recipientUserId === "user-removed"
      )
    ).toBe(false);
  });

  it("classifies a final agent message as an agent reply only for the exact requester", () => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-human", "user-human", "human"),
        member("profile-observer", "user-observer", "human"),
        member("profile-agent", "user-agent-owner", "agent"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal: textSignal({
        authorKind: "agent",
        authorName: "Center Agent",
        authorProfileId: "profile-agent",
        purpose: AGENT_REPLY_FINAL_PURPOSE,
        text: "The rollout summary is ready.",
      }),
      spaceName: "Operations",
      wakeRequesterUserId: "user-human",
    });

    expect(record?.candidates).toEqual([
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-human",
        title: "Center Agent replied in Operations",
      }),
    ]);
  });

  it("delivers an agent reply to the requester, structured references, and thread target without broadcasting", () => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-requester", "user-requester", "human"),
        member("profile-referenced", "user-referenced", "human"),
        member("profile-thread-author", "user-thread-author", "human"),
        member("profile-observer", "user-observer", "human"),
        member("profile-agent", "user-agent-owner", "agent"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal: textSignal({
        authorKind: "agent",
        authorName: "Center Agent",
        authorProfileId: "profile-agent",
        purpose: AGENT_REPLY_FINAL_PURPOSE,
        referenceTargets: ["profile-referenced"],
        text: "I updated the plan for Bob.",
      }),
      signalContext: {
        threadContext: {
          rootSignalId: "signal-root",
          threadId: "thread-1",
        },
        threadPlacement: "thread",
      },
      spaceName: "Operations",
      threadRootAuthorUserId: "user-thread-author",
      wakeRequesterUserId: "user-requester",
    });

    expect(record?.candidates).toEqual([
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-requester",
      }),
      expect.objectContaining({
        kind: "space_reference",
        recipientUserId: "user-referenced",
      }),
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-thread-author",
      }),
    ]);
    expect(
      record?.candidates.some(
        (item) => item.recipientUserId === "user-observer"
      )
    ).toBe(false);
  });

  it("fails closed when a human author cannot be mapped to an active owner", () => {
    expect(
      buildSpaceInboxProjectionOutboxRecord({
        activeMemberRecords: [
          member("profile-recipient", "user-recipient", "human"),
        ],
        nowMs: 2000,
        organizationId: "org-1",
        signal: textSignal({
          authorKind: "human",
          authorName: "Unknown Author",
          authorProfileId: "profile-unknown",
          text: "This must not fan out without exact identity.",
        }),
        spaceName: "Operations",
      })
    ).toBeNull();
  });

  it("delivers a terminal Wake failure only to the exact requester", () => {
    const signal = systemNoticeSignal({
      noticeType: "terminal_failure",
      text: "The Wake could not finish.",
    });
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-requester", "user-requester", "human"),
        member("profile-observer", "user-observer", "human"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal,
      spaceName: "Operations",
      wakeRequesterUserId: "user-requester",
    });

    expect(record?.candidates).toEqual([
      expect.objectContaining({
        kind: "wake_outcome",
        recipientUserId: "user-requester",
      }),
    ]);
  });

  it.each([
    "policy_blocked",
    "stay_silent",
  ] as const)("delivers a %s Wake ending only to the exact requester as an ordinary update", (noticeType) => {
    const signal = systemNoticeSignal({
      noticeType,
      text:
        noticeType === "policy_blocked"
          ? "OpenMeld blocked a public reply from Research Agent."
          : "Research Agent chose to stay silent.",
    });
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-requester", "user-requester", "human"),
        member("profile-observer", "user-observer", "human"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal,
      spaceName: "Operations",
      wakeRequesterUserId: "user-requester",
    });

    expect(record?.candidates).toEqual([
      expect.objectContaining({
        attention: "update",
        importance: "normal",
        kind: "wake_outcome",
        recipientUserId: "user-requester",
        title: "Agent update in Operations",
      }),
    ]);
  });

  it("keeps a working status out of Inbox because it is not a Wake ending", () => {
    expect(
      buildSpaceInboxProjectionOutboxRecord({
        activeMemberRecords: [
          member("profile-requester", "user-requester", "human"),
        ],
        nowMs: 2000,
        organizationId: "org-1",
        signal: statusSignal({ status: "working" }),
        spaceName: "Operations",
        wakeRequesterUserId: "user-requester",
      })
    ).toBeNull();
  });

  it.each([
    "done",
    "blocked",
    "needs_input",
    "handoff",
  ] as const)("delivers a %s final status only to the exact Wake requester", (status) => {
    const signal = statusSignal({ status });
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-requester", "user-requester", "human"),
        member("profile-observer", "user-observer", "human"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal,
      spaceName: "Operations",
      wakeRequesterUserId: "user-requester",
    });

    expect(record?.candidates).toEqual([
      expect.objectContaining({
        attention: "update",
        importance: "normal",
        kind: "wake_outcome",
        recipientUserId: "user-requester",
        sourceKey: "signal-status-1",
      }),
    ]);
  });

  it("ignores non-conversation signals", () => {
    const presence = {
      data: {},
      id: "presence-1",
      profile: {
        kind: "human",
        profileId: "profile-author",
        profileName: "Alex Author",
      },
      spaceId: "space-1",
      ts: 1000,
      type: "presence.join",
      v: 1,
    } satisfies SignalEnvelope;

    expect(
      buildSpaceInboxProjectionOutboxRecord({
        activeMemberRecords: [
          member("profile-recipient", "user-recipient", "human"),
        ],
        nowMs: 2000,
        organizationId: "org-1",
        signal: presence,
        spaceName: "Launch Room",
      })
    ).toBeNull();
  });

  it("replays every deterministic recipient safely after a partial delivery crash", async () => {
    const record: SpaceInboxProjectionOutboxRecord = {
      attemptCount: 0,
      candidates: [candidate("user-1"), candidate("user-2")],
      completedAtMs: null,
      createdAtMs: 1000,
      lastErrorCode: null,
      nextRetryAtMs: null,
      projectionId: "signal-1",
      signalId: "signal-1",
      spaceId: "space-1",
      status: "pending",
      updatedAtMs: 1000,
    };
    const statements: string[] = [];
    const sql = {
      exec(statement: string) {
        statements.push(statement);
        return { rowsWritten: 1, toArray: () => [] };
      },
    } as unknown as SqlStorage;
    let failSecondRecipientOnce = true;
    const ensureItem = vi.fn(({ candidate: item }) => {
      if (item.recipientUserId === "user-2" && failSecondRecipientOnce) {
        failSecondRecipientOnce = false;
        return Promise.reject(new Error("D1 unavailable"));
      }
      return Promise.resolve({
        deliveryId: null,
        itemId: `item-${item.recipientUserId}`,
      });
    });

    await expect(
      attemptSpaceInboxProjectionOutboxRecord({
        db: {} as D1Database,
        ensureItem,
        isRecipientEligible: vi.fn().mockResolvedValue(true),
        nowMs: 2000,
        record,
        sql,
      })
    ).resolves.toMatchObject({ status: "failed", nextRetryAtMs: 4000 });
    const replay = await attemptSpaceInboxProjectionOutboxRecord({
      db: {} as D1Database,
      ensureItem,
      isRecipientEligible: vi.fn().mockResolvedValue(true),
      nowMs: 4000,
      record: { ...record, attemptCount: 1, status: "failed" },
      sql,
    });
    expect(
      replay.status === "failed" ? replay.error.message : replay.status
    ).toBe("completed");

    expect(ensureItem).toHaveBeenCalledTimes(4);
    expect(
      statements.some((statement) => statement.includes("status = 'failed'"))
    ).toBe(true);
    expect(
      statements.some((statement) => statement.includes("status = 'completed'"))
    ).toBe(true);
  });

  it("normalizes an eligible Center Agent reply before writing the Inbox item", async () => {
    const record: SpaceInboxProjectionOutboxRecord = {
      attemptCount: 0,
      candidates: [candidate("user-1")],
      completedAtMs: null,
      createdAtMs: 1000,
      lastErrorCode: null,
      nextRetryAtMs: null,
      projectionId: "signal-1",
      signalId: "signal-1",
      spaceId: "space-1",
      status: "pending",
      updatedAtMs: 1000,
    };
    const sql = {
      exec() {
        return { rowsWritten: 1, toArray: () => [] };
      },
    } as unknown as SqlStorage;
    const ensureItem = vi.fn().mockResolvedValue({
      deliveryId: null,
      itemId: "item-user-1",
    });
    const prepareCandidate = vi.fn(async (item) => ({
      ...item,
      sourceTarget: {
        kind: "center_agent" as const,
        signalId: "signal-1",
        spaceId: "space-1",
      },
    }));

    await expect(
      attemptSpaceInboxProjectionOutboxRecord({
        db: {} as D1Database,
        ensureItem,
        isRecipientEligible: vi.fn().mockResolvedValue(true),
        nowMs: 2000,
        prepareCandidate,
        record,
        sql,
      } as Parameters<typeof attemptSpaceInboxProjectionOutboxRecord>[0] & {
        prepareCandidate: typeof prepareCandidate;
      })
    ).resolves.toMatchObject({ status: "completed" });

    expect(prepareCandidate).toHaveBeenCalledOnce();
    expect(ensureItem).toHaveBeenCalledWith({
      candidate: expect.objectContaining({
        sourceTarget: {
          kind: "center_agent",
          signalId: "signal-1",
          spaceId: "space-1",
        },
      }),
      db: {},
      nowMs: 2000,
    });
  });

  it("isolates recipient failures and durably retries only failed candidates", async () => {
    const record: SpaceInboxProjectionOutboxRecord = {
      attemptCount: 0,
      candidates: [candidate("user-poison"), candidate("user-healthy")],
      completedAtMs: null,
      createdAtMs: 1000,
      lastErrorCode: null,
      nextRetryAtMs: null,
      projectionId: "signal-1",
      signalId: "signal-1",
      spaceId: "space-1",
      status: "pending",
      updatedAtMs: 1000,
    };
    const executions: Array<{ bindings: unknown[]; statement: string }> = [];
    const sql = {
      exec(statement: string, ...bindings: unknown[]) {
        executions.push({ bindings, statement });
        return { rowsWritten: 1, toArray: () => [] };
      },
    } as unknown as SqlStorage;
    const ensureItem = vi.fn(({ candidate: item }) => {
      return item.recipientUserId === "user-poison"
        ? Promise.reject(new Error("recipient no longer exists"))
        : Promise.resolve({
            deliveryId: null,
            itemId: `item-${item.recipientUserId}`,
          });
    });

    const result = await attemptSpaceInboxProjectionOutboxRecord({
      db: {} as D1Database,
      ensureItem,
      isRecipientEligible: vi.fn().mockResolvedValue(true),
      nowMs: 2000,
      record,
      sql,
    });

    expect(result.status).toBe("failed");
    expect(ensureItem).toHaveBeenCalledTimes(2);
    const failureUpdate = executions.find(({ statement }) =>
      statement.includes("status = 'failed'")
    );
    expect(failureUpdate?.bindings[0]).toBe(
      JSON.stringify([candidate("user-poison")])
    );
  });

  it("suppresses a delayed candidate that no longer has active Space access", async () => {
    const record: SpaceInboxProjectionOutboxRecord = {
      attemptCount: 0,
      candidates: [candidate("user-removed"), candidate("user-active")],
      completedAtMs: null,
      createdAtMs: 1000,
      lastErrorCode: null,
      nextRetryAtMs: null,
      projectionId: "signal-1",
      signalId: "signal-1",
      spaceId: "space-1",
      status: "pending",
      updatedAtMs: 1000,
    };
    const sql = {
      exec() {
        return { rowsWritten: 1, toArray: () => [] };
      },
    } as unknown as SqlStorage;
    const ensureItem = vi.fn().mockResolvedValue({
      deliveryId: null,
      itemId: "item-active",
    });

    await expect(
      attemptSpaceInboxProjectionOutboxRecord({
        db: {} as D1Database,
        ensureItem,
        isRecipientEligible: ({ recipientUserId }) =>
          Promise.resolve(recipientUserId === "user-active"),
        nowMs: 2000,
        record,
        sql,
      })
    ).resolves.toMatchObject({ status: "completed" });
    expect(ensureItem).toHaveBeenCalledOnce();
    expect(ensureItem).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({ recipientUserId: "user-active" }),
      })
    );
  });

  it("retries when the Auth-owned recipient identity projection is unavailable", async () => {
    const target = candidate("user-active");

    await expect(
      resolveSpaceInboxRecipientEligibility({
        candidate: target,
        hasActiveSpaceMembership: true,
        readAccountIdentity: vi.fn().mockResolvedValue(null),
      })
    ).rejects.toThrow("Inbox recipient identity projection is unavailable");

    await expect(
      resolveSpaceInboxRecipientEligibility({
        candidate: target,
        hasActiveSpaceMembership: true,
        readAccountIdentity: vi.fn().mockResolvedValue({
          code: "auth.organization_identity_unavailable",
          message: "Organization identity is temporarily unavailable.",
          ok: false,
        }),
      })
    ).rejects.toThrow(
      "Inbox recipient identity projection failed: auth.organization_identity_unavailable"
    );
  });

  it("suppresses a recipient only after Auth confirms the account is absent", async () => {
    await expect(
      resolveSpaceInboxRecipientEligibility({
        candidate: candidate("user-removed"),
        hasActiveSpaceMembership: true,
        readAccountIdentity: vi.fn().mockResolvedValue({
          account: null,
          ok: true,
          organization: {
            id: "org-1",
            memberCount: 1,
            name: "Acme",
            personal: false,
            slug: "acme",
          },
        }),
      })
    ).resolves.toBe(false);
  });

  it("accepts only the exact active Auth-owned organization account", async () => {
    const target = candidate("user-active");
    const readAccountIdentity = vi.fn().mockResolvedValue({
      account: {
        defaultHumanProfile: null,
        displayName: "Active User",
        email: "active@example.com",
        membership: { memberId: "member-1", role: "member" },
        userId: "user-active",
      },
      ok: true,
      organization: {
        id: "org-1",
        memberCount: 1,
        name: "Acme",
        personal: false,
        slug: "acme",
      },
    });

    await expect(
      resolveSpaceInboxRecipientEligibility({
        candidate: target,
        hasActiveSpaceMembership: true,
        readAccountIdentity,
      })
    ).resolves.toBe(true);
    await expect(
      resolveSpaceInboxRecipientEligibility({
        candidate: target,
        hasActiveSpaceMembership: false,
        readAccountIdentity,
      })
    ).resolves.toBe(false);
    expect(readAccountIdentity).toHaveBeenCalledOnce();
  });

  it("keeps the canonical signal and durable Inbox outbox when recovery alarms fail", async () => {
    const persistedSignals: SignalEnvelope[] = [];
    const durableInboxOutboxSignalIds: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const signal = textSignal({
      authorKind: "human",
      authorName: "Alex Author",
      authorProfileId: "profile-author",
      text: "This source message must survive projection infrastructure failure.",
    });
    const target = {
      agentStreamProjectionStorage: undefined,
      assertRemoteAgentFinalReplyWasNotStopped: vi.fn(),
      broadcastSignal: vi.fn(),
      ctx: {
        storage: {
          getAlarm: vi.fn().mockResolvedValue(null),
          setAlarm: vi.fn().mockRejectedValue(new Error("alarm unavailable")),
        },
        waitUntil: vi.fn(),
      },
      durableObjectId: "space-do-1",
      flushPendingDispatchOutbox: vi.fn().mockResolvedValue(undefined),
      flushPendingSpaceInboxProjectionOutbox: vi
        .fn()
        .mockRejectedValue(new Error("Inbox D1 unavailable")),
      persistTextSignalWithOptionalOutbox: vi.fn((currentSignal) => {
        persistedSignals.push(currentSignal);
        durableInboxOutboxSignalIds.push(currentSignal.id);
        return Promise.resolve({
          dispatchMessages: [] as [],
          duplicateFinalReplyBlocked: false as const,
          persistedSignal: true as const,
        });
      }),
      recordOrganizationMemberHumanActivity: vi
        .fn()
        .mockResolvedValue(undefined),
      spaceId: "space-1",
      syncSpaceBackgroundAlarm: vi
        .fn()
        .mockRejectedValue(new Error("alarm unavailable")),
    };

    await expect(
      publishTextSignal.call(target, signal)
    ).resolves.toBeUndefined();

    expect(persistedSignals).toEqual([signal]);
    expect(durableInboxOutboxSignalIds).toEqual([signal.id]);
    expect(target.recordOrganizationMemberHumanActivity).toHaveBeenCalledWith(
      signal
    );
    expect(target.broadcastSignal).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[core.openmeld.space.inbox_projection_failed]",
      expect.objectContaining({
        error: "alarm unavailable",
        stage: "pre_arm",
      })
    );
    expect(warn).toHaveBeenCalledWith(
      "[core.openmeld.space.inbox_projection_failed]",
      expect.objectContaining({
        error: "Inbox D1 unavailable",
        stage: "immediate_flush",
      })
    );
    expect(warn).toHaveBeenCalledWith(
      "[core.openmeld.space.inbox_projection_failed]",
      expect.objectContaining({
        error: "alarm unavailable",
        stage: "alarm_schedule",
      })
    );
    warn.mockRestore();
  });
});

function member(
  profileId: string,
  ownerUserIdSnapshot: string,
  profileKindSnapshot: "agent" | "human"
): SpaceMemberRecord {
  return {
    addedAt: new Date(1000).toISOString(),
    addedByDisplayNameSnapshot: null,
    addedByOwnerUserId: null,
    addedByProfileId: null,
    controllerRefSnapshot: null,
    createdAt: new Date(1000).toISOString(),
    firstEnteredAt: null,
    lastEnteredAt: null,
    memberSource: "joined_directly",
    ownerNameSnapshot: ownerUserIdSnapshot,
    ownerUserIdSnapshot,
    profileId,
    profileKindSnapshot,
    profileNameSnapshot: profileId,
    removalReason: null,
    removedAt: null,
    removedByOwnerUserId: null,
    removedByProfileId: null,
    spaceId: "space-1",
    status: "active",
    updatedAt: new Date(1000).toISOString(),
  };
}

function textSignal(input: {
  authorKind: "agent" | "human";
  authorName: string;
  authorProfileId: string;
  purpose?: string;
  referenceTargets?: string[];
  text: string;
}): SignalEnvelope {
  return {
    data: {
      ...(input.purpose ? { meta: { purpose: input.purpose } } : {}),
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: input.referenceTargets ?? [],
        text: input.text,
      },
      text: input.text,
    },
    id: "signal-1",
    profile: {
      kind: input.authorKind,
      profileId: input.authorProfileId,
      profileName: input.authorName,
    },
    spaceId: "space-1",
    ts: 1000,
    type: "signal.text",
    v: 1,
  };
}

function systemNoticeSignal(input: {
  noticeType:
    | "policy_blocked"
    | "stay_silent"
    | "terminal_failure"
    | "wake_stopped";
  text: string;
}): SignalEnvelope {
  return {
    data: {
      actorProfileId: "profile-agent",
      dispatchId: "dispatch-1",
      generatedBy: "openmeld",
      noticeType: input.noticeType,
      text: input.text,
    },
    id: "signal-1",
    profile: {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld System",
    },
    spaceId: "space-1",
    ts: 1000,
    type: "signal.system_notice",
    v: 1,
  } satisfies SignalEnvelope;
}

function statusSignal(input: {
  status: "blocked" | "done" | "handoff" | "needs_input" | "working";
}): SignalEnvelope {
  return {
    data: {
      actorProfileId: "profile-agent",
      dispatchId: "dispatch-1",
      generatedBy: "openmeld",
      status: input.status,
      text: `Agent status: ${input.status}`,
    },
    id: "signal-status-1",
    profile: {
      kind: "agent",
      profileId: "profile-agent",
      profileName: "Research Agent",
    },
    spaceId: "space-1",
    ts: 1000,
    type: "signal.status",
    v: 1,
  } satisfies SignalEnvelope;
}

function candidate(recipientUserId: string) {
  return {
    attention: "update" as const,
    contextLabel: "Launch Room",
    importance: "normal" as const,
    kind: "space_message" as const,
    occurredAtMs: 1000,
    organizationId: "org-1",
    preview: "Hello",
    recipientUserId,
    sourceKey: "signal-1",
    sourceKind: "space_signal" as const,
    sourceTarget: {
      kind: "space" as const,
      signalId: "signal-1",
      spaceId: "space-1",
    },
    title: "New message in Launch Room",
  };
}
