import { runInDurableObject } from "cloudflare:test";
import { PostgresDatabase } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { truncateInboxText } from "../src/inbox/application/inbox-text";
import {
  buildSpaceInboxProjectionOutboxRecord,
  buildSpaceReactionInboxProjectionOutboxRecord,
} from "../src/space/application/space-inbox-projection";
import {
  attemptSpaceInboxProjectionOutboxRecord,
  resolveSpaceInboxRecipientEligibility,
  selectSpaceInboxRecipients,
} from "../src/space/application/space-inbox-projection-outbox-service";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import {
  listDueSpaceInboxProjectionOutboxRecords,
  type SpaceInboxProjectionOutboxRecord,
} from "../src/space/infrastructure/sql/space-inbox-projection-outbox-repo";
import {
  type SpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

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
  it.each([
    "native-reply",
    "native-failure",
    "workstation-reply",
    "removed-requester",
    "missing-source",
  ])("persists formal results for current conversation members for %s", async (scenario) => {
    const spaces = (
      env as unknown as {
        OPENMELD_SPACES: DurableObjectNamespace<Space>;
      }
    ).OPENMELD_SPACES;
    const id = spaces.newUniqueId();
    const recipients = await runInDurableObject(
      spaces.get(id),
      (instance, state) => {
        const spaceId = id.toString();
        const requesterProfileId = "11111111-1111-4111-8111-111111111111";
        const agentProfileId = "agt_22222222-2222-4222-8222-222222222222";
        upsertSpaceMetaRecord(state.storage.sql, {
          v: 1,
          spaceId,
          organizationId: "org-1",
          visibility: "private",
          accessMode: "public",
          name: "Release verification",
          createdAt: new Date(1000).toISOString(),
          updatedAt: new Date(1000).toISOString(),
        });
        for (const record of [
          member(requesterProfileId, "user-requester", "human"),
          member("profile-observer", "user-observer", "human"),
          {
            ...member(agentProfileId, "", "agent"),
            ownerUserIdSnapshot: null,
            controllerRefSnapshot: "hosted:center-agent",
          },
        ]) {
          upsertSpaceMemberRecord(state.storage.sql, {
            ...record,
            spaceId,
            status:
              scenario === "removed-requester" &&
              record.profileId === requesterProfileId
                ? "removed"
                : "active",
          });
        }
        const source = {
          ...textSignal({
            authorKind: "human",
            authorName: "Requester",
            authorProfileId: requesterProfileId,
            text: "Please check the release.",
          }),
          id: "wake-source",
          spaceId,
        };
        if (scenario !== "missing-source") {
          insertSignalRecord(state.storage.sql, source);
        }
        const dispatch = createDispatchOutboxRecord({
          bindingEnabled: true,
          bindingState: "bound",
          dispatchPolicy: "mention_only",
          spaceId,
          sourceEventId: source.id,
          senderProfileId: requesterProfileId,
          sourceSignalSnapshot: {
            text: "Please check the release.",
            profileId: requesterProfileId,
            profileKind: "human",
          },
          targetProfileId: agentProfileId,
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
          nowMs: 1000,
        });
        if (scenario === "workstation-reply") {
          insertDispatchOutboxRecord(state.storage.sql, dispatch);
        }
        const signal =
          scenario === "native-failure"
            ? systemNoticeSignal({
                noticeType: "terminal_failure",
                replyToSignalId: source.id,
                text: "The request failed.",
              })
            : textSignal({
                authorKind: "agent",
                authorName: "Center Agent",
                authorProfileId: agentProfileId,
                purpose: AGENT_REPLY_FINAL_PURPOSE,
                // Captured native replies carry this relation without a replyTo snapshot.
                replyToSignalId:
                  scenario === "workstation-reply" ? undefined : source.id,
                text: "The release is ready.",
              });
        signal.spaceId = spaceId;
        signal.id = "result";
        if (signal.type === "signal.text") {
          signal.data.meta = {
            ...signal.data.meta,
            dispatchId: dispatch.dispatchId,
          };
        } else if (signal.type === "signal.system_notice") {
          signal.data.dispatchId = dispatch.dispatchId;
          signal.data.actorProfileId = agentProfileId;
          if (signal.data.replyTo) {
            signal.data.replyTo.profileId = requesterProfileId;
          }
        }
        state.storage.transactionSync(() => {
          insertSignalRecord(state.storage.sql, signal);
          (
            instance as unknown as {
              insertSpaceInboxProjectionForPublishedSignal(input: {
                nowMs: number;
                signal: SignalEnvelope;
              }): void;
            }
          ).insertSpaceInboxProjectionForPublishedSignal({
            nowMs: 2000,
            signal,
          });
        });
        return listDueSpaceInboxProjectionOutboxRecords(state.storage.sql, {
          nowMs: 2000,
          limit: 10,
        }).flatMap((record) =>
          record.candidates.map((candidate) => ({
            userId: candidate.recipientUserId,
            kind: candidate.kind,
          }))
        );
      }
    );
    const kind = scenario === "native-failure" ? "wake_outcome" : "agent_reply";
    expect(recipients).toEqual([
      ...(scenario === "removed-requester"
        ? []
        : [{ userId: "user-requester", kind }]),
      { userId: "user-observer", kind },
    ]);
  });

  it("limits thread updates to participants, including replies to an older root", () => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("writer", "writer-user", "human"),
        member("root", "root-user", "human"),
        member("earlier-reply", "reply-user", "human"),
        member("observer", "observer-user", "human"),
        member("unrelated-agent", "observer-user", "agent"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      spaceName: "Planning",
      signal: textSignal({
        authorKind: "human",
        authorName: "Alex",
        authorProfileId: "writer",
        authorHasRead: true,
        text: "A thread update",
      }),
      signalContext: {
        threadContext: { threadId: "thread-1", rootSignalId: "root-message" },
        threadPlacement: "thread",
      },
      threadParticipantProfileIds: ["root", "earlier-reply", "writer"],
    });
    expect(record?.candidates.map((item) => item.recipientUserId)).toEqual([
      "root-user",
      "reply-user",
    ]);
  });

  it("makes reactions to old messages new ordinary updates for the author alone", () => {
    const signal = textSignal({
      authorKind: "human",
      authorName: "Alex",
      authorProfileId: "author",
      text: "An old message",
    });
    if (signal.type !== "signal.text") {
      throw new Error("Expected a message");
    }
    const input = {
      actor: member("reactor", "reactor-user", "human"),
      author: member("author", "author-user", "human"),
      emoji: "👍",
      nowMs: 9000,
      organizationId: "org-1",
      signal,
      spaceName: "Planning",
      threadRootSignalId: "old-root",
      version: 4,
    };
    const record = buildSpaceReactionInboxProjectionOutboxRecord(input);
    expect(record?.candidates).toEqual([
      expect.objectContaining({
        recipientUserId: "author-user",
        attention: "update",
        importance: "normal",
        kind: "space_message",
        occurredAtMs: 9000,
        sourceTarget: {
          kind: "space",
          spaceId: "space-1",
          signalId: "signal-1",
          threadRootSignalId: "old-root",
        },
      }),
    ]);
    expect(buildSpaceReactionInboxProjectionOutboxRecord(input)).toEqual(
      record
    );
    expect(
      buildSpaceReactionInboxProjectionOutboxRecord({ ...input, version: 6 })
        ?.projectionId
    ).not.toBe(record?.projectionId);
    expect(
      buildSpaceReactionInboxProjectionOutboxRecord({
        ...input,
        actor: input.author,
      })
    ).toBeNull();
    expect(
      buildSpaceReactionInboxProjectionOutboxRecord({
        ...input,
        author: { ...input.author, status: "removed" },
      })
    ).toBeNull();
  });
  it.each([
    true,
    false,
  ])("notifies the replying Agent's absent owner in DM=%s even without a human requester", async (directMessage) => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("agent", "owner", "agent"),
        member("other-agent", "other-owner", "agent"),
      ],
      directMessage,
      nowMs: 2000,
      organizationId: "org-1",
      spaceName: "Design review",
      signal: textSignal({
        authorKind: "agent",
        authorName: "Design Agent",
        authorProfileId: "agent",
        text: "The review is ready.",
      }),
    });
    expect(record?.candidates).toEqual([
      expect.objectContaining({
        recipientUserId: "owner",
        kind: "agent_reply",
        importance: "normal",
        sourceTarget: expect.objectContaining({
          agentOwnerActivity: true,
          directMessage,
          signalId: "signal-1",
        }),
      }),
      ...(directMessage
        ? [
            expect.objectContaining({
              recipientUserId: "other-owner",
              sourceFacts: expect.objectContaining({
                recipientReasons: ["agent_owner"],
              }),
              sourceTarget: expect.objectContaining({
                agentOwnerActivity: true,
                directMessage: true,
              }),
            }),
          ]
        : []),
    ]);
    expect(
      await selectSpaceInboxRecipients(
        record?.candidates ?? [],
        async () => false
      )
    ).toEqual([]);
  });

  it.each([
    "owner",
    "requester",
  ])("keeps one owner reply item when %s Wakes the Agent", async (wakeRequesterUserId) => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("owner-human", "owner", "human"),
        member("requester-human", "requester", "human"),
        member("agent", "owner", "agent"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      spaceName: "Review",
      wakeRequesterUserId,
      threadParticipantProfileIds:
        wakeRequesterUserId === "owner"
          ? ["owner-human", "agent"]
          : ["owner-human", "requester-human", "agent"],
      signal: textSignal({
        authorKind: "agent",
        authorName: "Design Agent",
        authorProfileId: "agent",
        text: "Done.",
      }),
      signalContext: {
        threadContext: { rootSignalId: "thread-root", threadId: "thread-1" },
        threadPlacement: "thread",
      },
    });
    const candidates = await selectSpaceInboxRecipients(
      record?.candidates ?? [],
      async () => true
    );
    expect(
      candidates.filter((item) => item.recipientUserId === "owner")
    ).toEqual([
      expect.objectContaining({
        kind: "agent_reply",
        importance: "normal",
        sourceTarget: expect.objectContaining({
          threadRootSignalId: "thread-root",
        }),
      }),
    ]);
    expect(candidates.map((item) => item.recipientUserId).sort()).toEqual(
      wakeRequesterUserId === "owner" ? ["owner"] : ["owner", "requester"]
    );
  });
  it("keeps personal-Agent awareness ordinary for delivery and preserves normal recipients for managed Agents", async () => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("author", "sender", "human"),
        member("agent", "owner", "agent"),
        member("agent-2", "owner", "agent"),
      ],
      directMessage: true,
      nowMs: 2000,
      organizationId: "org-1",
      spaceName: "Chat",
      signal: textSignal({
        authorKind: "human",
        authorName: "Alex",
        authorProfileId: "author",
        authorHasRead: true,
        text: "Hello",
      }),
    });
    expect(record?.candidates).toHaveLength(1);
    expect(record?.candidates[0]).toMatchObject({
      recipientUserId: "owner",
      kind: "space_message",
      importance: "normal",
      sourceTarget: {
        agentOwnerActivity: true,
        directMessage: true,
        signalId: "signal-1",
      },
    });
    expect(
      await selectSpaceInboxRecipients(
        record?.candidates ?? [],
        async () => false
      )
    ).toEqual([]);
    const owner = record?.candidates[0];
    if (!owner) {
      throw new Error("Expected an owner activity candidate");
    }
    const ordinary = {
      ...owner,
      importance: "normal" as const,
      sourceTarget: {
        kind: "space" as const,
        spaceId: "space-1",
        signalId: "signal-1",
      },
    };
    expect(
      await selectSpaceInboxRecipients([ordinary, owner], async () => true)
    ).toEqual([owner]);
    expect(
      await selectSpaceInboxRecipients([ordinary, owner], async () => false)
    ).toEqual([ordinary]);
  });
  it("keeps an unconfirmed Human author's CLI update unread without turning self references into notifications", () => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-author", "user-author", "human"),
        member("profile-alias", "user-author", "human"),
        member("profile-reader", "user-reader", "human"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal: textSignal({
        authorKind: "human",
        authorName: "Alex Author",
        authorProfileId: "profile-author",
        mentionTargets: ["profile-alias", "profile-reader"],
        text: "The planning notes are ready for review.",
      }),
      signalContext: {
        threadContext: { rootSignalId: "root-1", threadId: "thread-1" },
        threadPlacement: "thread",
      },
      threadRootAuthorUserId: "user-author",
      threadParticipantProfileIds: ["profile-author", "profile-reader"],
      spaceName: "Planning",
    });
    expect(record?.candidates).toEqual([
      expect.objectContaining({
        recipientUserId: "user-author",
        kind: "space_message",
        importance: "normal",
        title: "New message in Planning",
        sourceTarget: {
          kind: "space",
          spaceId: "space-1",
          signalId: "signal-1",
          threadRootSignalId: "root-1",
        },
      }),
      expect.objectContaining({
        recipientUserId: "user-reader",
        kind: "space_mention",
      }),
    ]);
  });

  it("decodes a persisted rollout-only Human Reference before retrying the outbox", () => {
    const legacyCandidate = {
      ...candidate("user-1"),
      kind: "space_reference",
    };
    const sql = {
      exec() {
        return {
          toArray: () => [
            {
              attempt_count: 0,
              candidates_json: JSON.stringify([legacyCandidate]),
              completed_at_ms: null,
              created_at_ms: 1000,
              last_error_code: null,
              next_retry_at_ms: null,
              projection_id: "signal-1",
              signal_id: "signal-1",
              space_id: "space-1",
              status: "pending",
              updated_at_ms: 1000,
            },
          ],
        };
      },
    } as unknown as SqlStorage;

    expect(
      listDueSpaceInboxProjectionOutboxRecords(sql, {
        limit: 10,
        nowMs: 2000,
      })[0]?.candidates[0]?.kind
    ).toBe("space_mention");
  });

  it("truncates Inbox copy without splitting a surrogate pair", () => {
    const truncated = truncateInboxText("aa😀tail", 4);

    expect(truncated).toBe("aa…");
    expect(truncated.length).toBeLessThanOrEqual(4);
  });

  it("keeps Inbox on its own sanitizer contract when Space status is bounded separately", () => {
    const text = "a".repeat(400);
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-author", "user-author", "human"),
        member("profile-reader", "user-reader", "human"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      signal: textSignal({
        authorKind: "human",
        authorName: "Alex Author",
        authorProfileId: "profile-author",
        text,
      }),
      spaceName: "Launch Room",
    });

    expect(record?.candidates).toEqual([
      expect.objectContaining({
        preview: sanitizeSignalTextPreview(text),
        recipientUserId: "user-author",
      }),
      expect.objectContaining({
        preview: sanitizeSignalTextPreview(text),
        recipientUserId: "user-reader",
      }),
    ]);
  });

  it("projects exact thread targets, Human Mention priority, and active human visibility without notifying a confirmed author", () => {
    const signal = textSignal({
      authorKind: "human",
      authorName: "Alex Author",
      authorProfileId: "profile-author",
      authorHasRead: true,
      mentionTargets: ["profile-referenced"],
      text: "Please review the updated launch notes.",
    });
    const record = buildSpaceInboxProjectionOutboxRecord({
      threadParticipantProfileIds: [
        "profile-author",
        "profile-referenced",
        "profile-second",
        "profile-agent",
      ],
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
        kind: "space_mention",
        recipientUserId: "user-referenced",
        sourceKey: "signal-1",
        sourceTarget: {
          kind: "space",
          signalId: "signal-1",
          spaceId: "space-1",
          threadRootSignalId: "signal-root",
        },
        title: "Alex Author mentioned you in Launch Room",
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

  it("keeps managed Agent replies unread for Human members after owner eligibility is checked", async () => {
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

    expect(
      await selectSpaceInboxRecipients(
        record?.candidates ?? [],
        async () => false
      )
    ).toEqual([
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-human",
        title: "Center Agent replied in Operations",
      }),
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-observer",
        importance: "normal",
      }),
    ]);
  });

  it.each([
    "user-sender",
    "user-root",
  ])("marks a Human reply only for another member's thread root (%s)", (authorUserId) => {
    const record = buildSpaceInboxProjectionOutboxRecord({
      activeMemberRecords: [
        member("profile-root", "user-root", "human"),
        member("profile-sender", authorUserId, "human"),
        member("profile-participant", "user-participant", "human"),
        member("profile-observer", "user-observer", "human"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      spaceName: "Planning",
      signal: textSignal({
        authorKind: "human",
        authorName: "Human sender",
        authorProfileId: "profile-sender",
        text: "Here is the answer.",
      }),
      signalContext: {
        threadContext: { rootSignalId: "signal-root", threadId: "thread-1" },
        threadPlacement: "thread",
      },
      threadRootAuthorUserId: "user-root",
      threadParticipantProfileIds: [
        "profile-root",
        "profile-sender",
        "profile-participant",
      ],
    });
    const recipients = record?.candidates ?? [];
    const root = recipients.find(
      (item) => item.recipientUserId === "user-root"
    );
    expect(root).toMatchObject({
      kind: "space_message",
      attention: "update",
      importance: "normal",
      sourceTarget: { signalId: "signal-1", threadRootSignalId: "signal-root" },
    });
    if (authorUserId !== "user-root") {
      expect(root?.sourceTarget).toMatchObject({ replyToRecipient: true });
    } else {
      expect(root?.sourceTarget).not.toHaveProperty("replyToRecipient");
    }
    expect(
      recipients
        .filter((item) => item.recipientUserId !== "user-root")
        .every((item) => !("replyToRecipient" in item.sourceTarget))
    ).toBe(true);
    expect(
      recipients.some((item) => item.recipientUserId === "user-observer")
    ).toBe(false);
  });

  it("delivers an agent reply to the requester, Human Mentions, and thread target without broadcasting", () => {
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
        mentionTargets: ["profile-referenced"],
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
      threadParticipantProfileIds: [
        "profile-requester",
        "profile-referenced",
        "profile-thread-author",
        "profile-agent",
      ],
      wakeRequesterUserId: "user-requester",
    });

    expect(record?.candidates).toEqual([
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-requester",
      }),
      expect.objectContaining({
        kind: "space_mention",
        recipientUserId: "user-referenced",
      }),
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-thread-author",
      }),
      expect.objectContaining({
        kind: "agent_reply",
        recipientUserId: "user-agent-owner",
        sourceTarget: expect.objectContaining({ agentOwnerActivity: true }),
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

  it("delivers a terminal Wake failure to members with urgency only for the exact requester", () => {
    const signal = systemNoticeSignal({
      noticeType: "terminal_failure",
      replyToSignalId: "signal-wake-source",
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
        attention: "update",
        importance: "urgent",
        kind: "wake_outcome",
        preview: "The Wake could not finish.",
        recipientUserId: "user-requester",
        sourceTarget: {
          kind: "space",
          signalId: "signal-wake-source",
          spaceId: "space-1",
        },
        title: "Agent couldn't finish in Operations",
      }),
      expect.objectContaining({
        recipientUserId: "user-observer",
        attention: "update",
        importance: "normal",
        kind: "wake_outcome",
      }),
    ]);
  });

  it.each([
    "policy_blocked",
    "stay_silent",
  ] as const)("delivers a %s Wake ending to conversation members as an ordinary update", (noticeType) => {
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
      expect.objectContaining({
        recipientUserId: "user-observer",
        importance: "normal",
        kind: "wake_outcome",
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
  ] as const)("delivers a %s final status to conversation members", (status) => {
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
      expect.objectContaining({
        recipientUserId: "user-observer",
        importance: "normal",
        kind: "wake_outcome",
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
    const sql = createProjectionSqlDouble((statement) =>
      statements.push(statement)
    );
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
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        ensureItem,
        isRecipientEligible: vi.fn().mockResolvedValue(true),
        nowMs: 2000,
        record,
        sql,
      })
    ).resolves.toMatchObject({ status: "failed", nextRetryAtMs: 4000 });
    const replay = await attemptSpaceInboxProjectionOutboxRecord({
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
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

  it("normalizes a legacy terminal-failure action from the durable outbox before delivery", async () => {
    const record: SpaceInboxProjectionOutboxRecord = {
      attemptCount: 0,
      candidates: [
        {
          ...candidate("user-1"),
          attention: "action_required",
          importance: "urgent",
          kind: "wake_outcome",
        },
      ],
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
    const sql = createProjectionSqlDouble();
    const ensureItem = vi.fn().mockResolvedValue({
      deliveryId: "delivery-1",
      itemId: "item-1",
    });

    await expect(
      attemptSpaceInboxProjectionOutboxRecord({
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        ensureItem,
        isRecipientEligible: vi.fn().mockResolvedValue(true),
        nowMs: 2000,
        record,
        sql,
      })
    ).resolves.toMatchObject({ status: "completed" });

    expect(ensureItem).toHaveBeenCalledWith({
      candidate: expect.objectContaining({
        attention: "update",
        importance: "urgent",
        kind: "wake_outcome",
        sourceTarget: {
          kind: "space",
          spaceId: "space-1",
        },
      }),
      db: expect.any(PostgresDatabase),
      nowMs: 2000,
    });
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
    const sql = createProjectionSqlDouble();
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
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
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
      db: expect.any(PostgresDatabase),
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
    const sql = createProjectionSqlDouble((statement, bindings) =>
      executions.push({ bindings, statement })
    );
    const ensureItem = vi.fn(({ candidate: item }) => {
      return item.recipientUserId === "user-poison"
        ? Promise.reject(new Error("recipient no longer exists"))
        : Promise.resolve({
            deliveryId: null,
            itemId: `item-${item.recipientUserId}`,
          });
    });

    const result = await attemptSpaceInboxProjectionOutboxRecord({
      db: new PostgresDatabase({
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      }),
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

  it("addresses an unthreaded Agent DM reply to its human member without a Wake correlation", () => {
    const input = {
      activeMemberRecords: [
        member("human", "reader", "human"),
        member("agent", "owner", "agent"),
      ],
      nowMs: 2000,
      organizationId: "org-1",
      spaceName: "Private chat",
      signal: textSignal({
        authorKind: "agent",
        authorName: "Agent",
        authorProfileId: "agent",
        text: "Here is the result.",
      }),
    };
    expect(buildSpaceInboxProjectionOutboxRecord(input)?.candidates).toEqual([
      expect.objectContaining({
        recipientUserId: "reader",
        kind: "agent_reply",
        importance: "normal",
      }),
      expect.objectContaining({
        recipientUserId: "owner",
        kind: "agent_reply",
      }),
    ]);
    const record = buildSpaceInboxProjectionOutboxRecord({
      ...input,
      directMessage: true,
    });
    expect(record?.candidates).toEqual([
      expect.objectContaining({
        recipientUserId: "reader",
        kind: "agent_reply",
        importance: "normal",
        sourceTarget: expect.objectContaining({ directMessage: true }),
      }),
      expect.objectContaining({
        recipientUserId: "owner",
        kind: "agent_reply",
        importance: "normal",
      }),
    ]);
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
    const sql = createProjectionSqlDouble();
    const ensureItem = vi.fn().mockResolvedValue({
      deliveryId: null,
      itemId: "item-active",
    });

    await expect(
      attemptSpaceInboxProjectionOutboxRecord({
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
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
    const spaces = (
      env as unknown as { OPENMELD_SPACES: DurableObjectNamespace }
    ).OPENMELD_SPACES;
    const id = spaces.newUniqueId();
    await runInDurableObject(spaces.get(id), async (instance, state) => {
      signal.spaceId = id.toString();
      upsertSpaceMetaRecord(state.storage.sql, {
        v: 1,
        spaceId: signal.spaceId,
        organizationId: "org-1",
        visibility: "private",
        accessMode: "public",
        name: "Alarm recovery",
        createdAt: new Date(1000).toISOString(),
        updatedAt: new Date(1000).toISOString(),
      });
      upsertSpaceMemberRecord(
        state.storage.sql,
        member("profile-author", "user-author", "human")
      );
      const target = Object.defineProperties(
        Object.create(instance),
        Object.getOwnPropertyDescriptors({
          agentStreamProjectionStorage: undefined,
          assertRemoteAgentFinalReplyWasNotStopped: vi.fn(),
          broadcastSignal: vi.fn(),
          ctx: {
            storage: {
              sql: state.storage.sql,
              getAlarm: vi.fn().mockResolvedValue(null),
              setAlarm: vi
                .fn()
                .mockRejectedValue(new Error("alarm unavailable")),
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
          spaceId: signal.spaceId,
          syncSpaceBackgroundAlarm: vi
            .fn()
            .mockRejectedValue(new Error("alarm unavailable")),
        })
      );

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
    });
    warn.mockRestore();
  });
});

// These existing orchestration tests replace storage to inspect write intent.
// Real SQLite identity, rollback and retry coverage lives in the Node boundary suite.
function createProjectionSqlDouble(
  onExec?: (statement: string, bindings: unknown[]) => void
): SqlStorage {
  const selections = new Map<string, string>();
  return {
    exec(statement: string, ...bindings: unknown[]) {
      onExec?.(statement, bindings);
      const key = JSON.stringify(bindings.slice(0, 2));
      if (
        statement.includes(
          "INSERT OR IGNORE INTO space_inbox_projection_selections"
        ) &&
        !selections.has(key)
      ) {
        selections.set(key, String(bindings[2]));
      }
      const selection = statement.includes(
        "SELECT candidate_json FROM space_inbox_projection_selections"
      )
        ? selections.get(key)
        : undefined;
      return {
        rowsWritten: 1,
        toArray: () => (selection ? [{ candidate_json: selection }] : []),
      };
    },
  } as unknown as SqlStorage;
}

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
  authorHasRead?: true;
  authorKind: "agent" | "human";
  authorName: string;
  authorProfileId: string;
  purpose?: string;
  mentionTargets?: string[];
  referenceTargets?: string[];
  replyToSignalId?: string;
  text: string;
}): SignalEnvelope {
  return {
    data: {
      meta: {
        ...(input.purpose ? { purpose: input.purpose } : {}),
        ...(input.authorHasRead ? { authorHasRead: true as const } : {}),
      },
      messageEnvelope: {
        activationTargets: [],
        mentionTargets: input.mentionTargets ?? [],
        referenceTargets: input.referenceTargets ?? [],
        ...(input.replyToSignalId
          ? { replyToSignalId: input.replyToSignalId }
          : {}),
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
  replyToSignalId?: string;
  text: string;
}): SignalEnvelope {
  return {
    data: {
      actorProfileId: "profile-agent",
      dispatchId: "dispatch-1",
      generatedBy: "openmeld",
      noticeType: input.noticeType,
      ...(input.replyToSignalId
        ? {
            replyTo: {
              profileId: "profile-requester",
              profileKind: "human" as const,
              profileName: "Requester",
              previewText: "Wake request",
              signalId: input.replyToSignalId,
            },
          }
        : {}),
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
