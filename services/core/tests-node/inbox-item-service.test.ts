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
