import { DatabaseSync } from "node:sqlite";
import type { SpaceTask, SpaceTaskActor } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enqueueSpaceTaskDeliveries,
  flushSpaceTaskDeliveries,
  isSpaceTaskDeliveryCurrent,
  resolveSpaceTaskHumanDecisionTarget,
} from "../src/space/application/space-task-delivery";
import { SpaceTaskService } from "../src/space/application/space-task-service";
import { SpaceTaskDeliveryRepository } from "../src/space/infrastructure/sql/space-task-delivery-repo";
import {
  ensureSpaceTaskTables,
  SpaceTaskRepository,
} from "../src/space/infrastructure/sql/space-task-repo";

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

function createSqlHarness() {
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
  return { close: () => database.close(), deliveries, service, tasks };
}

afterEach(() => vi.useRealTimers());

describe("Space Task durable delivery", () => {
  it("limits cancellation Stop references to the exact Task Signal and Agent", () => {
    const harness = createSqlHarness();
    try {
      harness.deliveries.recordWake("task-a", "handoff-1", assignee.profileId);
      expect(
        harness.deliveries.hasWake("task-a", "handoff-1", assignee.profileId)
      ).toBe(true);
      expect(
        harness.deliveries.hasWake("task-b", "handoff-1", assignee.profileId)
      ).toBe(false);
      expect(
        harness.deliveries.hasWake("task-a", "handoff-1", reviewer.profileId)
      ).toBe(false);
      expect(
        harness.deliveries.hasWake("task-a", "handoff-2", assignee.profileId)
      ).toBe(false);
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
      expect(harness.deliveries.pending(Date.now())).toEqual([]);

      const submitted = harness
        .service()
        .mutate(created.task.taskId, submission, context(assignee));
      expect(submitted.task.phase).toBe("in_review");
      expect(harness.deliveries.pending(Date.now())).toHaveLength(1);
      const publish = vi
        .fn()
        .mockRejectedValueOnce(new Error("publish failed"))
        .mockResolvedValueOnce(undefined);
      await flushSpaceTaskDeliveries({
        repository: harness.deliveries,
        deliver: publish,
        onFailure: () => undefined,
      });
      expect(harness.deliveries.status(created.task.taskId)).toMatchObject([
        { kind: "handoff", state: "failed" },
      ]);
      vi.advanceTimersByTime(60_000);
      await flushSpaceTaskDeliveries({
        repository: harness.deliveries,
        deliver: publish,
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
