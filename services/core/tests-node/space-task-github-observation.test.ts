import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { spaceTaskGitHubIssueOperationId } from "@openmeld/schemas";
import type { SpaceTask, SpaceTaskActor } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { SpaceTaskService } from "../src/space/application/space-task-service";
import { applyGitHubIssueProviderObservation } from "../src/space/application/space-task-workflow";
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

const githubIssue = {
  lastObservedAt: "2026-09-20T00:00:00.000Z",
  lastObservedState: "open" as const,
  number: 1143,
  owner: "amplifthq",
  provider: "github" as const,
  repo: "openmeld",
  url: "https://github.com/amplifthq/openmeld/issues/1143",
};

const task = (overrides: Partial<SpaceTask> = {}): SpaceTask => ({
  assignee: null,
  automaticReworkRounds: 0,
  completionConditions: [],
  createdAt: "2026-09-20T00:00:00.000Z",
  createdBy: requester,
  description: null,
  externalWorkItems: [githubIssue],
  projectIds: [],
  needsHumanDecision: false,
  phase: "in_progress",
  requestedBy: requester,
  result: null,
  review: null,
  reviewer: null,
  revision: 1,
  sourceSignalId: null,
  spaceId: "space-1",
  taskId: "tsk_55555555-5555-4555-8555-555555555555",
  threadId: null,
  title: "Follow GitHub issue #1143",
  updatedAt: "2026-09-20T00:00:00.000Z",
  ...overrides,
});

