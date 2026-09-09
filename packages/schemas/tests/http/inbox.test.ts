import { describe, expect, it } from "vitest";
import {
  authRpcSendInboxUrgentEmailInputSchema,
  dismissInboxItemResponseSchema,
  INBOX_SPACE_SUMMARY_MAX_SPACES,
  inboxItemSchema,
  inboxSourceCandidateSchema,
  inboxSourceKindSchema,
  listInboxItemsQuerySchema,
  markInboxItemReadBodySchema,
  markSpaceInboxReadThroughBodySchema,
  spaceInboxSummaryResponseSchema,
  spaceInboxUnreadTargetsResponseSchema,
} from "../../src/schemas";

const item = {
  attention: "action_required",
  contextLabel: "Build failures",
  createdAt: "2026-08-04T01:02:03.000Z",
  id: "inbox_item_1",
  importance: "urgent",
  kind: "agent_interaction",
  occurredAt: "2026-08-04T01:00:00.000Z",
  organizationId: "org_1",
  preview: "The agent needs approval to continue.",
  readAt: null,
  recipientUserId: "user_1",
  resolutionStatus: "open",
  sourceTarget: {
    interactionId: "interaction_1",
    kind: "agent_interaction",
    runtimeCoordinatorExecutionId: "runtime_1",
    sourceSignalId: "signal_1",
    spaceId: "space_1",
    threadRootSignalId: "thread_root_1",
  },
  title: "Approval required",
  updatedAt: "2026-08-04T01:02:03.000Z",
} as const;

