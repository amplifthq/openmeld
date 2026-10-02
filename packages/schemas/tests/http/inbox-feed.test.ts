import { describe, expect, it } from "vitest";
import {
  inboxFeedQuerySchema,
  mutateInboxFeedBodySchema,
} from "../../src/schemas/http/inbox-feed";

describe("Inbox attention query contracts", () => {
  it("keeps category, unread and Agent relevance independent", () => {
    expect(
      inboxFeedQuerySchema.parse({
        category: "mentions",
        unreadOnly: "false",
        agentsOnly: "true",
        limit: "20",
      })
    ).toEqual({
      category: "mentions",
      unreadOnly: "false",
      agentsOnly: "true",
      limit: 20,
    });
    for (const query of [
      { category: "agents" },
      { recipientUserId: "other" },
      { organizationId: "other" },
      { unreadOnly: "sometimes" },
      { limit: 101 },
      { cursor: "x".repeat(8193) },
    ]) {
      expect(inboxFeedQuerySchema.safeParse(query).success).toBe(false);
    }
  });
  it("requires a server-issued selection and rejects open-ended bulk-write fields", () => {
    expect(
      mutateInboxFeedBodySchema.safeParse({
        snapshotId: "snapshot",
        groupKey: "Z3JvdXA",
        operation: "read",
      }).success
    ).toBe(true);
    for (const input of [
      { operation: "read" },
      { snapshotId: "snapshot", operation: "approve" },
      { snapshotId: "snapshot", operation: "dismiss", itemIds: ["arbitrary"] },
      {
        snapshotId: "snapshot",
        operation: "read",
        throughOccurredAtMs: 999_999,
      },
    ]) {
      expect(mutateInboxFeedBodySchema.safeParse(input).success).toBe(false);
    }
  });
});