describe("GitHub issue provider observation", () => {
  it("preserves the result under review when GitHub repeats a completed closure", () => {
    const first = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T03:00:00.000Z",
      observedState: "closed",
      observedStateReason: "completed",
      task: task({ reviewer: requester }),
    }).settle;
    if (!first) {
      throw new Error("Completed issue must submit a result for review");
    }
    const repeated = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T04:00:00.000Z",
      observedState: "closed",
      observedStateReason: "completed",
      task: first.task,
    });
    expect(repeated.settle).toBeNull();
    expect(repeated.observe?.task.result).toEqual(first.task.result);
    expect(repeated.observe?.task.phase).toBe("in_review");
  });
  it.each([
    ["completed", null, "done"],
    ["completed", requester, "in_review"],
    ["not_planned", null, "canceled"],
    ["duplicate", null, "canceled"],
    [null, null, "in_progress"],
    ["unknown_reason", null, "in_progress"],
  ] as const)("maps closure reason %s without bypassing review", (reason, reviewer, phase) => {
    const result = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T03:00:00.000Z",
      observedState: "closed",
      observedStateReason: reason,
      task: task({ reviewer }),
    });
    expect((result.settle ?? result.observe)?.task.phase).toBe(phase);
    if (reason === "completed") {
      expect(result.settle?.task.result?.submittedBy).toEqual({
        provider: "github",
      });
      expect(result.settle?.task.result?.summary).toContain("completed");
      expect(result.settle?.task.review).toBeNull();
    }
  });

  it("persists repeated close and reopen deliveries without reusing earlier operation receipts", () => {
    const database = new DatabaseSync(":memory:");
    const sql = {
      exec: (query: string, ...params: SQLInputValue[]) => {
        const rows = database.prepare(query).all(...params);
        return { toArray: () => rows };
      },
    } as unknown as SqlStorage;
    try {
      ensureSpaceTaskTables(sql);
      const service = new SpaceTaskService({
        repository: new SpaceTaskRepository(sql),
        runTransaction: (callback) => {
          database.exec("BEGIN");
          try {
            const result = callback();
            database.exec("COMMIT");
            return result;
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
        },
        spaceId: "space-1",
      });
      const context = {
        actor: requester,
        isSpaceOwner: true,
        requestedBy: requester,
        resolveMember: () => requester,
      };
      const created = service.create(
        {
          externalWorkItems: [githubIssue],
          operationId: "create-linked-task",
          title: "Follow GitHub issue #1143",
        },
        context
      );
      const observe = (
        state: "closed" | "open",
        hour: number,
        deliveryId: string
      ) =>
        service.applyGitHubIssueObservation({
          settleOperationId: spaceTaskGitHubIssueOperationId(
            "settle",
            githubIssue,
            created.task.taskId,
            deliveryId
          ),
          identity: githubIssue,
          observeOperationId: spaceTaskGitHubIssueOperationId(
            state === "closed" ? "observe-closed" : "observe-open",
            githubIssue,
            created.task.taskId,
            deliveryId
          ),
          observedAt: `2026-09-20T0${hour}:00:00.000Z`,
          observedState: state,
          observedStateReason: state === "closed" ? "not_planned" : "reopened",
          taskId: created.task.taskId,
        });

      expect(observe("closed", 1, "delivery-close-1").canceled).toBe(true);
      const firstClose = service.read(created.task.taskId);
      expect(
        firstClose.events
          .filter((event) => event.type !== "created")
          .map((event) => event.actor)
      ).toEqual([{ provider: "github" }, { provider: "github" }]);
      observe("closed", 1, "delivery-close-1");
      expect(service.read(created.task.taskId)).toEqual(firstClose);
      expect(observe("open", 2, "delivery-open-1").task).toMatchObject({
        phase: "canceled",
        externalWorkItems: [{ lastObservedState: "open" }],
      });
      expect(observe("closed", 3, "delivery-close-2").task).toMatchObject({
        phase: "canceled",
        externalWorkItems: [{ lastObservedState: "closed" }],
      });

      const current = service.read(created.task.taskId).task;
      service.mutate(
        current.taskId,
        {
          action: "reopen",
          expectedRevision: current.revision,
          operationId: "reopen-linked-task",
          reason: "Resume tracking the reopened GitHub issue.",
        },
        context
      );
      observe("open", 4, "delivery-open-2");
      expect(observe("closed", 5, "delivery-close-3").canceled).toBe(true);
      const final = service.read(current.taskId);
      expect(final.task).toMatchObject({
        phase: "canceled",
        externalWorkItems: [{ lastObservedAt: "2026-09-20T05:00:00.000Z" }],
      });
      expect(
        final.events.filter((event) => event.type === "canceled")
      ).toHaveLength(2);
      observe("closed", 5, "delivery-close-3");
      expect(service.read(current.taskId)).toEqual(final);
    } finally {
      database.close();
    }
  });

  it("cancels an active linked Task on close and does not reopen Done on reopen", () => {
    const closed = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T03:00:00.000Z",
      observedState: "closed",
      observedStateReason: "not_planned",
      task: task(),
    });
    expect(closed.skipReason).toBeNull();
    expect(closed.observe?.task.externalWorkItems[0]).toMatchObject({
      lastObservedAt: "2026-09-20T03:00:00.000Z",
      lastObservedState: "closed",
    });
    expect(closed.settle?.task.phase).toBe("canceled");

    expect(
      applyGitHubIssueProviderObservation({
        identity: githubIssue,
        observedAt: "2026-09-20T02:00:00.000Z",
        observedState: "closed",
        task: closed.observe?.task ?? task(),
      })
    ).toMatchObject({ settle: null, skipReason: "stale" });

    const equalTimestampStillCancels = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T03:00:00.000Z",
      observedState: "closed",
      observedStateReason: "not_planned",
      task: {
        ...(closed.observe?.task ?? task()),
        phase: "in_progress",
      },
    });
    expect(equalTimestampStillCancels.observe).toBeNull();
    expect(equalTimestampStillCancels.settle?.task.phase).toBe("canceled");

    const reopenedDone = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T04:00:00.000Z",
      observedState: "open",
      task: task({
        externalWorkItems: [
          {
            ...githubIssue,
            lastObservedAt: "2026-09-20T03:00:00.000Z",
            lastObservedState: "closed",
          },
        ],
        phase: "done",
      }),
    });
    expect(reopenedDone.settle).toBeNull();
    expect(reopenedDone.observe?.task.phase).toBe("done");
    expect(
      reopenedDone.observe?.task.externalWorkItems[0]?.lastObservedState
    ).toBe("open");

    expect(
      applyGitHubIssueProviderObservation({
        identity: githubIssue,
        observedAt: "2026-09-20T03:00:00.000Z",
        observedState: "closed",
        task: task({ externalWorkItems: [] }),
      }).skipReason
    ).toBe("not_linked");
  });
});
