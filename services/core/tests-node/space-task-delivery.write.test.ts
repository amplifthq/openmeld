import { DatabaseSync } from "node:sqlite";
import type { SpaceTask, SpaceTaskActor } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  enqueueSpaceTaskDeliveries,
  flushSpaceTaskDeliveries,
  isAuthorizedSpaceTaskStop,
  isSpaceTaskDeliveryCurrent,
  isSpaceTaskStopSuperseded,
  resolveSpaceTaskHumanDecisionTarget,
} from "../src/space/application/space-task-delivery";
import { projectSpaceTaskInbox } from "../src/space/application/space-task-inbox-projection";
import {
  createSpaceTaskForMessage,
  withSpaceTaskDispatchContext,
} from "../src/space/application/space-task-message";
import { SpaceTaskService } from "../src/space/application/space-task-service";
import { createDispatchOutboxRecord } from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { SpaceTaskDeliveryRepository } from "../src/space/infrastructure/sql/space-task-delivery-repo";
import {
  ensureSpaceTaskTables,
  SpaceTaskRepository,
} from "../src/space/infrastructure/sql/space-task-repo";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";

const requester: SpaceTaskActor = {
  ownerUserId: "user-avery",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human",
  profileName: "Avery",
};
const assignee: SpaceTaskActor = {
  ownerUserId: "user-builder",
  profileId: "22222222-2222-4222-8222-222222222222",
  profileKind: "agent",
  profileName: "Builder",
};
const reviewer: SpaceTaskActor = {
  ownerUserId: "user-reviewer",
  profileId: "33333333-3333-4333-8333-333333333333",
  profileKind: "agent",
  profileName: "Reviewer",
};

