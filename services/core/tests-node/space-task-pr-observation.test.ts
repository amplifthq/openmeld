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
  _delivery: string,
  observedAt = "2026-11-19T01:00:00.000Z"
) {
  return service.applyGitHubPullRequestObservation({
    identity: { number: 42, owner: "Acme", repo: "Web" },
    observedAtMs: Date.parse(observedAt),
    heads: [{ headSha, beforeSha: _delivery === "before-link" ? null : SHA_A }],
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

  it("keeps the submitted head when an older delivery arrives before or after a same-head observation", () => {
    const harness = createHarness();
    const task = linkedTask({});
    harness.tasks.insertTask(task);

    observe(harness.service, SHA_B, "before-link", "2026-11-18T23:59:59.000Z");
    const sameSecond = "2026-11-19T01:00:00.000Z";
    // GitHub moved A -> B -> A in one second. The return to A arrived first.
    observe(harness.service, SHA_A, "back-at-a", sameSecond);
    observe(harness.service, SHA_B, "late-push-away-from-a", sameSecond);
    const result = observe(
      harness.service,
      SHA_B,
      "delayed-b",
      "2026-11-19T00:59:59.000Z"
    );

    expect(result).toMatchObject({ updated: false, skipReason: "stale" });
    expect(harness.tasks.readTask(TASK_ID)).toEqual(task);
    expect(harness.tasks.listEvents(TASK_ID)).toHaveLength(0);
    expect(harness.handoffs()).toHaveLength(0);
  });

  it("reconciles both delivery orders and a force-push round trip from retained evidence", () => {
    for (const [first, second, tip] of [
      [[SHA_A, SHA_B], [SHA_B, SHA_C], SHA_C],
      [[SHA_B, SHA_C], [SHA_A, SHA_B], SHA_C],
      [[SHA_B, SHA_A], [SHA_A, SHA_B], SHA_A],
      [[SHA_A, SHA_B], [SHA_B, SHA_A], SHA_A],
    ] as const) {
      const harness = createHarness();
      harness.tasks.insertTask(linkedTask({}));
      const snapshot = (edges: readonly (readonly [string, string])[]) =>
        harness.service.applyGitHubPullRequestObservation({
          taskId: TASK_ID,
          identity: { owner: "acme", repo: "web", number: 42 },
          observedAtMs: Date.parse("2026-11-19T01:00:00Z"),
          heads: edges.map(([beforeSha, headSha]) => ({ beforeSha, headSha })),
        });
      snapshot([first]);
      snapshot([second, first]);
      snapshot([first]);
      expect(harness.tasks.readTask(TASK_ID)?.pullRequest?.headSha).toBe(tip);
    }
  });

  it("blocks review while same-second evidence is disconnected, then accepts the reconciled head", () => {
    const harness = createHarness();
    harness.tasks.insertTask(linkedTask({}));
    const identity = { owner: "acme", repo: "web", number: 42 };
    const time = Date.parse("2026-11-19T01:00:00Z");
    const disconnected = [
      { beforeSha: SHA_A, headSha: SHA_B },
      { beforeSha: SHA_C, headSha: "d".repeat(40) },
    ];
    const apply = (heads: typeof disconnected) =>
      harness.service.applyGitHubPullRequestObservation({
        taskId: TASK_ID,
        identity,
        heads,
        observedAtMs: time,
      });
    expect(apply(disconnected).skipReason).toBe("pending");
    const review = (sha: string, revision: number) =>
      harness.service.mutate(
        TASK_ID,
        {
          action: "review",
          operationId: "accept-proof",
          expectedRevision: revision,
          expectedResultRevision: 1,
          expectedPullRequestHeadSha: sha,
          decision: "accepted",
        },
        { actor: reviewer, isSpaceOwner: false, resolveMember: () => reviewer }
      );
    expect(() => review(SHA_A, 3)).toThrow("conflicting heads");
    const confirmed = apply([
      ...disconnected,
      { beforeSha: SHA_B, headSha: SHA_C },
    ]).task;
    if (!confirmed?.pullRequest) {
      throw new Error("Missing reconciled pull request");
    }
    expect(
      review(confirmed.pullRequest.headSha, confirmed.revision).task.review
        ?.pullRequestHeadSha
    ).toBe("d".repeat(40));
  });

  it("admits a signed transition that occurred between reading a commit and submitting the result", () => {
    const harness = createHarness();
    const task = linkedTask({});
    if (!task.result) {
      throw new Error("Expected a submitted result");
    }
    harness.tasks.insertTask({
      ...task,
      result: { ...task.result, submittedAt: "2026-11-19T01:00:02.000Z" },
    });
    expect(
      observe(harness.service, SHA_B, "push", "2026-11-19T01:00:01.000Z").task
        ?.pullRequest?.headSha
    ).toBe(SHA_B);
  });

  it("preserves the human decision and its feedback when GitHub reports a new head", () => {
    const harness = createHarness();
    const task = linkedTask({
      automaticReworkRounds: 2,
      needsHumanDecision: true,
      review: {
        decision: "changes_requested",
        feedback: "A person must decide whether to continue.",
        resultRevision: 1,
        reviewedAt: "2026-11-19T00:30:00.000Z",
        reviewedBy: reviewer,
        pullRequestHeadSha: SHA_A,
      },
    });
    harness.tasks.insertTask(task);

    observe(harness.service, SHA_B, "observe-b");

    expect(harness.tasks.readTask(TASK_ID)).toMatchObject({
      automaticReworkRounds: 2,
      needsHumanDecision: true,
      phase: "in_review",
      pullRequest: { headSha: SHA_B },
      review: task.review,
    });
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

    const timeC = "2026-11-19T01:00:01.000Z";
    observe(harness.service, SHA_C, "observe-c", timeC);
    const afterC = harness.tasks.readTask(TASK_ID);
    if (!afterC) {
      throw new Error("expected the Task to exist");
    }
    expect(isSpaceTaskDeliveryCurrent(handoffForB, afterC, harness.tasks)).toBe(
      false
    );
    observe(harness.service, SHA_A, "older", "2026-11-19T00:59:59.000Z");
    observe(harness.service, SHA_B, "late-same-second", timeC);
    expect(harness.tasks.readTask(TASK_ID)).toEqual(afterC);
    expect(afterC.pullRequest?.headSha).toBe(SHA_C);
    // A genuinely later force push back to B is still a new review target.
    observe(
      harness.service,
      SHA_B,
      "force-push-back",
      "2026-11-19T01:00:02.000Z"
    );
    expect(harness.tasks.readTask(TASK_ID)?.pullRequest?.headSha).toBe(SHA_B);
  });
});
