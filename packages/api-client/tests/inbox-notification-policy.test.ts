import type { InboxItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { isInboxNotificationEligible } from "../src/inbox/notification-policy";

const item: InboxItem & {
  sourceFacts: NonNullable<InboxItem["sourceFacts"]>;
  sourceTarget: Extract<InboxItem["sourceTarget"], { kind: "space" }>;
} = {
  id: "item",
  organizationId: "org",
  recipientUserId: "owner",
  title: "Monica contacted Codex",
  preview: "A new message",
  contextLabel: "Design",
  kind: "space_message",
  attention: "update",
  importance: "normal",
  sourceTarget: {
    kind: "space",
    spaceId: "space",
    signalId: "signal",
    agentOwnerActivity: true,
    directMessage: true,
  },
  sourceFacts: {
    version: 1,
    recipientReasons: ["agent_owner"],
    agentProfileIds: ["codex"],
    personalAgentProfileIds: ["codex"],
  },
  readAt: null,
  resolutionStatus: "not_applicable",
  createdAt: "2026-09-18T00:00:00Z",
  updatedAt: "2026-09-18T00:00:00Z",
  occurredAt: "2026-09-18T00:00:00Z",
};

describe("source-owned Inbox delivery eligibility", () => {
  it.each([
    "space",
    "center_agent",
  ] as const)("delivers an incoming %s DM without an explicit mention, but honors mute", (kind) => {
    const directMessage: InboxItem = {
      ...item,
      kind: "space_message",
      sourceTarget:
        kind === "space"
          ? { kind, spaceId: "space", signalId: "signal", directMessage: true }
          : { kind, spaceId: "space", signalId: "signal" },
      sourceFacts: {
        ...item.sourceFacts,
        recipientReasons: ["direct_message"],
      },
    };
    expect(isInboxNotificationEligible(directMessage)).toBe(true);
    expect(isInboxNotificationEligible(directMessage, "muted")).toBe(false);
  });
  it.each([
    "mentions_and_replies",
    "all_messages",
  ] as const)("does not repeatedly interrupt an owner observer under %s", (mode) => {
    expect(isInboxNotificationEligible(item, mode)).toBe(false);
    // Delayed pre-upgrade outbox items lack sourceFacts, including retired
    // urgent awareness. They must not bypass quieting through DM or all_messages.
    expect(
      isInboxNotificationEligible({ ...item, sourceFacts: undefined }, mode)
    ).toBe(false);
    expect(
      isInboxNotificationEligible(
        { ...item, sourceFacts: undefined, importance: "urgent" },
        mode
      )
    ).toBe(false);
    expect(
      isInboxNotificationEligible(
        { ...item, sourceFacts: undefined, kind: "agent_reply" },
        mode
      )
    ).toBe(false);
    expect(
      isInboxNotificationEligible({ ...item, kind: "agent_reply" }, mode)
    ).toBe(false);
    expect(
      isInboxNotificationEligible(
        {
          ...item,
          sourceFacts: {
            ...item.sourceFacts,
            firstContactAgentProfileIds: ["codex"],
          },
        },
        mode
      )
    ).toBe(true);
  });
  it("keeps an explicit Human mention or reply independent of the owner relationship and saved mute", () => {
    const mention = {
      ...item,
      kind: "space_mention" as const,
      sourceFacts: {
        ...item.sourceFacts,
        recipientReasons: ["agent_owner", "human_mention"] as const,
      },
    };
    expect(
      isInboxNotificationEligible({
        ...mention,
        sourceFacts: {
          ...mention.sourceFacts,
          recipientReasons: [...mention.sourceFacts.recipientReasons],
        },
      })
    ).toBe(true);
    const reply = {
      ...item,
      sourceTarget: {
        ...item.sourceTarget,
        kind: "space" as const,
        spaceId: "space",
        replyToRecipient: true,
      },
      sourceFacts: {
        ...item.sourceFacts,
        recipientReasons: ["agent_owner", "thread_reply"] as (
          | "agent_owner"
          | "thread_reply"
        )[],
      },
    };
    expect(isInboxNotificationEligible(reply)).toBe(true);
    expect(
      isInboxNotificationEligible({ ...mention, sourceFacts: undefined })
    ).toBe(true);
    expect(
      isInboxNotificationEligible({ ...reply, sourceFacts: undefined })
    ).toBe(true);
    expect(
      isInboxNotificationEligible({ ...reply, sourceFacts: undefined }, "muted")
    ).toBe(false);
    expect(
      isInboxNotificationEligible({
        ...item,
        sourceFacts: undefined,
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "human-dm",
          directMessage: true,
        },
      })
    ).toBe(true);
    expect(
      isInboxNotificationEligible({
        ...item,
        kind: "wake_outcome",
        sourceFacts: undefined,
        importance: "urgent",
      })
    ).toBe(true);
    expect(isInboxNotificationEligible(reply, "muted")).toBe(false);
    expect(
      isInboxNotificationEligible(
        {
          ...item,
          sourceFacts: {
            ...item.sourceFacts,
            firstContactAgentProfileIds: ["codex"],
          },
        },
        "muted"
      )
    ).toBe(false);
  });
  it("keeps ordinary requests eligible without making Desktop updates interruptive", () => {
    expect(
      isInboxNotificationEligible({
        ...item,
        attention: "action_required",
        resolutionStatus: "open",
      })
    ).toBe(true);
    expect(
      isInboxNotificationEligible({
        ...item,
        kind: "desktop_update",
        importance: "urgent",
        sourceTarget: {
          kind: "desktop_update",
          installationId: "device",
          lane: "prod",
          deviceName: "Mac",
          version: "0.1.4",
          platform: "darwin",
          state: "available",
        },
      })
    ).toBe(false);
  });
});