function createSqlHarness(previousOutboxSchema = false) {
  const database = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...bindings: Array<string | number | null>) {
      if (bindings.length === 0 && query.split(";").length > 2) {
        database.exec(query);
        return { toArray: () => [] };
      }
      const statement = database.prepare(query);
      let rows: ReturnType<typeof statement.all> = [];
      if (statement.columns().length > 0) {
        rows = statement.all(...bindings);
      } else {
        statement.run(...bindings);
      }
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
  ensureSpaceTaskTables(sql);
  if (previousOutboxSchema) {
    sql.exec(`CREATE TABLE space_task_delivery_outbox (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload_json TEXT NOT NULL, next_attempt_ms INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
    )`);
    sql.exec(
      `INSERT INTO space_task_delivery_outbox
       (id, task_id, kind, payload_json, next_attempt_ms)
       VALUES (?, ?, ?, ?, ?)`,
      "retained-before-upgrade",
      "task-before-upgrade",
      "handoff",
      "{}",
      null
    );
  }
  const deliveries = new SpaceTaskDeliveryRepository(sql);
  deliveries.initialize();
  const tasks = new SpaceTaskRepository(sql);
  const runTransaction = <T>(callback: () => T): T => {
    database.exec("BEGIN");
    try {
      const result = callback();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  const service = (failAfterEnqueue = false) =>
    new SpaceTaskService({
      repository: tasks,
      runTransaction,
      spaceId: "space-1",
      onMutation: (receipt, previous) => {
        enqueueSpaceTaskDeliveries({
          repository: deliveries,
          receipt,
          previous,
          authorizedActor: true,
        });
        if (failAfterEnqueue && receipt.event.type === "result_submitted") {
          throw new Error("interrupted before commit");
        }
      },
    });
  return {
    close: () => database.close(),
    deliveries,
    service,
    sql,
    tasks,
    runTransaction,
    pendingActions: (nowMs: number) =>
      deliveries
        .pending(nowMs)
        .filter((delivery) => delivery.kind !== "inbox_projection"),
  };
}

afterEach(() => vi.useRealTimers());

describe("Space Task durable delivery", () => {
  it("keeps review attention source-owned across reads, reviewer changes, rework decisions, and acceptance", async () => {
    const f = await createInboxFeedFixture();
    const harness = createSqlHarness();
    try {
      await f.space("space-1");
      await f.member("space-1", reviewer.profileId, "other", "human");
      const human = { ...requester, ownerUserId: "owner" };
      const otherHuman = {
        ...reviewer,
        profileKind: "human" as const,
        ownerUserId: "other",
      };
      const agentReviewer = {
        ...reviewer,
        profileId: "44444444-4444-4444-8444-444444444444",
      };
      const activeMembers = [human, assignee, otherHuman, agentReviewer];
      const context = (actor: SpaceTaskActor) => ({
        actor,
        isSpaceOwner: actor.profileId === human.profileId,
        resolveMember: (profileId: string) =>
          activeMembers.find((member) => member.profileId === profileId) ??
          null,
      });
      let receipt = harness.service().create(
        {
          operationId: "review-task",
          title: "Check the report",
          assigneeProfileId: assignee.profileId,
          reviewerProfileId: human.profileId,
        },
        { ...context(human), requestedBy: human }
      );
      const project = async () => {
        await projectSpaceTaskInbox({
          task: receipt.task,
          events: harness.tasks.listEvents(receipt.task.taskId),
          activeMembers,
          ownerUserIds: ["owner"],
          organizationId: "org",
          spaceName: "Review",
          db: f.db,
          nowMs: Date.now(),
        });
      };
      const pending = async () =>
        (
          await f.query<{ id: string; recipient_user_id: string }>(
            "SELECT id, recipient_user_id FROM openmeld.inbox_items WHERE source_kind = 'system_attention_event' AND starts_with(source_key, 'space-task:') AND resolution_status = 'open'"
          )
        ).rows;
      const mutate = (
        body: Parameters<SpaceTaskService["mutate"]>[1],
        actor: SpaceTaskActor = human
      ) => {
        receipt = harness
          .service()
          .mutate(receipt.task.taskId, body, context(actor));
      };
      mutate(
        {
          action: "mark_in_progress",
          expectedRevision: receipt.task.revision,
          operationId: "start-review",
        },
        assignee
      );
      mutate(
        {
          action: "submit_result",
          expectedRevision: receipt.task.revision,
          operationId: "submit-review",
          summary: "Report ready.",
        },
        assignee
      );
      await project();
      expect(await pending()).toEqual([
        { id: expect.any(String), recipient_user_id: "owner" },
      ]);
      const itemId = (await pending())[0]?.id ?? "";
      const inbox = createInboxService({ db: f.db });
      await inbox.markRead({ ...f.identity, itemId, read: true });
      await inbox.dismiss({ ...f.identity, itemId });
      await project();
      expect((await pending())[0]?.id).toBe(itemId);
      expect(receipt.task.phase).toBe("in_review");

      expect(() =>
        mutate({
          action: "set_reviewer",
          expectedRevision: receipt.task.revision,
          operationId: "transfer-review",
          reviewerProfileId: otherHuman.profileId,
        })
      ).toThrow("Complete the current review");

      for (let round = 0; round < 5; round++) {
        const reviewActor = [human, otherHuman][round] ?? agentReviewer;
        mutate(
          {
            action: "review",
            expectedRevision: receipt.task.revision,
            expectedResultRevision: receipt.task.result?.resultRevision ?? 0,
            operationId: `request-changes-${round}`,
            decision: "changes_requested",
            feedback: "Check the totals.",
          },
          reviewActor
        );
        await project();
        if (round < 4) {
          expect(await pending()).toEqual([]);
          if (round < 2) {
            mutate({
              action: "set_reviewer",
              expectedRevision: receipt.task.revision,
              operationId: `next-reviewer-${round}`,
              reviewerProfileId:
                round === 0 ? otherHuman.profileId : agentReviewer.profileId,
            });
          }
          mutate(
            {
              action: "submit_result",
              expectedRevision: receipt.task.revision,
              operationId: `resubmit-${round}`,
              summary: "Totals checked.",
            },
            assignee
          );
          await project();
          expect((await pending()).map((row) => row.recipient_user_id)).toEqual(
            round === 0 ? ["other"] : []
          );
        }
      }
      expect(receipt.task.needsHumanDecision).toBe(true);
      expect((await pending())[0]?.recipient_user_id).toBe("owner");
      mutate({
        action: "continue_rework",
        expectedRevision: receipt.task.revision,
        operationId: "continue-review",
        reason: "One more check.",
      });
      await project();
      expect(await pending()).toEqual([]);
      mutate({
        action: "set_reviewer",
        expectedRevision: receipt.task.revision,
        operationId: "final-human-reviewer",
        reviewerProfileId: human.profileId,
      });
      mutate(
        {
          action: "submit_result",
          expectedRevision: receipt.task.revision,
          operationId: "final-result",
          summary: "All totals verified.",
        },
        assignee
      );
      await project();
      mutate({
        action: "review",
        expectedRevision: receipt.task.revision,
        expectedResultRevision: receipt.task.result?.resultRevision ?? 0,
        operationId: "accept-review",
        decision: "accepted",
      });
      await project();
      expect(receipt.task.phase).toBe("done");
      expect(await pending()).toEqual([]);
      expect(
        harness.deliveries
          .pending(Date.now())
          .some((delivery) => delivery.kind === "inbox_projection")
      ).toBe(true);
    } finally {
      harness.close();
      await f.close();
    }
  });
  it("retains Project link projection for creation and association removal", () => {
    const harness = createSqlHarness();
    try {
      const context = {
        actor: requester,
        requestedBy: requester,
        isSpaceOwner: true,
        resolveMember: () => null,
      };
      const created = harness.service().create(
        {
          operationId: "create-project-linked-task",
          title: "Project work",
          projectIds: ["project-1"],
        },
        context
      );
      expect(harness.pendingActions(Date.now())).toMatchObject([
        {
          kind: "project_projection",
          receipt: { task: { projectIds: ["project-1"] } },
        },
      ]);
      harness.deliveries.complete(
        harness.pendingActions(Date.now())[0]?.id ?? ""
      );
      harness.service().mutate(
        created.task.taskId,
        {
          action: "set_projects",
          expectedRevision: created.task.revision,
          operationId: "remove-project-link",
          projectIds: [],
        },
        context
      );
      expect(harness.pendingActions(Date.now())).toMatchObject([
        { kind: "project_projection", receipt: { task: { projectIds: [] } } },
      ]);
    } finally {
      harness.close();
    }
  });
  it("commits one task and its Wake references with its message, and rolls back failed dispatch insertion", () => {
    const harness = createSqlHarness();
    const members = new Map(
      [requester, assignee, reviewer].map((member) => [
        member.profileId,
        member,
      ])
    );
    const context = {
      actor: requester,
      isSpaceOwner: true,
      resolveMember: (id: string) => members.get(id) ?? null,
    };
    const signal = {
      v: 1 as const,
      id: "message-1",
      spaceId: "space-1",
      ts: 1,
      profile: {
        kind: "human" as const,
        profileId: requester.profileId,
        profileName: requester.profileName,
      },
      type: "signal.text" as const,
      data: {
        text: "Check upload states",
        taskDraft: {
          title: "Fix uploads",
          assigneeProfileId: assignee.profileId,
          reviewerProfileId: reviewer.profileId,
        },
        messageEnvelope: {
          text: "Check upload states",
          activationTargets: [assignee.profileId, reviewer.profileId],
          referenceTargets: [],
        },
      },
    };
    try {
      harness.sql.exec("CREATE TABLE sent_messages (id TEXT PRIMARY KEY)");
      const publish = () => {
        harness.sql.exec("INSERT INTO sent_messages VALUES (?)", signal.id);
        return createSpaceTaskForMessage({
          sql: harness.sql,
          signal,
          context,
          threadId: null,
        });
      };
      expect(() =>
        harness.runTransaction(() => {
          publish();
          throw new Error("dispatch insertion failed");
        })
      ).toThrow("dispatch insertion failed");
      expect(harness.tasks.listTasks()).toHaveLength(0);
      expect(
        harness.sql.exec("SELECT * FROM sent_messages").toArray()
      ).toHaveLength(0);
      const receipt = harness.runTransaction(publish);
      expect(receipt?.task.sourceSignalId).toBe(signal.id);
      expect(receipt?.task.reviewer?.profileId).toBe(reviewer.profileId);
      if (!receipt) {
        throw new Error("Expected a created task");
      }
      const prepared = createDispatchOutboxRecord({
        bindingEnabled: true,
        bindingState: "bound",
        dispatchPolicy: "mention_only",
        spaceId: signal.spaceId,
        sourceEventId: signal.id,
        senderProfileId: requester.profileId,
        targetProfileId: assignee.profileId,
        sourceSignalSnapshot: {
          text: signal.data.text,
          profileId: requester.profileId,
          profileKind: "human",
        },
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "Explicit Wake",
        nowMs: 1,
      });
      const [dispatch] = withSpaceTaskDispatchContext(receipt.task, [prepared]);
      expect(dispatch?.sourceSignalSnapshot?.text).toContain(
        receipt.task.taskId
      );
      expect(dispatch?.sourceSignalSnapshot?.text).toContain(
        assignee.profileId
      );
      expect(
        JSON.parse(dispatch?.payloadJson ?? "{}").sourceSignalSnapshot.text
      ).toContain(receipt.task.taskId);
      expect(prepared.sourceSignalSnapshot?.text).toBe(signal.data.text);
      expect(dispatch?.dispatchId).toBe(prepared.dispatchId);
      const replay = harness.runTransaction(() =>
        createSpaceTaskForMessage({
          sql: harness.sql,
          signal,
          context,
          threadId: null,
        })
      );
      expect(replay?.task.taskId).toBe(receipt?.task.taskId);
      expect(harness.tasks.listTasks()).toHaveLength(1);
      expect(
        harness.deliveries.wakeRefs(receipt?.task.taskId ?? "")
      ).toHaveLength(2);
      expect(() =>
        harness.runTransaction(() =>
          createSpaceTaskForMessage({
            sql: harness.sql,
            signal: {
              ...signal,
              id: "message-2",
              data: {
                ...signal.data,
                taskDraft: {
                  title: "Invalid assignment",
                  assigneeProfileId: "not-a-member",
                },
              },
            },
            context,
            threadId: null,
          })
        )
      ).toThrow();
      expect(harness.tasks.listTasks()).toHaveLength(1);
    } finally {
      harness.close();
    }
  });
  it("adds delivery retention metadata without dropping a previous outbox row", () => {
    const harness = createSqlHarness(true);
    try {
      expect(
        harness.sql
          .exec<{ id: string; updated_at_ms: number }>(
            "SELECT id, updated_at_ms FROM space_task_delivery_outbox"
          )
          .toArray()
      ).toEqual([{ id: "retained-before-upgrade", updated_at_ms: 0 }]);
    } finally {
      harness.close();
    }
  });
  it("permits only the retained cancellation actor and recorded Wake, then fences a reopen", () => {
    const harness = createSqlHarness();
    try {
      const members = new Map(
        [requester, assignee, reviewer].map((member) => [
          member.profileId,
          member,
        ])
      );
      const context = {
        actor: requester,
        isSpaceOwner: true,
        resolveMember: (profileId: string) => members.get(profileId) ?? null,
      };
      const created = harness.service().create(
        {
          operationId: "create-stop-task",
          title: "Stop only this Task's Agent Wake",
          assigneeProfileId: assignee.profileId,
        },
        { ...context, requestedBy: requester }
      );
      harness.deliveries.recordWake(
        created.task.taskId,
        "handoff-1",
        assignee.profileId
      );
      const canceled = harness.service().mutate(
        created.task.taskId,
        {
          action: "cancel",
          expectedRevision: created.task.revision,
          operationId: "cancel-stop-task",
          reason: "No longer needed",
        },
        context
      );
      const delivery = harness.pendingActions(Date.now())[0];
      expect(delivery?.kind).toBe("stop");
      if (!delivery) {
        throw new Error("Expected a retained Stop delivery");
      }
      const authorization = {
        actorProfileId: requester.profileId,
        actorOwnerUserId: requester.ownerUserId,
        delivery,
        wake: {
          sourceSignalId: "handoff-1",
          targetProfileId: assignee.profileId,
        },
        taskRepository: harness.tasks,
        deliveryRepository: harness.deliveries,
      };
      expect(isAuthorizedSpaceTaskStop(authorization)).toBe(true);
      expect(
        isAuthorizedSpaceTaskStop({
          ...authorization,
          actorProfileId: reviewer.profileId,
          actorOwnerUserId: reviewer.ownerUserId,
        })
      ).toBe(false);
      expect(
        isAuthorizedSpaceTaskStop({
          ...authorization,
          delivery: {
            ...delivery,
            receipt: {
              ...delivery.receipt,
              event: {
                ...delivery.receipt.event,
                eventId: "tse_55555555-5555-4555-8555-555555555555",
              },
            },
          },
        })
      ).toBe(false);
      expect(
        isAuthorizedSpaceTaskStop({
          ...authorization,
          wake: {
            sourceSignalId: "handoff-2",
            targetProfileId: assignee.profileId,
          },
        })
      ).toBe(false);
      expect(
        isAuthorizedSpaceTaskStop({ ...authorization, delivery: undefined })
      ).toBe(false);
      const reopened = harness.service().mutate(
        created.task.taskId,
        {
          action: "reopen",
          expectedRevision: canceled.task.revision,
          operationId: "reopen-stop-task",
          reason: "Resume the work",
        },
        context
      );
      expect(isSpaceTaskDeliveryCurrent(delivery, reopened.task)).toBe(false);
      expect(isSpaceTaskStopSuperseded(delivery, harness.tasks)).toBe(true);
      expect(isAuthorizedSpaceTaskStop(authorization)).toBe(false);
      const canceledAgain = harness.service().mutate(
        created.task.taskId,
        {
          action: "cancel",
          expectedRevision: reopened.task.revision,
          operationId: "cancel-again",
          reason: "Stop the new work",
        },
        context
      );
      expect(isSpaceTaskDeliveryCurrent(delivery, canceledAgain.task)).toBe(
        true
      );
      expect(isAuthorizedSpaceTaskStop(authorization)).toBe(false);
    } finally {
      harness.close();
    }
  });
  it("routes an Agent-requested human decision to an active Space owner", () => {
    const agentRequestedTask = { requestedBy: assignee } as SpaceTask;
    expect(
      resolveSpaceTaskHumanDecisionTarget(
        agentRequestedTask,
        [assignee, requester],
        [requester.ownerUserId ?? ""]
      )
    ).toEqual(requester);
    expect(
      resolveSpaceTaskHumanDecisionTarget(
        agentRequestedTask,
        [assignee],
        [requester.ownerUserId ?? ""]
      )
    ).toBeNull();
  });
  it("quarantines a malformed delivery while processing valid work and reclaims exhausted rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00.000Z"));
    const harness = createSqlHarness();
    try {
      const nowMs = Date.now();
      const created = harness.service().create(
        {
          operationId: "create-linked-task",
          title: "Follow a linked issue",
          externalWorkItems: [
            {
              provider: "github",
              owner: "amplifthq",
              repo: "openmeld",
              number: 1143,
              url: "https://github.com/amplifthq/openmeld/issues/1143",
              lastObservedState: "open",
              lastObservedAt: null,
            },
          ],
        },
        {
          actor: requester,
          requestedBy: requester,
          isSpaceOwner: true,
          resolveMember: () => null,
        }
      );
      const valid = harness.pendingActions(nowMs)[0];
      expect(valid?.kind).toBe("github_projection");
      if (!valid) {
        throw new Error("Expected a valid projection delivery");
      }
      harness.sql.exec(
        `INSERT INTO space_task_delivery_outbox
         (id, task_id, kind, payload_json, next_attempt_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        "malformed-delivery",
        "task-malformed",
        "handoff",
        "{not-json",
        nowMs,
        nowMs
      );
      const deliver = vi.fn(async (_delivery: unknown) => undefined);
      await flushSpaceTaskDeliveries({
        repository: harness.deliveries,
        deliver: (delivery) =>
          delivery.kind === "inbox_projection"
            ? Promise.resolve()
            : deliver(delivery),
        onFailure: () => undefined,
      });
      expect(deliver).toHaveBeenCalledExactlyOnceWith(valid);
      expect(harness.deliveries.status("task-malformed")).toMatchObject([
        { state: "failed" },
      ]);
      expect(harness.deliveries.status(created.task.taskId)).toEqual([]);

      harness.service().mutate(
        created.task.taskId,
        {
          action: "update_brief",
          expectedRevision: created.task.revision,
          operationId: "edit-linked-brief",
          description: "Keep checking this issue.",
        },
        {
          actor: requester,
          isSpaceOwner: true,
          resolveMember: () => null,
        }
      );
      expect(harness.pendingActions(nowMs)).toEqual([]);
      for (const delivery of harness.deliveries.pending(nowMs)) {
        harness.deliveries.complete(delivery.id);
      }

      harness.deliveries.enqueue({ ...valid, id: "retry-delivery" }, nowMs);
      for (let attempt = 0; attempt < 12; attempt++) {
        harness.deliveries.fail(
          "retry-delivery",
          nowMs + attempt * 60_000,
          "retryable"
        );
      }
      expect(harness.pendingActions(nowMs + 24 * 60 * 60 * 1000)).toEqual([]);
      expect(harness.deliveries.status(created.task.taskId)).toMatchObject([
        {
          state: "failed",
          error: expect.stringContaining("Automatic delivery stopped"),
        },
      ]);
      harness.deliveries.cleanupTerminal(nowMs + 31 * 24 * 60 * 60 * 1000);
      expect(harness.deliveries.status(created.task.taskId)).toEqual([]);
      expect(harness.deliveries.status("task-malformed")).toEqual([]);
    } finally {
      harness.close();
    }
  });
  it("commits delivery intent with the Task and recovers a failed handoff without repeating the mutation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00.000Z"));
    const harness = createSqlHarness();
    try {
      const members = new Map(
        [requester, assignee, reviewer].map((member) => [
          member.profileId,
          member,
        ])
      );
      const context = (actor: SpaceTaskActor) => ({
        actor,
        isSpaceOwner: actor.profileId === requester.profileId,
        resolveMember: (profileId: string) => members.get(profileId) ?? null,
      });
      const created = harness.service().create(
        {
          operationId: "create",
          title: "Deliver and review the fix",
          assigneeProfileId: assignee.profileId,
          reviewerProfileId: reviewer.profileId,
        },
        { ...context(requester), requestedBy: requester }
      );
      const started = harness.service().mutate(
        created.task.taskId,
        {
          action: "mark_in_progress",
          expectedRevision: created.task.revision,
          operationId: "start",
        },
        context(assignee)
      );
      const submission = {
        action: "submit_result" as const,
        expectedRevision: started.task.revision,
        operationId: "submit",
        summary: "The fix is ready for review.",
      };

      expect(() =>
        harness
          .service(true)
          .mutate(created.task.taskId, submission, context(assignee))
      ).toThrow("interrupted before commit");
      expect(harness.tasks.readTask(created.task.taskId)?.revision).toBe(
        started.task.revision
      );
      expect(harness.pendingActions(Date.now())).toEqual([]);

      const submitted = harness
        .service()
        .mutate(created.task.taskId, submission, context(assignee));
      expect(submitted.task.phase).toBe("in_review");
      expect(harness.pendingActions(Date.now())).toHaveLength(1);
      const publish = vi
        .fn()
        .mockRejectedValueOnce(new Error("publish failed"))
        .mockResolvedValueOnce(undefined);
      await flushSpaceTaskDeliveries({
        repository: harness.deliveries,
        deliver: (delivery) =>
          delivery.kind === "inbox_projection"
            ? Promise.resolve()
            : publish(delivery),
        onFailure: () => undefined,
      });
      expect(harness.deliveries.status(created.task.taskId)).toMatchObject([
        { kind: "handoff", state: "failed" },
      ]);
      vi.advanceTimersByTime(60_000);
      await flushSpaceTaskDeliveries({
        repository: harness.deliveries,
        deliver: (delivery) =>
          delivery.kind === "inbox_projection"
            ? Promise.resolve()
            : publish(delivery),
        onFailure: () => undefined,
      });
      expect(publish).toHaveBeenCalledTimes(2);
      expect(harness.deliveries.status(created.task.taskId)).toEqual([]);
      expect(
        harness
          .service()
          .mutate(created.task.taskId, submission, context(assignee)).applied
      ).toBe(false);
      expect(harness.tasks.listEvents(created.task.taskId)).toHaveLength(3);

      const canceled = harness.service().mutate(
        created.task.taskId,
        {
          action: "cancel",
          expectedRevision: submitted.task.revision,
          operationId: "cancel",
          reason: "No longer needed",
        },
        context(requester)
      );
      expect(
        isSpaceTaskDeliveryCurrent(
          {
            id: `${submitted.event.eventId}:handoff`,
            kind: "handoff",
            receipt: submitted,
            actor: assignee,
          },
          canceled.task
        )
      ).toBe(false);
    } finally {
      harness.close();
    }
  });
});
