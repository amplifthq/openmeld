import { DatabaseSync } from "node:sqlite";
import type { SpaceTask, SpaceTaskActor } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  enqueueSpaceTaskDeliveries,
  isSpaceTaskDeliveryCurrent,
} from "../src/space/application/space-task-delivery";
import { SpaceTaskService } from "../src/space/application/space-task-service";
import { SpaceTaskDeliveryRepository } from "../src/space/infrastructure/sql/space-task-delivery-repo";
import {
  ensureSpaceTaskTables,
  SpaceTaskRepository,
} from "../src/space/infrastructure/sql/space-task-repo";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const TASK_ID = "tsk_00000000-0000-4000-8000-000000000001";

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
  profileName: "Verifier",
};

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function createHarness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
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
  const service = new SpaceTaskService({
    repository: tasks,
    runTransaction: <T>(callback: () => T): T => {
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
    // Mirrors the Space DO wiring for a webhook: no authorized RPC context.
    onMutation: (receipt, previous) =>
      enqueueSpaceTaskDeliveries({
        repository: deliveries,
        receipt,
        previous,
        authorizedActor: false,
      }),
  });
  return {
    deliveries,
    handoffs: () =>
      deliveries
        .pending(Number.MAX_SAFE_INTEGER)
        .filter((delivery) => delivery.kind === "handoff"),
    service,
    tasks,
  };
}

function linkedTask(overrides: Partial<SpaceTask>): SpaceTask {
  const now = "2026-11-19T00:00:00.000Z";
  return {
    taskId: TASK_ID,
    spaceId: "space-1",
    title: "Fix guest quota bypass",
    description: null,
    completionConditions: [],
    sourceSignalId: null,
    threadId: null,
    requestedBy: requester,
    createdBy: requester,
    assignee,
    reviewer,
    phase: "in_review",
    result: {
      resultRevision: 1,
      summary: "Draft PR opened",
      submittedAt: now,
      submittedBy: assignee,
    },
    review: null,
    pullRequest: {
      owner: "acme",
      repo: "web",
      number: 42,
      url: "https://github.com/acme/web/pull/42",
      headSha: SHA_A,
    },
    automaticReworkRounds: 0,
    needsHumanDecision: false,
    externalWorkItems: [],
    projectIds: [],
    revision: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function observe(
  service: SpaceTaskService,
  headSha: string,
  operationId: string
) {
  return service.applyGitHubPullRequestObservation({
    identity: { number: 42, owner: "Acme", repo: "Web" },
    observeOperationId: operationId,
    observedAt: "2026-11-19T01:00:00.000Z",
    headSha,
    taskId: TASK_ID,
  });
}

describe("pull request head observation", () => {
  it("reopens an accepted review and queues a reviewer handoff for the new head", () => {
    const harness = createHarness();
    harness.tasks.insertTask(
      linkedTask({
        phase: "done",
        review: {
          decision: "accepted",
          feedback: null,
          resultRevision: 1,
          reviewedAt: "2026-11-19T00:30:00.000Z",
          reviewedBy: reviewer,
          pullRequestHeadSha: SHA_A,
        },
      })
    );

    const result = observe(harness.service, SHA_B, "observe-b");

    expect(result.updated).toBe(true);
    expect(result.task?.pullRequest?.headSha).toBe(SHA_B);
    expect(result.task?.phase).toBe("in_review");
    expect(result.task?.review).toBeNull();
    const handoffs = harness.handoffs();
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.receipt.event.type).toBe("pull_request_head_changed");
    expect(handoffs[0]?.receipt.task.reviewer?.profileId).toBe(
      reviewer.profileId
    );
    expect(handoffs[0]?.actor).toBeNull();
  });

  it("re-notifies the reviewer when the head moves while a review is pending", () => {
    const harness = createHarness();
    harness.tasks.insertTask(linkedTask({}));

    observe(harness.service, SHA_B, "observe-b");

    expect(harness.handoffs()).toHaveLength(1);
    expect(harness.tasks.readTask(TASK_ID)?.phase).toBe("in_review");
  });

  it("does not hand off while the assignee is still working", () => {
    const harness = createHarness();
    harness.tasks.insertTask(
      linkedTask({ phase: "in_progress", result: null })
    );

    const result = observe(harness.service, SHA_B, "observe-b");

    expect(result.updated).toBe(true);
    expect(harness.handoffs()).toHaveLength(0);
  });

  it("ignores an observation of the head already recorded", () => {
    const harness = createHarness();
    harness.tasks.insertTask(linkedTask({}));

    const result = observe(harness.service, SHA_A, "observe-a");

    expect(result).toMatchObject({ updated: false, skipReason: "stale" });
    expect(harness.handoffs()).toHaveLength(0);
  });

  it("treats a handoff for a superseded head as no longer current", () => {
    const harness = createHarness();
    harness.tasks.insertTask(linkedTask({}));

    observe(harness.service, SHA_B, "observe-b");
    const [handoffForB] = harness.handoffs();
    if (!handoffForB) {
      throw new Error("expected a handoff for head B");
    }
    const afterB = harness.tasks.readTask(TASK_ID);
    if (!afterB) {
      throw new Error("expected the Task to exist");
    }
    expect(isSpaceTaskDeliveryCurrent(handoffForB, afterB, harness.tasks)).toBe(
      true
    );

    observe(harness.service, SHA_C, "observe-c");
    const afterC = harness.tasks.readTask(TASK_ID);
    if (!afterC) {
      throw new Error("expected the Task to exist");
    }
    expect(isSpaceTaskDeliveryCurrent(handoffForB, afterC, harness.tasks)).toBe(
      false
    );
  });
});
