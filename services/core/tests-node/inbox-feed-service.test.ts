import type {
  InboxFeedQuery,
  InboxFeedResponse,
  InboxSourceFacts,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { createInboxFeedService } from "../src/inbox/application/inbox-feed-service";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";

describe("canonical Inbox attention feed", () => {
  it("limits Thread reads to ordinary updates in the selected category, including when urgent replies share the Thread", async () => {
    const f = createInboxFeedFixture();
    try {
      const feed = createInboxFeedService({ db: f.db, nowMs: () => 11_000 });
      const sourceTarget = {
        kind: "space",
        spaceId: "space",
        signalId: "reply",
        threadRootSignalId: "root",
      } as const;
      await f.item("reply", { sourceTarget });
      await f.item("mention", {
        sourceTarget,
        kind: "space_mention",
        sourceFacts: { version: 1, recipientReasons: ["human_mention"] },
      });
      const urgent = await f.item("urgent", {
        sourceTarget,
        importance: "urgent",
      });
      const page = await feed.list(f.identity, {
        grouping: "space",
        category: "mentions",
      });
      const group = page.rows[0];
      if (!group) {
        throw new Error("Expected mentioned Space");
      }
      const threads = await feed.list(f.identity, {
        grouping: "space",
        category: "mentions",
        snapshotId: page.snapshotId,
        groupKey: group.groupKey,
      });
      const thread = threads.rows[0];
      if (!thread) {
        throw new Error("Expected mentioned Thread");
      }
      expect(thread.itemCount).toBe(1);
      expect(
        await feed.mutate(f.identity, {
          snapshotId: page.snapshotId,
          groupKey: thread.groupKey,
          operation: "read",
        })
      ).toEqual({ changedCount: 1 });
      const all = await feed.list(f.identity, { grouping: "space" });
      const ordinary = all.rows.find((row) => row.group?.kind === "space");
      if (!ordinary) {
        throw new Error("Expected ordinary Space");
      }
      const children = await feed.list(f.identity, {
        grouping: "space",
        snapshotId: all.snapshotId,
        groupKey: ordinary.groupKey,
      });
      const child = children.rows[0];
      if (!child) {
        throw new Error("Expected ordinary Thread");
      }
      expect(child.itemCount).toBe(2);
      expect(
        await feed.mutate(f.identity, {
          snapshotId: all.snapshotId,
          groupKey: child.groupKey,
          operation: "read",
        })
      ).toEqual({ changedCount: 1 });
      const remaining = await feed.list(f.identity, {
        grouping: "space",
        unreadOnly: "true",
      });
      expect(remaining.rows.map((row) => row.item.id)).toEqual([urgent.itemId]);
    } finally {
      f.close();
    }
  });
  it("groups a Space across pages, keeps Threads distinct, and reads only the frozen group", async () => {
    const f = createInboxFeedFixture();
    try {
      const feed = createInboxFeedService({ db: f.db, nowMs: () => 11_000 });
      for (let index = 0; index < 45; index += 1) {
        await f.item(`reply-${index}`, {
          occurredAtMs: 1000 + index,
          sourceTarget: {
            kind: "space",
            spaceId: "space",
            signalId: `reply-${index}`,
            threadRootSignalId: `thread-${index % 3}`,
          },
        });
      }
      const request = await f.item("question", {
        attention: "action_required",
        kind: "agent_interaction",
        sourceKind: "runtime_coordinator_interaction",
      });
      const result = await feed.list(f.identity, {
        grouping: "space",
        limit: 1,
      });
      expect(result.rows[0]?.item.id).toBe(request.itemId);
      if (!result.nextCursor) {
        throw new Error("Expected another page");
      }
      const next = await feed.list(f.identity, {
        grouping: "space",
        limit: 1,
        cursor: result.nextCursor,
      });
      const group = next.rows[0];
      if (!group) {
        throw new Error("Expected the Space group");
      }
      expect(group).toMatchObject({
        itemCount: 45,
        unreadCount: 45,
        group: { kind: "space", conversationCount: 3 },
      });
      expect(next.nextCursor).toBeNull();
      const threads = await feed.list(f.identity, {
        grouping: "space",
        snapshotId: result.snapshotId,
        groupKey: group.groupKey,
      });
      expect(threads.rows).toHaveLength(3);
      expect(
        threads.rows.every(
          (row) => row.itemCount === 15 && row.group?.kind === "conversation"
        )
      ).toBe(true);
      const later = await f.item("later", {
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "later",
          threadRootSignalId: "thread-0",
        },
      });
      expect(
        await feed.mutate(f.identity, {
          snapshotId: result.snapshotId,
          groupKey: group.groupKey,
          operation: "read",
        })
      ).toEqual({ changedCount: 45 });
      const unread = await feed.list(f.identity, {
        grouping: "space",
        unreadOnly: "true",
      });
      expect(unread.counts.unread).toBe(2);
      expect(unread.rows.map((row) => row.item.id)).toEqual([
        request.itemId,
        later.itemId,
      ]);
      expect(
        (await feed.list(f.identity, { category: "needs_action" })).rows[0]
          ?.item.resolutionStatus
      ).toBe("open");
    } finally {
      f.close();
    }
  });

  it("groups ordinary system updates without absorbing an open request or an urgent outcome", async () => {
    const f = createInboxFeedFixture();
    try {
      const system = {
        kind: "system_issue",
        sourceKind: "system_attention_event",
        sourceTarget: { kind: "settings", section: "computers" },
      } as const;
      await f.item("installed-a", system);
      await f.item("installed-b", system);
      await f.item("repair", { ...system, attention: "action_required" });
      await f.item("failure", { ...system, importance: "urgent" });
      const feed = createInboxFeedService({ db: f.db, nowMs: () => 11_000 });
      const result = await feed.list(f.identity, { grouping: "space" });
      expect(result.rows).toHaveLength(3);
      const systemGroup = result.rows.find(
        (row) => row.group?.kind === "system"
      );
      if (!systemGroup) {
        throw new Error("Expected system updates");
      }
      expect(systemGroup).toMatchObject({
        itemCount: 2,
        unreadCount: 2,
        section: "activity",
      });
      await feed.mutate(f.identity, {
        snapshotId: result.snapshotId,
        groupKey: systemGroup.groupKey,
        operation: "read",
      });
      expect(
        (await feed.list(f.identity, { unreadOnly: "true" })).counts.unread
      ).toBe(2);
    } finally {
      f.close();
    }
  });

  it("shares priority and request categories with the unpaged summary while respecting read, first contact and mute facts", async () => {
    const f = createInboxFeedFixture();
    try {
      f.agent("codex");
      await f.item("first", {
        sourceFacts: facts(true),
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "first",
          agentOwnerActivity: true,
        },
      });
      const review = await f.item("review", {
        attention: "action_required",
        kind: "agent_interaction",
        sourceKind: "runtime_coordinator_interaction",
        sourceFacts: {
          version: 1,
          recipientReasons: ["requester"],
          requestCategory: "review",
        },
      });
      await f.item("answer", {
        attention: "action_required",
        kind: "agent_interaction",
        sourceKind: "runtime_coordinator_interaction",
        sourceFacts: {
          version: 1,
          recipientReasons: ["requester"],
          requestCategory: "action",
        },
      });
      f.run({
        sql: "INSERT INTO inbox_conversation_notification_preferences VALUES ('owner', 'org', 'space', 'muted')",
      });
      const service = createInboxService({
        db: f.db,
        includeAccountItems: true,
      });
      await service.markRead({
        ...f.identity,
        itemId: review.itemId,
        read: true,
      });
      const feed = await createInboxFeedService({ db: f.db }).list(f.identity);
      const summary = await service.summary({
        ...f.identity,
        presentation: "attention",
      });
      expect(summary).toMatchObject({
        priorityCount: 1,
        needsReviewCount: 1,
        needsActionCount: 1,
        unreadPriorityUpdateCount: 1,
      });
      expect(feed.counts).toMatchObject({
        priority: summary.priorityCount,
        needsReview: summary.needsReviewCount,
        needsAction: summary.needsActionCount,
      });
      expect(feed).not.toHaveProperty("selectionUnreadCount");
      const reviewSelection = await createInboxFeedService({ db: f.db }).list(
        f.identity,
        { category: "needs_review", includeSelectionUnreadCount: "true" }
      );
      expect(reviewSelection.counts.unread).toBeGreaterThan(0);
      expect(reviewSelection.selectionUnreadCount).toBe(0);
      const actionSelection = await createInboxFeedService({ db: f.db }).list(
        f.identity,
        { category: "needs_action", includeSelectionUnreadCount: "true" }
      );
      expect(actionSelection.selectionUnreadCount).toBe(1);
      expect(
        feed.rows.find((row) => row.item.id === review.itemId)
      ).toMatchObject({
        dot: null,
        section: "open",
        requestCategory: "review",
      });
      const legacy = await createInboxService({ db: f.db }).summary({
        ...f.identity,
        presentation: "attention",
      });
      expect(legacy).not.toHaveProperty("priorityCount");
    } finally {
      f.close();
    }
  });
  it("keeps an old priority request ahead of recent conversations across the full dataset and paging", async () => {
    const fixture = createInboxFeedFixture();
    try {
      const urgent = await fixture.item("old-request", {
        attention: "action_required",
        importance: "urgent",
        kind: "system_issue",
        sourceKind: "system_attention_event",
        sourceTarget: { kind: "settings", section: "computers" },
        occurredAtMs: 1,
      });
      const normal = await fixture.item("ordinary-request", {
        attention: "action_required",
        kind: "system_issue",
        sourceKind: "system_attention_event",
        sourceTarget: { kind: "settings", section: "computers" },
        occurredAtMs: 2,
      });
      for (let index = 0; index < 81; index += 1) {
        await fixture.item(`chat-${index}`, {
          occurredAtMs: 100 + index,
          sourceTarget: {
            kind: "space",
            spaceId: "space",
            signalId: `chat-${index}`,
            threadRootSignalId: `thread-${index}`,
          },
        });
      }
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      const first = await feed.list(fixture.identity, {
        limit: 2,
        includeSelectionUnreadCount: "true",
      });
      expect(first.selectionUnreadCount).toBe(83);
      expect(first.rows.map((row) => row.item.id)).toEqual([
        urgent.itemId,
        normal.itemId,
      ]);
      expect(first.rows.map((row) => [row.section, row.dot])).toEqual([
        ["priority", "yellow"],
        ["open", "blue"],
      ]);
      expect(first.counts).toMatchObject({
        all: 83,
        unread: 83,
        needsAction: 2,
        priority: 1,
      });
      const ids = await allIds(feed, fixture.identity, { limit: 7 });
      expect(new Set(ids).size).toBe(83);
      expect(ids.slice(0, 2)).toEqual([urgent.itemId, normal.itemId]);
    } finally {
      fixture.close();
    }
  });

  it("includes direct messages in mention attention while preserving strict legacy mentions", async () => {
    const fixture = createInboxFeedFixture();
    try {
      fixture.agent("codex");
      const human = await fixture.item("human-mention", {
        kind: "space_mention",
        sourceFacts: { version: 1, recipientReasons: ["human_mention"] },
      });
      await fixture.item("agent-reference", {
        sourceFacts: facts(),
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "agent-reference",
          agentOwnerActivity: true,
        },
      });
      await fixture.item("unmentioned-dm", {
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "unmentioned-dm",
          directMessage: true,
        },
      });
      fixture.run({
        sql: "UPDATE inbox_items SET read_at_ms = 10500 WHERE id = ?",
        params: [human.itemId],
      });
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      const mentions = await feed.list(fixture.identity, {
        category: "mentions",
      });
      expect(mentions.counts.mentions).toBe(3);
      expect(mentions.rows).toHaveLength(1);
      expect(mentions.rows[0]).toMatchObject({ itemCount: 3, unreadCount: 2 });
      expect(
        (
          await feed.list(fixture.identity, {
            category: "mentions",
            unreadOnly: "true",
          })
        ).counts.mentions
      ).toBe(2);
      expect(
        await createInboxService({ db: fixture.db }).summary({
          ...fixture.identity,
          presentation: "attention",
        })
      ).toMatchObject({ unreadMentionCount: 2, ordinaryUnreadCount: 0 });
      expect(
        (
          await createInboxService({ db: fixture.db }).list({
            ...fixture.identity,
            view: "mentions",
          })
        ).items
      ).toEqual([]);
      expect(
        (
          await feed.list(fixture.identity, {
            category: "mentions",
            agentsOnly: "true",
          })
        ).rows[0]?.itemCount
      ).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it("filters actual Agent events before grouping and paging, never mere Agent presence", async () => {
    const fixture = createInboxFeedFixture();
    try {
      fixture.agent("codex");
      for (let index = 0; index < 45; index += 1) {
        await fixture.item(`ordinary-${index}`, { occurredAtMs: 2000 + index });
      }
      const meaningful = await fixture.item("agent-answer", {
        kind: "agent_reply",
        sourceFacts: {
          version: 1,
          agentProfileIds: ["codex"],
          recipientReasons: ["space_member"],
        },
      });
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      const result = await feed.list(fixture.identity, {
        agentsOnly: "true",
        limit: 1,
      });
      expect(result.counts.all).toBe(1);
      expect(result.rows[0]?.item.id).toBe(meaningful.itemId);
      expect(result.rows[0]?.itemCount).toBe(1);
      expect(result.nextCursor).toBeNull();
      fixture.space("dm");
      fixture.run({
        sql: "UPDATE space_index_spaces SET direct_message_pair_key = 'human:other' WHERE space_id = 'dm'",
      });
      const dmTarget = {
        kind: "space",
        spaceId: "dm",
        directMessage: true,
      } as const;
      const humanDm = await fixture.item("human-dm", {
        sourceTarget: {
          ...dmTarget,
          signalId: "human-dm",
          threadRootSignalId: "one",
        },
      });
      const secondDm = await fixture.item("second-dm", {
        sourceTarget: {
          ...dmTarget,
          signalId: "second-dm",
          threadRootSignalId: "two",
        },
      });
      await fixture.item("agent-dm", {
        kind: "agent_reply",
        sourceTarget: dmTarget,
      });
      await fixture.item("computer", {
        kind: "system_issue",
        sourceKind: "system_attention_event",
        sourceTarget: { kind: "settings", section: "computers" },
      });
      const people = await feed.list(fixture.identity, { peopleOnly: "true" });
      expect(people.counts.all).toBe(47);
      const spaces = await feed.list(fixture.identity, {
        peopleOnly: "true",
        conversationType: "spaces",
      });
      expect(spaces.counts.all).toBe(45);
      const query = {
        peopleOnly: "true",
        conversationType: "direct_messages",
        limit: 1,
      } as const;
      const first = await feed.list(fixture.identity, query);
      expect(first.counts.all).toBe(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await feed.list(fixture.identity, {
        ...query,
        cursor: first.nextCursor ?? "",
      });
      expect(
        new Set([...first.rows, ...second.rows].map((row) => row.item.id))
      ).toEqual(new Set([humanDm.itemId, secondDm.itemId]));
      await expect(
        feed.list(fixture.identity, {
          ...query,
          conversationType: "spaces",
          cursor: first.nextCursor ?? "",
        })
      ).rejects.toMatchObject({ code: "inbox.cursor_invalid" });
      await fixture.item("late-dm", { sourceTarget: dmTarget });
      expect(
        await feed.mutate(fixture.identity, {
          snapshotId: first.snapshotId,
          operation: "read",
        })
      ).toEqual({ changedCount: 2 });
      const unread = await feed.list(fixture.identity, { unreadOnly: "true" });
      expect(unread.counts.all).toBe(49);
    } finally {
      fixture.close();
    }
  });

  it("keeps priority contact as the conversation anchor, but never combines Threads, requests, or failures", async () => {
    const fixture = createInboxFeedFixture();
    try {
      fixture.agent("codex");
      const first = await fixture.item("first-contact", {
        sourceFacts: facts(true),
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "first-contact",
          agentOwnerActivity: true,
        },
      });
      await fixture.item("newer-chat", { occurredAtMs: 2000 });
      await fixture.item("thread", {
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "thread",
          threadRootSignalId: "real-thread",
        },
      });
      await fixture.item("failure", {
        kind: "wake_outcome",
        importance: "urgent",
        sourceTarget: { kind: "space", spaceId: "space", signalId: "failure" },
      });
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      const result = await feed.list(fixture.identity);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toMatchObject({
        item: { id: first.itemId },
        itemCount: 2,
        section: "priority",
        dot: "yellow",
      });
      const group = result.rows[0];
      const children = await feed.list(fixture.identity, {
        snapshotId: result.snapshotId,
        groupKey: group?.groupKey,
      });
      expect(children.rows).toHaveLength(2);
      expect(children.rows.every((row) => row.item.readAt === null)).toBe(true);
      expect(
        fixture.queryFirst<{ n: number }>({
          sql: "SELECT count(*) AS n FROM inbox_items WHERE read_at_ms IS NOT NULL",
        })?.n
      ).toBe(0);
      await createInboxService({
        db: fixture.db,
        nowMs: () => 11_000,
      }).markRead({ ...fixture.identity, itemId: first.itemId, read: true });
      const after = await feed.list(fixture.identity);
      expect(
        after.rows.find((row) => row.item.title === "newer-chat")
      ).toMatchObject({ itemCount: 2, dot: "blue", section: "activity" });
    } finally {
      fixture.close();
    }
  });

  it("makes action and review mutually exclusive and resolves dots from business state rather than read state", async () => {
    const fixture = createInboxFeedFixture();
    try {
      const request = {
        attention: "action_required" as const,
        kind: "agent_interaction" as const,
        sourceKind: "runtime_coordinator_interaction" as const,
        sourceTarget: {
          kind: "agent_interaction" as const,
          spaceId: "space",
          interactionId: "approval",
          runtimeCoordinatorExecutionId: "execution",
        },
      };
      const review = await fixture.item("approval", {
        ...request,
        sourceFacts: {
          version: 1,
          recipientReasons: ["requester"],
          requestCategory: "review",
        },
      });
      const urgent = await fixture.item("blocked", {
        ...request,
        importance: "urgent",
      });
      const question = await fixture.item("question", { ...request });
      fixture.run({
        sql: "UPDATE inbox_items SET read_at_ms = 10500 WHERE id IN (?, ?, ?)",
        params: [review.itemId, urgent.itemId, question.itemId],
      });
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      expect(
        (
          await feed.list(fixture.identity, { category: "needs_review" })
        ).rows.map((row) => [row.item.id, row.dot])
      ).toEqual([[review.itemId, null]]);
      expect(
        (
          await feed.list(fixture.identity, { category: "needs_action" })
        ).rows.map((row) => row.item.id)
      ).toEqual([urgent.itemId, question.itemId]);
      expect(
        (await feed.list(fixture.identity)).rows.find(
          (row) => row.item.id === urgent.itemId
        )?.dot
      ).toBe("yellow");
      fixture.run({
        sql: "UPDATE inbox_items SET resolution_status = 'resolved', resolved_at_ms = 11000, read_at_ms = NULL WHERE id = ?",
        params: [urgent.itemId],
      });
      expect(
        (
          await feed.list(fixture.identity, { category: "needs_action" })
        ).rows.map((row) => row.item.id)
      ).toEqual([question.itemId]);
      expect(
        (await feed.list(fixture.identity)).rows.find(
          (row) => row.item.id === urgent.itemId
        )
      ).toMatchObject({
        dot: "blue",
        section: "activity",
        item: { resolutionStatus: "resolved" },
      });
    } finally {
      fixture.close();
    }
  });

  it.each([
    "read",
    "dismiss",
  ] as const)("freezes %s members, excluding later arrivals, late outbox rows, other Threads and muted history", async (operation) => {
    const fixture = createInboxFeedFixture();
    try {
      const old = await fixture.item("visible");
      const thread = await fixture.item("thread", {
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "thread",
          threadRootSignalId: "thread",
        },
      });
      fixture.space("muted");
      const muted = await fixture.item("muted", {
        sourceTarget: { kind: "space", spaceId: "muted", signalId: "muted" },
      });
      fixture.run({
        sql: "INSERT INTO inbox_conversation_notification_preferences VALUES ('owner', 'org', 'muted', 'muted')",
      });
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      const snapshot = await feed.list(fixture.identity);
      const group = snapshot.rows.find((row) => row.item.id === old.itemId);
      expect(group).toBeDefined();
      const newItem = await fixture.item("later", { occurredAtMs: 1000 });
      const lateOutbox = await fixture.item("late-outbox", { occurredAtMs: 1 });
      fixture.run({
        sql: "DELETE FROM inbox_conversation_notification_preferences",
      });
      expect(
        await feed.mutate(fixture.identity, {
          snapshotId: snapshot.snapshotId,
          groupKey: group?.groupKey,
          operation,
        })
      ).toEqual({ changedCount: 1 });
      const untouched = fixture.queryAll<{
        id: string;
        read_at_ms: number | null;
        cleared_at_ms: number | null;
      }>({
        sql: "SELECT id, read_at_ms, cleared_at_ms FROM inbox_items WHERE id != ?",
        params: [old.itemId],
      });
      expect(untouched).toEqual(
        expect.arrayContaining(
          [thread, muted, newItem, lateOutbox].map(({ itemId }) => ({
            id: itemId,
            read_at_ms: null,
            cleared_at_ms: null,
          }))
        )
      );
      expect(
        await feed.mutate(fixture.identity, {
          snapshotId: snapshot.snapshotId,
          operation,
        })
      ).toEqual({ changedCount: 1 });
      expect(
        fixture.queryFirst({
          sql: "SELECT read_at_ms, cleared_at_ms FROM inbox_items WHERE id = ?",
          params: [muted.itemId],
        })
      ).toEqual({ read_at_ms: null, cleared_at_ms: null });
      expect(
        fixture.queryFirst<{ n: number }>({
          sql: "SELECT count(*) AS n FROM inbox_space_thread_read_watermarks",
        })?.n
      ).toBe(0);
    } finally {
      fixture.close();
    }
  });

  it("binds pagination and mutations to the authenticated account, Organization and exact filters", async () => {
    const fixture = createInboxFeedFixture();
    try {
      await fixture.item("first", {
        kind: "system_issue",
        sourceTarget: { kind: "settings", section: "notifications" },
      });
      await fixture.item("second", {
        kind: "system_issue",
        sourceTarget: { kind: "settings", section: "notifications" },
      });
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      const snapshot = await feed.list(fixture.identity, { limit: 1 });
      expect(snapshot.nextCursor).not.toBeNull();
      await expect(
        feed.list(fixture.identity, {
          cursor: snapshot.nextCursor ?? "",
          agentsOnly: "true",
        })
      ).rejects.toMatchObject({ code: "inbox.cursor_invalid" });
      for (const identity of [
        { ...fixture.identity, recipientUserId: "other" },
        { ...fixture.identity, organizationId: "other-org" },
      ]) {
        await expect(
          feed.list(identity, { cursor: snapshot.nextCursor ?? "" })
        ).rejects.toMatchObject({ code: "inbox.snapshot_expired" });
        await expect(
          feed.mutate(identity, {
            snapshotId: snapshot.snapshotId,
            operation: "read",
          })
        ).rejects.toMatchObject({ code: "inbox.snapshot_expired" });
      }
      const expired = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 1_000_000,
      });
      await expect(
        expired.mutate(fixture.identity, {
          snapshotId: snapshot.snapshotId,
          operation: "dismiss",
        })
      ).rejects.toMatchObject({ code: "inbox.snapshot_expired" });
    } finally {
      fixture.close();
    }
  });

  it("never substitutes another owned Agent for missing legacy source identity, including frozen bulk writes", async () => {
    const f = createInboxFeedFixture();
    try {
      f.agent("codex");
      f.agent("still-mine");
      const legacy = await f.item("legacy-agent-reply", {
        kind: "agent_reply",
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "legacy-agent-reply",
          agentOwnerActivity: true,
        },
      });
      const human = await f.item("legacy-human-mention", {
        kind: "space_mention",
      });
      const feed = createInboxFeedService({ db: f.db, nowMs: () => 11_000 });
      const inbox = createInboxService({ db: f.db });
      const snapshot = await feed.list(f.identity);
      const before = f.queryFirst({
        sql: "SELECT * FROM inbox_items WHERE id = ?",
        params: [legacy.itemId],
      });
      f.run({
        sql: "UPDATE openmeld_profiles SET owner_user_id = 'other' WHERE profile_id = 'codex'",
      });
      f.run({
        sql: "UPDATE space_index_memberships SET owner_user_id_snapshot = 'other' WHERE profile_id = 'codex'",
      });
      f.run({
        sql: "UPDATE space_index_memberships SET status = 'removed' WHERE space_id = 'space' AND profile_kind_snapshot = 'human' AND owner_user_id_snapshot = 'owner'",
      });
      await expect(
        inbox.get({ ...f.identity, itemId: legacy.itemId })
      ).rejects.toMatchObject({ status: 404 });
      const inaccessible = await feed.list(f.identity);
      expect(inaccessible.rows).toEqual([]);
      expect(inaccessible.counts.all).toBe(0);
      expect((await inbox.summary(f.identity)).totalUnreadCount).toBe(0);
      expect(
        await feed.mutate(f.identity, {
          snapshotId: snapshot.snapshotId,
          operation: "read",
        })
      ).toEqual({ changedCount: 0 });
      expect(
        await feed.mutate(f.identity, {
          snapshotId: snapshot.snapshotId,
          operation: "dismiss",
        })
      ).toEqual({ changedCount: 0 });
      expect(
        f.queryFirst({
          sql: "SELECT * FROM inbox_items WHERE id = ?",
          params: [legacy.itemId],
        })
      ).toEqual(before);
      // Current Human membership is a separate right, not a guessed Agent relationship.
      f.run({
        sql: "UPDATE space_index_memberships SET status = 'active' WHERE space_id = 'space' AND profile_kind_snapshot = 'human' AND owner_user_id_snapshot = 'owner'",
      });
      expect(
        (await inbox.get({ ...f.identity, itemId: human.itemId })).item.id
      ).toBe(human.itemId);
      expect(
        (await inbox.get({ ...f.identity, itemId: legacy.itemId })).item.id
      ).toBe(legacy.itemId);
    } finally {
      f.close();
    }
  });

  it("revokes only the transferred personal-Agent relationship even when another owned Agent remains in the Space", async () => {
    const fixture = createInboxFeedFixture();
    try {
      fixture.agent("codex");
      fixture.agent("still-mine");
      const ownerOnly = await fixture.item("owner-only", {
        sourceFacts: facts(true),
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "owner-only",
          agentOwnerActivity: true,
        },
      });
      const human = await fixture.item("human-too", {
        kind: "space_mention",
        sourceFacts: {
          ...facts(true),
          recipientReasons: ["human_mention", "agent_owner"],
        },
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "human-too",
          agentOwnerActivity: true,
        },
      });
      const feed = createInboxFeedService({
        db: fixture.db,
        nowMs: () => 11_000,
      });
      const snapshot = await feed.list(fixture.identity);
      fixture.run({
        sql: "UPDATE openmeld_profiles SET owner_user_id = 'other' WHERE profile_id = 'codex'",
      });
      const result = await feed.list(fixture.identity, {
        category: "mentions",
      });
      expect(result.counts.mentions).toBe(1);
      expect(result.rows[0]).toMatchObject({
        item: {
          id: human.itemId,
          sourceFacts: {
            personalAgentProfileIds: [],
            firstContactAgentProfileIds: [],
          },
        },
        dot: "blue",
      });
      expect(result.rows[0]?.item.sourceTarget).not.toHaveProperty(
        "agentOwnerActivity"
      );
      await expect(
        createInboxService({ db: fixture.db }).get({
          ...fixture.identity,
          itemId: ownerOnly.itemId,
        })
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await feed.mutate(fixture.identity, {
          snapshotId: snapshot.snapshotId,
          operation: "read",
        })
      ).toEqual({ changedCount: 1 });
      expect(
        fixture.queryFirst({
          sql: "SELECT read_at_ms FROM inbox_items WHERE id = ?",
          params: [ownerOnly.itemId],
        })
      ).toEqual({ read_at_ms: null });
    } finally {
      fixture.close();
    }
  });
});

function facts(first = false): InboxSourceFacts {
  return {
    version: 1,
    agentProfileIds: ["codex"],
    personalAgentProfileIds: ["codex"],
    mentionedAgentProfileIds: ["codex"],
    firstContactAgentProfileIds: first ? ["codex"] : [],
    recipientReasons: ["agent_owner"],
  };
}

async function allIds(
  feed: ReturnType<typeof createInboxFeedService>,
  identity: { organizationId: string; recipientUserId: string },
  query: InboxFeedQuery
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page: InboxFeedResponse = await feed.list(identity, {
      ...query,
      cursor,
    });
    ids.push(...page.rows.map((row) => row.item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}
