import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ensureInboxItem,
  InboxSourceConflictError,
  resolveInboxItemsBySource,
} from "../src/inbox/application/inbox-item-service";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Inbox item service", () => {
  it.each([
    "pending",
    "sent",
  ] as const)("repairs only legacy owner awareness while preserving %s delivery evidence and private state", async (state) => {
    const harness = createInboxHarness();
    try {
      const candidate = {
        ...buildCandidate(),
        attention: "update" as const,
        importance: "normal" as const,
        kind: "space_message" as const,
        sourceKind: "space_signal" as const,
        sourceKey: "legacy-owner-awareness",
        sourceTarget: {
          kind: "space" as const,
          spaceId: "space_1",
          signalId: "legacy-owner-awareness",
          agentOwnerActivity: true,
        },
      };
      const saved = await ensureInboxItem({
        candidate,
        db: harness.db,
        nowMs: 2000,
      });
      const request = await ensureInboxItem({
        candidate: buildCandidate(),
        db: harness.db,
        nowMs: 2000,
      });
      harness.run({
        sql: "UPDATE inbox_items SET importance = 'urgent', read_at_ms = 2500, cleared_at_ms = 2600 WHERE id = ?",
        params: [saved.itemId],
      });
      harness.run({
        sql: `INSERT INTO inbox_email_deliveries
        (id, inbox_item_id, state, attempt_count, next_attempt_at_ms, message_id, sent_at_ms, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, 2000, ?, ?, 2000, 2700)`,
        params: [
          "legacy-delivery",
          saved.itemId,
          state,
          state === "sent" ? 1 : 0,
          state === "sent" ? "provider-receipt" : null,
          state === "sent" ? 2700 : null,
        ],
      });
      const before = harness.queryFirst({
        sql: "SELECT * FROM inbox_items WHERE id = ?",
        params: [saved.itemId],
      });
      // Apply the actual generated migration's bounded correction to populated
      // storage, then replay the delayed old writer and the correction again.
      const repairs = readFileSync(
        new URL(
          "../../../packages/db/drizzle/0175_sudden_lily_hollister.sql",
          import.meta.url
        ),
        "utf8"
      )
        .split("--> statement-breakpoint")
        .slice(1);
      for (const statement of repairs) {
        harness.run({ sql: statement });
      }
      expect(
        harness.queryFirst({
          sql: "SELECT * FROM inbox_items WHERE id = ?",
          params: [saved.itemId],
        })
      ).toEqual({ ...before, importance: "normal" });
      const delivery = harness.queryFirst({
        sql: "SELECT * FROM inbox_email_deliveries WHERE id = 'legacy-delivery'",
      });
      expect(delivery).toMatchObject(
        state === "sent"
          ? {
              state: "sent",
              message_id: "provider-receipt",
              sent_at_ms: 2700,
              attempt_count: 1,
            }
          : {
              state: "suppressed",
              suppressed_reason: "item_not_urgent",
              attempt_count: 0,
            }
      );
      expect(
        await ensureInboxItem({
          candidate: { ...candidate, importance: "urgent" },
          db: harness.db,
          nowMs: 3000,
        })
      ).toEqual(saved);
      for (const statement of repairs) {
        harness.run({ sql: statement });
      }
      expect(
        harness.queryFirst({
          sql: "SELECT * FROM inbox_email_deliveries WHERE id = 'legacy-delivery'",
        })
      ).toEqual(delivery);
      expect(
        harness.queryFirst({
          sql: "SELECT importance, resolution_status FROM inbox_items WHERE id = ?",
          params: [request.itemId],
        })
      ).toEqual({ importance: "urgent", resolution_status: "open" });
      await expect(
        ensureInboxItem({
          candidate: {
            ...candidate,
            sourceTarget: {
              ...candidate.sourceTarget,
              threadRootSignalId: "unrelated-thread",
            },
          },
          db: harness.db,
          nowMs: 4000,
        })
      ).rejects.toBeInstanceOf(InboxSourceConflictError);
      await expect(
        ensureInboxItem({
          candidate: {
            ...candidate,
            sourceFacts: {
              version: 1,
              agentProfileIds: ["codex"],
              personalAgentProfileIds: ["codex"],
              firstContactAgentProfileIds: ["codex"],
              recipientReasons: ["agent_owner"],
            },
          },
          db: harness.db,
          nowMs: 4000,
        })
      ).rejects.toBeInstanceOf(InboxSourceConflictError);
    } finally {
      harness.close();
    }
  });

  it("persists first-contact awareness without creating an urgent email and rejects reclassification on replay", async () => {
    const harness = createInboxHarness();
    try {
      const candidate = {
        ...buildCandidate(),
        attention: "update" as const,
        importance: "normal" as const,
        kind: "space_message" as const,
        sourceKind: "space_signal" as const,
        sourceKey: "message-first",
        sourceTarget: {
          kind: "space" as const,
          spaceId: "space_1",
          signalId: "message-first",
          agentOwnerActivity: true,
        },
        sourceFacts: {
          version: 1 as const,
          agentProfileIds: ["codex"],
          personalAgentProfileIds: ["codex"],
          firstContactAgentProfileIds: ["codex"],
          recipientReasons: ["agent_owner" as const],
        },
      };
      const saved = await ensureInboxItem({
        candidate,
        db: harness.db,
        nowMs: 2000,
      });
      expect(saved.deliveryId).toBeNull();
      harness.run({
        sql: "UPDATE inbox_items SET read_at_ms = 2500, cleared_at_ms = 2600 WHERE id = ?",
        params: [saved.itemId],
      });
      expect(
        await ensureInboxItem({ candidate, db: harness.db, nowMs: 3000 })
      ).toEqual(saved);
      expect(
        harness.queryFirst({
          sql: "SELECT source_facts_json, read_at_ms, cleared_at_ms, occurred_at_ms FROM inbox_items",
        })
      ).toEqual({
        source_facts_json: JSON.stringify(candidate.sourceFacts),
        read_at_ms: 2500,
        cleared_at_ms: 2600,
        occurred_at_ms: 1000,
      });
      await expect(
        ensureInboxItem({
          candidate: {
            ...candidate,
            sourceFacts: {
              ...candidate.sourceFacts,
              firstContactAgentProfileIds: [],
            },
          },
          db: harness.db,
          nowMs: 4000,
        })
      ).rejects.toBeInstanceOf(InboxSourceConflictError);
      expect(
        harness.queryFirst<{ n: number }>({
          sql: "SELECT count(*) AS n FROM inbox_email_deliveries",
        })?.n
      ).toBe(0);
    } finally {
      harness.close();
    }
  });

  it("deduplicates a source event and atomically creates one urgent email delivery", async () => {
    const harness = createInboxHarness();
    try {
      const candidate = buildCandidate();
      const first = await ensureInboxItem({
        candidate,
        db: harness.db,
        nowMs: 2000,
      });
      const replay = await ensureInboxItem({
        candidate: {
          ...candidate,
          preview: "The agent is still waiting for approval.",
        },
        db: harness.db,
        nowMs: 3000,
      });

      expect(replay.itemId).toBe(first.itemId);
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_items",
        })?.count
      ).toBe(1);
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_email_deliveries",
        })?.count
      ).toBe(1);
      expect(
        harness.queryFirst<{ preview: string }>({
          sql: "SELECT preview FROM inbox_items",
        })?.preview
      ).toBe("The agent is still waiting for approval.");
    } finally {
      harness.close();
    }
  });

  it("fails fast when the same source identity changes immutable semantics", async () => {
    const harness = createInboxHarness();
    try {
      const candidate = buildCandidate();
      await ensureInboxItem({ candidate, db: harness.db, nowMs: 2000 });

      await expect(
        ensureInboxItem({
          candidate: {
            ...candidate,
            importance: "normal",
          },
          db: harness.db,
          nowMs: 3000,
        })
      ).rejects.toBeInstanceOf(InboxSourceConflictError);
    } finally {
      harness.close();
    }
  });

  it("cannot use new recipient facts to bypass a generic source conflict", async () => {
    const harness = createInboxHarness();
    try {
      const candidate = buildCandidate();
      await ensureInboxItem({ candidate, db: harness.db, nowMs: 2000 });
      await expect(
        ensureInboxItem({
          candidate: {
            ...candidate,
            importance: "normal",
            sourceFacts: {
              version: 1,
              recipientReasons: ["requester"],
              requestCategory: "review",
            },
          },
          db: harness.db,
          nowMs: 3000,
        })
      ).rejects.toBeInstanceOf(InboxSourceConflictError);
    } finally {
      harness.close();
    }
  });

  it("resolves source-owned action state without mutating read state", async () => {
    const harness = createInboxHarness();
    try {
      const candidate = buildCandidate();
      await ensureInboxItem({ candidate, db: harness.db, nowMs: 2000 });
      const resolvedCount = await resolveInboxItemsBySource({
        db: harness.db,
        organizationId: candidate.organizationId,
        resolvedAtMs: 4000,
        sourceKey: candidate.sourceKey,
        sourceKind: candidate.sourceKind,
      });

      expect(resolvedCount).toBe(1);
      expect(
        harness.queryFirst<{
          read_at_ms: number | null;
          resolution_status: string;
        }>({
          sql: "SELECT read_at_ms, resolution_status FROM inbox_items",
        })
      ).toEqual({ read_at_ms: null, resolution_status: "resolved" });
      expect(
        harness.queryFirst<{ state: string }>({
          sql: "SELECT state FROM inbox_email_deliveries",
        })?.state
      ).toBe("suppressed");
    } finally {
      harness.close();
    }
  });
});

function buildCandidate() {
  return {
    attention: "action_required" as const,
    contextLabel: "Build failures",
    importance: "urgent" as const,
    kind: "agent_interaction" as const,
    occurredAtMs: 1000,
    organizationId: "org_inbox",
    preview: "The agent needs approval to continue.",
    recipientUserId: "user_inbox",
    sourceKey: "runtime_1:interaction_1",
    sourceKind: "runtime_coordinator_interaction" as const,
    sourceTarget: {
      interactionId: "interaction_1",
      kind: "agent_interaction" as const,
      runtimeCoordinatorExecutionId: "runtime_1",
      spaceId: "space_1",
    },
    title: "Approval required",
  };
}

function createInboxHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `,
  });
  applyDrizzleMigrationsForTables(harness, [
    "inbox_items",
    "inbox_email_deliveries",
    "inbox_center_agent_read_watermarks",
    "inbox_space_thread_read_watermarks",
  ]);
  harness.run({
    params: ["org_inbox", "Inbox Org", "inbox-org", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: ["user_inbox", "Inbox User", "inbox@example.com"],
    sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
  });
  return harness;
}
