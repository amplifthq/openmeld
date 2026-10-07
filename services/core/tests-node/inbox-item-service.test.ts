import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ensureInboxItem,
  InboxSourceConflictError,
  resolveInboxItemsBySource,
} from "../src/inbox/application/inbox-item-service";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Inbox item service", () => {
  it.each([
    "pending",
    "sent",
  ] as const)("repairs only legacy owner awareness while preserving %s delivery evidence and private state", async (state) => {
    const harness = await createInboxHarness();
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
      await harness.query({
        text: 'UPDATE "openmeld"."inbox_items" SET importance = \'urgent\', read_at_ms = 2500, cleared_at_ms = 2600 WHERE id = $1',
        values: [saved.itemId],
      });
      await harness.query({
        text: `INSERT INTO "openmeld"."inbox_email_deliveries"
        (id, inbox_item_id, state, attempt_count, next_attempt_at_ms, message_id, sent_at_ms, created_at_ms, updated_at_ms)
        VALUES ($1, $2, $3, $4, 2000, $5, $6, 2000, 2700)`,
        values: [
          "legacy-delivery",
          saved.itemId,
          state,
          state === "sent" ? 1 : 0,
          state === "sent" ? "provider-receipt" : null,
          state === "sent" ? 2700 : null,
        ],
      });
      const before = await harness.queryFirst({
        text: 'SELECT * FROM "openmeld"."inbox_items" WHERE id = $1',
        values: [saved.itemId],
      });
      // Apply the actual generated migration's bounded correction to populated
      // storage, then replay the delayed old writer and the correction again.
      const repairs = readFileSync(
        new URL(
          "../../../packages/db/postgresql/migrations/0011_retired_owner_awareness.sql",
          import.meta.url
        ),
        "utf8"
      ).split("--> statement-breakpoint");
      for (const statement of repairs) {
        await harness.query({ text: statement });
      }
      expect(
        await harness.queryFirst({
          text: 'SELECT * FROM "openmeld"."inbox_items" WHERE id = $1',
          values: [saved.itemId],
        })
      ).toEqual({ ...before, importance: "normal" });
      const delivery = await harness.queryFirst({
        text: 'SELECT * FROM "openmeld"."inbox_email_deliveries" WHERE id = \'legacy-delivery\'',
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
        await harness.query({ text: statement });
      }
      expect(
        await harness.queryFirst({
          text: 'SELECT * FROM "openmeld"."inbox_email_deliveries" WHERE id = \'legacy-delivery\'',
        })
      ).toEqual(delivery);
      expect(
        await harness.queryFirst({
          text: 'SELECT importance, resolution_status FROM "openmeld"."inbox_items" WHERE id = $1',
          values: [request.itemId],
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
      await harness.close();
    }
  });

  it("persists first-contact awareness without creating an urgent email and rejects reclassification on replay", async () => {
    const harness = await createInboxHarness();
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
      await harness.query({
        text: 'UPDATE "openmeld"."inbox_items" SET read_at_ms = 2500, cleared_at_ms = 2600 WHERE id = $1',
        values: [saved.itemId],
      });
      expect(
        await ensureInboxItem({ candidate, db: harness.db, nowMs: 3000 })
      ).toEqual(saved);
      expect(
        await harness.queryFirst({
          text: 'SELECT source_facts_json, read_at_ms, cleared_at_ms, occurred_at_ms FROM "openmeld"."inbox_items"',
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
        (
          await harness.queryFirst<{ n: number }>({
            text: 'SELECT count(*) AS n FROM "openmeld"."inbox_email_deliveries"',
          })
        )?.n
      ).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it("deduplicates a source event and atomically creates one urgent email delivery", async () => {
    const harness = await createInboxHarness();
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
        (
          await harness.queryFirst<{ count: number }>({
            text: 'SELECT count(*) AS count FROM "openmeld"."inbox_items"',
          })
        )?.count
      ).toBe(1);
      expect(
        (
          await harness.queryFirst<{ count: number }>({
            text: 'SELECT count(*) AS count FROM "openmeld"."inbox_email_deliveries"',
          })
        )?.count
      ).toBe(1);
      expect(
        (
          await harness.queryFirst<{ preview: string }>({
            text: 'SELECT preview FROM "openmeld"."inbox_items"',
          })
        )?.preview
      ).toBe("The agent is still waiting for approval.");
    } finally {
      await harness.close();
    }
  });

  it("fails fast when the same source identity changes immutable semantics", async () => {
    const harness = await createInboxHarness();
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
      await harness.close();
    }
  });

  it("cannot use new recipient facts to bypass a generic source conflict", async () => {
    const harness = await createInboxHarness();
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
      await harness.close();
    }
  });

  it("resolves source-owned action state without mutating read state", async () => {
    const harness = await createInboxHarness();
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
        await harness.queryFirst<{
          read_at_ms: number | null;
          resolution_status: string;
        }>({
          text: 'SELECT read_at_ms, resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual({ read_at_ms: null, resolution_status: "resolved" });
      expect(
        (
          await harness.queryFirst<{ state: string }>({
            text: 'SELECT state FROM "openmeld"."inbox_email_deliveries"',
          })
        )?.state
      ).toBe("suppressed");
    } finally {
      await harness.close();
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

async function createInboxHarness() {
  const harness = await createPostgresHarness();

  await harness.query({
    values: ["org_inbox", "Inbox Org", "inbox-org", 1000],
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
  });
  await harness.query({
    values: ["user_inbox", "Inbox User", "inbox@example.com"],
    text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
  });
  return harness;
}
