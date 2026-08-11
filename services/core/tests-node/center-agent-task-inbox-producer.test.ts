import { describe, expect, it } from "vitest";
import { projectCenterAgentTaskInboxItem } from "../src/center-agent-tasks/application/center-agent-task-inbox-producer";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Center Agent Task Inbox producer", () => {
  it("projects one idempotent update for an exact requester terminal result", async () => {
    const harness = createInboxHarness();
    try {
      insertTask(harness, {
        organizationId: "org_one",
        requesterUserId: "user_one",
        status: "succeeded",
        taskId: "task_one",
      });

      const input = {
        db: harness.db,
        event: {
          id: "event_finished",
          occurredAt: "2026-08-08T02:00:00.000Z",
          text: "The onboarding review is complete.",
        },
        nowMs: Date.parse("2026-08-08T02:00:01.000Z"),
        task: {
          id: "task_one",
          organizationId: "org_one",
          requesterUserId: "user_one",
          status: "succeeded" as const,
          title: "Review onboarding",
        },
      };

      await projectCenterAgentTaskInboxItem(input);
      await projectCenterAgentTaskInboxItem(input);

      const inbox = createInboxService({ db: harness.db });
      await expect(
        inbox.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({
        items: [
          {
            attention: "update",
            contextLabel: "Center Agent Task",
            importance: "normal",
            kind: "center_agent_task",
            organizationId: "org_one",
            preview: "The onboarding review is complete.",
            recipientUserId: "user_one",
            resolutionStatus: "not_applicable",
            sourceTarget: {
              kind: "center_agent_task",
              taskId: "task_one",
            },
            title: "Review onboarding",
          },
        ],
      });
      expect(
        harness.queryAll<{ source_key: string }>({
          sql: "SELECT source_key FROM inbox_items",
        })
      ).toEqual([{ source_key: "task_one:event_finished" }]);
    } finally {
      harness.close();
    }
  });

  it("projects a needs-action item when the Task needs requester attention", async () => {
    const harness = createInboxHarness();
    try {
      insertTask(harness, {
        organizationId: "org_one",
        requesterUserId: "user_one",
        status: "needs_attention",
        taskId: "task_attention",
      });

      await projectCenterAgentTaskInboxItem({
        db: harness.db,
        event: {
          id: "event_attention",
          occurredAt: "2026-08-08T02:10:00.000Z",
          text: "Choose which research source the Task should use.",
        },
        importance: "urgent",
        nowMs: Date.parse("2026-08-08T02:10:01.000Z"),
        task: {
          id: "task_attention",
          organizationId: "org_one",
          requesterUserId: "user_one",
          status: "needs_attention",
          title: "Research onboarding",
        },
      });

      const inbox = createInboxService({ db: harness.db });
      await expect(
        inbox.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "needs_action",
        })
      ).resolves.toMatchObject({
        items: [
          {
            attention: "action_required",
            importance: "urgent",
            preview: "Choose which research source the Task should use.",
            resolutionStatus: "open",
            sourceTarget: {
              kind: "center_agent_task",
              taskId: "task_attention",
            },
            title: "Research onboarding",
          },
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("does not project queued, running, or unlinked Tasks", async () => {
    const harness = createInboxHarness();
    try {
      for (const [taskId, requesterUserId, status] of [
        ["task_queued", "user_one", "queued"],
        ["task_running", "user_one", "running"],
        ["task_unlinked", null, "succeeded"],
      ] as const) {
        insertTask(harness, {
          organizationId: "org_one",
          requesterUserId,
          status,
          taskId,
        });
        await projectCenterAgentTaskInboxItem({
          db: harness.db,
          event: {
            id: `event_${taskId}`,
            occurredAt: "2026-08-08T02:20:00.000Z",
            text: "No member attention event should be created.",
          },
          nowMs: Date.parse("2026-08-08T02:20:01.000Z"),
          task: {
            id: taskId,
            organizationId: "org_one",
            requesterUserId,
            status,
            title: "Background research",
          },
        });
      }

      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_items",
        })?.count
      ).toBe(0);
    } finally {
      harness.close();
    }
  });

  it("fails closed when the Task-owned Inbox access projection changes", async () => {
    const harness = createInboxHarness();
    try {
      insertTask(harness, {
        organizationId: "org_one",
        requesterUserId: "user_one",
        status: "succeeded",
        taskId: "task_private",
      });
      await projectCenterAgentTaskInboxItem({
        db: harness.db,
        event: {
          id: "event_private",
          occurredAt: "2026-08-08T02:30:00.000Z",
          text: "Private research is complete.",
        },
        nowMs: Date.parse("2026-08-08T02:30:01.000Z"),
        task: {
          id: "task_private",
          organizationId: "org_one",
          requesterUserId: "user_one",
          status: "succeeded",
          title: "Private research",
        },
      });
      const inbox = createInboxService({ db: harness.db });
      await expect(
        inbox.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({ items: [{ title: "Private research" }] });

      harness.run({
        params: ["task_private", "user_one"],
        sql: `
          DELETE FROM center_agent_task_authorized_readers
          WHERE task_id = ? AND user_id = ?
        `,
      });
      await expect(
        inbox.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({ items: [] });
    } finally {
      harness.close();
    }
  });

  it("keeps Task truth unchanged when the requester reads and dismisses its Inbox item", async () => {
    const harness = createInboxHarness();
    try {
      insertTask(harness, {
        organizationId: "org_one",
        requesterUserId: "user_one",
        status: "needs_attention",
        taskId: "task_source_truth",
      });
      await projectCenterAgentTaskInboxItem({
        db: harness.db,
        event: {
          id: "event_source_truth",
          occurredAt: "2026-08-08T02:40:00.000Z",
          text: "Choose the next research direction.",
        },
        nowMs: Date.parse("2026-08-08T02:40:01.000Z"),
        task: {
          id: "task_source_truth",
          organizationId: "org_one",
          requesterUserId: "user_one",
          status: "needs_attention",
          title: "Choose research direction",
        },
      });

      const taskBefore = harness.queryFirst<{
        active_attempt_generation: number | null;
        finished_at_ms: number | null;
        id: string;
        organization_id: string;
        requester_user_id: string | null;
        status: string;
        version: number;
      }>({
        params: ["task_source_truth"],
        sql: `
          SELECT
            active_attempt_generation,
            finished_at_ms,
            id,
            organization_id,
            requester_user_id,
            status,
            version
          FROM center_agent_tasks
          WHERE id = ?
        `,
      });
      const inbox = createInboxService({
        db: harness.db,
        nowMs: () => Date.parse("2026-08-08T02:41:00.000Z"),
      });
      const item = await inbox.list({
        organizationId: "org_one",
        recipientUserId: "user_one",
        view: "needs_action",
      });
      const itemId = item.items[0]?.id;
      expect(itemId).toBeDefined();

      await inbox.markRead({
        itemId: itemId ?? "missing",
        organizationId: "org_one",
        read: true,
        recipientUserId: "user_one",
      });
      await inbox.dismiss({
        itemId: itemId ?? "missing",
        organizationId: "org_one",
        recipientUserId: "user_one",
      });

      expect(
        harness.queryFirst({
          params: ["task_source_truth"],
          sql: `
            SELECT
              active_attempt_generation,
              finished_at_ms,
              id,
              organization_id,
              requester_user_id,
              status,
              version
            FROM center_agent_tasks
            WHERE id = ?
          `,
        })
      ).toEqual(taskBefore);
    } finally {
      harness.close();
    }
  });
});

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
    "center_agent_tasks",
    "center_agent_task_authorized_readers",
    "space_index_spaces",
    "space_index_memberships",
    "inbox_items",
    "inbox_email_deliveries",
  ]);
  harness.run({
    params: ["org_one", "One", "one", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: ["org_other", "Other", "other", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: ["user_one", "One", "one@example.test"],
    sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
  });
  harness.run({
    params: ["user_two", "Two", "two@example.test"],
    sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
  });
  return harness;
}

function insertTask(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    organizationId: string;
    requesterUserId: string | null;
    status:
      | "failed"
      | "needs_attention"
      | "queued"
      | "running"
      | "stopped"
      | "succeeded";
    taskId: string;
  }
): void {
  const terminal = ["failed", "stopped", "succeeded"].includes(input.status);
  harness.run({
    params: [
      input.taskId,
      input.organizationId,
      input.requesterUserId,
      `create:${input.taskId}`,
      `Task ${input.taskId}`,
      `Complete ${input.taskId}`,
      input.status,
      input.status === "queued" ? null : 1,
      terminal ? 2000 : null,
    ],
    sql: `
      INSERT INTO center_agent_tasks (
        id,
        organization_id,
        requester_user_id,
        idempotency_key,
        title,
        goal,
        origin_kind,
        status,
        active_attempt_generation,
        version,
        created_at_ms,
        updated_at_ms,
        finished_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, 'open_meld', ?, ?, 1, 1000, 2000, ?)
    `,
  });
}