describe("Inbox HTTP contracts", () => {
  it("accepts the canonical member-private item shape", () => {
    expect(inboxItemSchema.parse(item)).toEqual(item);
  });

  it("normalizes the rollout-only Human Reference kind to Human Mention", () => {
    expect(
      inboxItemSchema.parse({
        ...item,
        kind: "space_reference",
      }).kind
    ).toBe("space_mention");
  });

  it("normalizes rollout-only Human Reference outbox candidates before retry", () => {
    expect(
      inboxSourceCandidateSchema.parse({
        attention: "update",
        contextLabel: "Launch Room",
        importance: "normal",
        kind: "space_reference",
        occurredAtMs: 1000,
        organizationId: "org_1",
        preview: "Please review the launch notes.",
        recipientUserId: "user_1",
        sourceKey: "space_1:signal_1:user_1",
        sourceKind: "space_signal",
        sourceTarget: {
          kind: "space",
          signalId: "signal_1",
          spaceId: "space_1",
        },
        title: "Alex mentioned you",
      }).kind
    ).toBe("space_mention");
  });

  it("distinguishes an exact Agent Interaction thread from legacy unknown context", () => {
    expect(
      inboxItemSchema.parse({
        ...item,
        sourceTarget: {
          ...item.sourceTarget,
          threadRootSignalId: null,
        },
      }).sourceTarget
    ).toMatchObject({ threadRootSignalId: null });
    expect(
      inboxItemSchema.safeParse({
        ...item,
        sourceTarget: {
          interactionId: "interaction_legacy",
          kind: "agent_interaction",
          runtimeCoordinatorExecutionId: "runtime_legacy",
          sourceSignalId: "signal_legacy",
          spaceId: "space_1",
        },
      }).success
    ).toBe(true);
  });

  it("accepts the minimal Agent Profile recovery target without copying work details", () => {
    expect(inboxSourceKindSchema.parse("agent_profile_work_recovery")).toBe(
      "agent_profile_work_recovery"
    );
    expect(
      inboxItemSchema.parse({
        ...item,
        kind: "system_issue",
        sourceTarget: {
          kind: "agent_profile",
          profileId: "profile_1",
        },
      })
    ).toMatchObject({
      kind: "system_issue",
      sourceTarget: { kind: "agent_profile", profileId: "profile_1" },
    });
    expect(
      inboxItemSchema.safeParse({
        ...item,
        kind: "system_issue",
        sourceTarget: {
          kind: "agent_profile",
          profileId: "profile_1",
          queuedTaskIds: ["private-task_1"],
        },
      }).success
    ).toBe(false);
  });

  it("accepts an exact Message Channel target after its receivers are deployed", () => {
    expect(
      inboxItemSchema.parse({
        ...item,
        sourceTarget: {
          channelId: "C0123456",
          kind: "message_channel",
          messageId: "1720000000.000200",
          permalink:
            "https://amplift.slack.com/archives/C0123456/p1720000000000200?thread_ts=1720000000.000100&cid=C0123456",
          provider: "slack",
          teamId: "T0123456",
          threadRootMessageId: "1720000000.000100",
        },
      })
    ).toMatchObject({
      sourceTarget: {
        kind: "message_channel",
        messageId: "1720000000.000200",
        provider: "slack",
      },
    });
  });

  it("rejects an unsafe Message Channel permalink", () => {
    expect(
      inboxItemSchema.safeParse({
        ...item,
        sourceTarget: {
          channelId: "C0123456",
          kind: "message_channel",
          messageId: "1720000000.000200",
          permalink: "https://evil.test/pretend-slack-message",
          provider: "slack",
          teamId: "T0123456",
          threadRootMessageId: "1720000000.000100",
        },
      }).success
    ).toBe(false);
  });

  it("fails closed without throwing for a malformed Message Channel permalink", () => {
    const parseMalformedPermalink = () =>
      inboxItemSchema.safeParse({
        ...item,
        sourceTarget: {
          channelId: "C0123456",
          kind: "message_channel",
          messageId: "1720000000.000200",
          permalink: "not a url",
          provider: "slack",
          teamId: "T0123456",
          threadRootMessageId: "1720000000.000100",
        },
      });

    expect(parseMalformedPermalink).not.toThrow();
    expect(parseMalformedPermalink().success).toBe(false);
  });

  it("keeps legacy Inbox targets readable before the new writer is deployed", () => {
    expect(
      inboxItemSchema.safeParse({
        ...item,
        kind: "center_agent_update",
        sourceTarget: {
          kind: "center_agent",
          signalId: "signal_1",
          spaceId: "space_1",
        },
      }).success
    ).toBe(true);
  });

  it("rejects unknown fields and unsupported source targets", () => {
    expect(
      inboxItemSchema.safeParse({ ...item, arbitraryUrl: "https://evil.test" })
        .success
    ).toBe(false);
    expect(
      inboxItemSchema.safeParse({
        ...item,
        sourceTarget: { kind: "url", url: "https://evil.test" },
      }).success
    ).toBe(false);
  });

  it("keeps update and action resolution semantics consistent", () => {
    expect(
      inboxItemSchema.safeParse({
        ...item,
        attention: "update",
        resolutionStatus: "open",
      }).success
    ).toBe(false);
    expect(
      inboxItemSchema.safeParse({
        ...item,
        attention: "action_required",
        resolutionStatus: "not_applicable",
      }).success
    ).toBe(false);
  });

  it("validates list filters and read mutations strictly", () => {
    expect(listInboxItemsQuerySchema.parse({ view: "needs_action" })).toEqual({
      view: "needs_action",
    });
    expect(
      listInboxItemsQuerySchema.safeParse({ view: "mentions" }).success
    ).toBe(false);
    expect(markInboxItemReadBodySchema.safeParse({ read: true }).success).toBe(
      true
    );
    expect(
      markInboxItemReadBodySchema.safeParse({ read: true, resolved: true })
        .success
    ).toBe(false);
  });

  it("keeps dismiss responses limited to the removed Inbox projection", () => {
    expect(
      dismissInboxItemResponseSchema.parse({
        dismissedItemId: "inbox_item_1",
      })
    ).toEqual({ dismissedItemId: "inbox_item_1" });
    expect(
      dismissInboxItemResponseSchema.safeParse({
        dismissedItemId: "inbox_item_1",
        resolvedSource: true,
      }).success
    ).toBe(false);
  });

  it("describes unread Inbox updates by Space without duplicating Space metadata", () => {
    expect(
      spaceInboxSummaryResponseSchema.parse({
        ordinarySpaceUnreadCount: 3,
        organizationId: "org_1",
        spaces: [
          {
            latestUnreadOccurredAtMs: 1_722_736_800_000,
            spaceId: "space_1",
            unreadCount: 3,
          },
        ],
      })
    ).toEqual({
      ordinarySpaceUnreadCount: 3,
      organizationId: "org_1",
      spaces: [
        {
          latestUnreadOccurredAtMs: 1_722_736_800_000,
          spaceId: "space_1",
          unreadCount: 3,
        },
      ],
    });
    expect(
      spaceInboxSummaryResponseSchema.parse({
        organizationId: "org_1",
        spaces: [],
      })
    ).toEqual({ organizationId: "org_1", spaces: [] });
    expect(
      spaceInboxSummaryResponseSchema.safeParse({
        organizationId: "org_1",
        spaces: [
          {
            latestUnreadOccurredAtMs: 1_722_736_800_000,
            spaceId: "space_1",
            spaceName: "Launch Room",
            unreadCount: 3,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      spaceInboxSummaryResponseSchema.safeParse({
        organizationId: "org_1",
        spaces: Array.from(
          { length: INBOX_SPACE_SUMMARY_MAX_SPACES + 1 },
          (_, index) => ({
            latestUnreadOccurredAtMs: index,
            spaceId: `space_${index}`,
            unreadCount: 1,
          })
        ),
      }).success
    ).toBe(false);
  });

  it("accepts only a bounded Space read-through watermark", () => {
    expect(
      markSpaceInboxReadThroughBodySchema.parse({
        spaceId: "space_1",
        throughOccurredAtMs: 1_722_736_800_000,
      })
    ).toEqual({
      spaceId: "space_1",
      throughOccurredAtMs: 1_722_736_800_000,
    });
    expect(
      markSpaceInboxReadThroughBodySchema.parse({
        spaceId: "space_1",
        threadRootSignalId: "thread_root_1",
        throughOccurredAtMs: 1_722_736_800_000,
      })
    ).toEqual({
      spaceId: "space_1",
      threadRootSignalId: "thread_root_1",
      throughOccurredAtMs: 1_722_736_800_000,
    });
    expect(
      markSpaceInboxReadThroughBodySchema.safeParse({
        spaceId: "space_1",
        throughOccurredAtMs: -1,
      }).success
    ).toBe(false);
  });

  it("returns exact main and thread targets from the Space Inbox", () => {
    expect(
      spaceInboxUnreadTargetsResponseSchema.parse({
        hasMoreTargets: false,
        organizationId: "org_1",
        spaceId: "space_1",
        targets: [
          {
            occurredAtMs: 1000,
            signalId: "main_signal",
            threadRootSignalId: null,
          },
          {
            occurredAtMs: 1100,
            signalId: "thread_reply",
            threadRootSignalId: "thread_root",
          },
        ],
        totalUnreadCount: 2,
      })
    ).toMatchObject({ totalUnreadCount: 2 });
  });
});

describe("Inbox producer and email contracts", () => {
  it("accepts a bounded source candidate without recipient-authored HTML", () => {
    expect(
      inboxSourceCandidateSchema.parse({
        attention: "action_required",
        contextLabel: "Build failures",
        importance: "urgent",
        kind: "agent_interaction",
        occurredAtMs: 1_722_736_800_000,
        organizationId: "org_1",
        preview: "The agent needs approval to continue.",
        recipientUserId: "user_1",
        sourceKey: "runtime_1:interaction_1",
        sourceKind: "runtime_coordinator_interaction",
        sourceTarget: item.sourceTarget,
        title: "Approval required",
      })
    ).toMatchObject({ sourceKey: "runtime_1:interaction_1" });
  });

  it("keeps Auth email input limited to safe template variables", () => {
    const valid = {
      deliveryId: "delivery_1",
      itemId: "inbox_item_1",
      organizationId: "org_1",
      preview: "The agent needs approval to continue.",
      title: "Approval required",
      userId: "user_1",
    };
    expect(authRpcSendInboxUrgentEmailInputSchema.parse(valid)).toEqual(valid);
    expect(
      authRpcSendInboxUrgentEmailInputSchema.safeParse({
        ...valid,
        html: "<script>alert(1)</script>",
      }).success
    ).toBe(false);
  });
});
