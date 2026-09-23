import type {
  MutateSpaceTaskBody,
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskEvent,
  SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type SpaceTaskRepositoryPort,
  SpaceTaskService,
} from "../space/application/space-task-service";
import {
  mutateSpaceTask,
  projectSpaceTaskAllowedActions,
  type SpaceTaskMutationContext,
  type SpaceTaskWorkflowError,
} from "../space/application/space-task-workflow";

const requester: SpaceTaskActor = {
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human",
  profileName: "Avery",
  ownerUserId: "user-avery",
};
const agent: SpaceTaskActor = {
  profileId: "agt_22222222-2222-4222-8222-222222222222",
  profileKind: "agent",
  profileName: "Builder",
  ownerUserId: "user-avery",
};
const secondAgent: SpaceTaskActor = {
  profileId: "agt_33333333-3333-4333-8333-333333333333",
  profileKind: "agent",
  profileName: "Fixer",
  ownerUserId: "user-avery",
};
const humanReviewer: SpaceTaskActor = {
  profileId: "44444444-4444-4444-8444-444444444444",
  profileKind: "human",
  profileName: "Riley",
  ownerUserId: "user-riley",
};
const agentReviewer: SpaceTaskActor = {
  profileId: "agt_66666666-6666-4666-8666-666666666666",
  profileKind: "agent",
  profileName: "Checker",
  ownerUserId: "user-riley",
};
const members = new Map(
  [requester, agent, secondAgent, humanReviewer, agentReviewer].map(
    (member) => [member.profileId, member]
  )
);

const context = (
  actor: SpaceTaskActor,
  isSpaceOwner = false
): SpaceTaskMutationContext => ({
  actor,
  isSpaceOwner,
  resolveMember: (profileId) => members.get(profileId) ?? null,
});

const task = (overrides: Partial<SpaceTask> = {}): SpaceTask => ({
  taskId: "tsk_55555555-5555-4555-8555-555555555555",
  spaceId: "space-1",
  title: "Ship Tasks",
  description: null,
  completionConditions: ["The result is reviewable"],
  sourceSignalId: "signal-1",
  threadId: "thread-1",
  requestedBy: requester,
  createdBy: requester,
  assignee: agent,
  reviewer: null,
  phase: "to_do",
  result: null,
  review: null,
  automaticReworkRounds: 0,
  needsHumanDecision: false,
  externalWorkItems: [],
  revision: 1,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  ...overrides,
});

const apply = (
  current: SpaceTask,
  command: MutateSpaceTaskBody,
  actor: SpaceTaskActor,
  now = "2026-09-15T01:00:00.000Z"
) =>
  mutateSpaceTask({
    task: current,
    command,
    context: context(actor),
    now,
  }).task;

describe("Space Task workflow", () => {
  it("keeps assignment separate from starting work and returns reassigned work to To do", () => {
    const assigned = apply(
      task({ assignee: null }),
      {
        action: "assign",
        assigneeProfileId: agent.profileId,
        expectedRevision: 1,
        operationId: "assign-1",
      },
      requester
    );
    expect(assigned.phase).toBe("to_do");

    const started = apply(
      assigned,
      {
        action: "mark_in_progress",
        expectedRevision: 2,
        operationId: "start-1",
      },
      agent
    );
    const reassigned = apply(
      started,
      {
        action: "assign",
        assigneeProfileId: secondAgent.profileId,
        expectedRevision: 3,
        operationId: "assign-2",
      },
      requester
    );
    expect(reassigned.phase).toBe("to_do");
    expect(reassigned.assignee).toEqual(secondAgent);
  });

  it("completes without a reviewer and never reuses a result identity after reopening", () => {
    const submitted = apply(
      task({ phase: "in_progress" }),
      {
        action: "submit_result",
        expectedRevision: 1,
        operationId: "submit-1",
        summary: "Implemented and verified the Space Tasks flow.",
      },
      agent
    );
    expect(submitted.phase).toBe("done");
    expect(submitted.result).toMatchObject({
      resultRevision: submitted.revision,
      submittedBy: agent,
    });
    const reopened = apply(
      submitted,
      {
        action: "reopen",
        expectedRevision: submitted.revision,
        operationId: "reopen-completed",
        reason: "A new deliverable is required",
      },
      requester
    );
    const restarted = apply(
      reopened,
      {
        action: "mark_in_progress",
        expectedRevision: reopened.revision,
        operationId: "restart-completed",
      },
      agent
    );
    const resubmitted = apply(
      restarted,
      {
        action: "submit_result",
        expectedRevision: restarted.revision,
        operationId: "resubmit-completed",
        summary: "New verified result",
      },
      agent
    );
    expect(resubmitted.result?.resultRevision).toBe(resubmitted.revision);
    expect(resubmitted.result?.resultRevision).toBeGreaterThan(
      submitted.result?.resultRevision ?? 0
    );
  });

  it("routes Agent review round trips back twice and then requires a human decision", () => {
    let current = task({ phase: "in_progress", reviewer: agentReviewer });

    for (let resultRevision = 1; resultRevision <= 3; resultRevision += 1) {
      current = apply(
        current,
        {
          action: "submit_result",
          expectedRevision: current.revision,
          operationId: `submit-${resultRevision}`,
          summary: `Result ${resultRevision}`,
        },
        agent
      );
      current = apply(
        current,
        {
          action: "review",
          expectedResultRevision: current.revision,
          decision: "changes_requested",
          expectedRevision: current.revision,
          feedback: `Fix ${resultRevision}`,
          operationId: `review-${resultRevision}`,
        },
        agentReviewer
      );
      if (resultRevision < 3) {
        expect(current.phase).toBe("in_progress");
        expect(current.automaticReworkRounds).toBe(resultRevision);
        expect(current.needsHumanDecision).toBe(false);
      }
    }

    expect(current.assignee).toEqual(agent);
    expect(current.reviewer).toEqual(agentReviewer);
    expect(current.phase).toBe("in_review");
    expect(current.automaticReworkRounds).toBe(2);
    expect(current.needsHumanDecision).toBe(true);

    expect(() =>
      mutateSpaceTask({
        task: current,
        command: {
          action: "continue_rework",
          expectedRevision: current.revision,
          operationId: "continue-by-agent",
          reason: "Try again",
        },
        context: context(agent, true),
      })
    ).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.human_decision_required",
      })
    );

    const continued = mutateSpaceTask({
      task: current,
      command: {
        action: "continue_rework",
        expectedRevision: current.revision,
        operationId: "continue-by-human",
        reason: "One final correction",
      },
      context: context(requester),
      now: "2026-09-15T02:00:00.000Z",
    }).task;
    expect(continued.phase).toBe("in_progress");
    expect(continued.needsHumanDecision).toBe(false);
  });

  it("lets a human reviewer request changes repeatedly without tripping the Agent rework cutoff", () => {
    let current = task({ phase: "in_progress", reviewer: humanReviewer });

    for (let resultRevision = 1; resultRevision <= 4; resultRevision += 1) {
      current = apply(
        current,
        {
          action: "submit_result",
          expectedRevision: current.revision,
          operationId: `human-review-submit-${resultRevision}`,
          summary: `Result ${resultRevision}`,
        },
        agent
      );
      current = apply(
        current,
        {
          action: "review",
          expectedResultRevision: current.revision,
          decision: "changes_requested",
          expectedRevision: current.revision,
          feedback: `Fix ${resultRevision}`,
          operationId: `human-review-${resultRevision}`,
        },
        humanReviewer
      );
      expect(current.phase).toBe("in_progress");
      expect(current.needsHumanDecision).toBe(false);
      expect(current.automaticReworkRounds).toBe(0);
      expect(current.review?.reviewedBy).toEqual(humanReviewer);
    }
  });

  it("rejects stale writes and prevents work from continuing after cancellation", () => {
    expect(() =>
      apply(
        task({ revision: 4 }),
        {
          action: "assign",
          assigneeProfileId: secondAgent.profileId,
          expectedRevision: 3,
          operationId: "stale-assign",
        },
        requester
      )
    ).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.revision_conflict",
      })
    );

    const canceled = apply(
      task({ phase: "in_progress" }),
      {
        action: "cancel",
        expectedRevision: 1,
        operationId: "cancel-1",
        reason: "The request is no longer needed.",
      },
      requester
    );
    expect(canceled.phase).toBe("canceled");
    expect(() =>
      apply(
        canceled,
        {
          action: "submit_result",
          expectedRevision: 2,
          operationId: "late-result",
          summary: "Late result",
        },
        agent
      )
    ).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.invalid_transition",
      })
    );
  });

  it.each([
    "accepted",
    "changes_requested",
  ] as const)("requires an attributed reason for a human owner %s override and honors that human decision", (decision) => {
    const awaitingReview = task({
      phase: "in_review",
      reviewer: agentReviewer,
      automaticReworkRounds: 2,
      needsHumanDecision: true,
      result: {
        resultRevision: 1,
        summary: "Verified result",
        submittedAt: "2026-09-15T01:00:00.000Z",
        submittedBy: agent,
      },
    });
    expect(() =>
      mutateSpaceTask({
        task: awaitingReview,
        command: {
          action: "review",
          expectedResultRevision: 1,
          decision,
          expectedRevision: 1,
          operationId: "owner-review-without-reason",
        },
        context: context(requester, true),
      })
    ).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.override_reason_required",
      })
    );

    const accepted = mutateSpaceTask({
      task: awaitingReview,
      command: {
        action: "review",
        expectedResultRevision: 1,
        decision,
        expectedRevision: 1,
        feedback: "Owner override: required reviewer is unavailable.",
        operationId: "owner-review-with-reason",
      },
      context: context(requester, true),
    }).task;
    expect(accepted.phase).toBe(
      decision === "accepted" ? "done" : "in_progress"
    );
    expect(accepted.needsHumanDecision).toBe(false);
    expect(accepted.review?.reviewedBy).toEqual(requester);
  });

  it("rejects review of a different result even with the latest Task revision", () => {
    const awaitingReview = task({
      phase: "in_review",
      reviewer: humanReviewer,
      revision: 5,
      result: {
        resultRevision: 2,
        summary: "A new result the reviewer has not read",
        submittedAt: "2026-09-15T01:00:00.000Z",
        submittedBy: agent,
      },
    });
    expect(() =>
      mutateSpaceTask({
        task: awaitingReview,
        command: {
          action: "review",
          decision: "accepted",
          expectedRevision: 5,
          expectedResultRevision: 1,
          operationId: "stale-result-review",
        },
        context: context(humanReviewer),
      })
    ).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.result_revision_conflict",
        status: 409,
      })
    );
  });

  it("projects owner review authority while hiding actions from unrelated and public viewers", () => {
    const awaitingReview = task({
      phase: "in_review",
      reviewer: agentReviewer,
      result: {
        resultRevision: 1,
        summary: "Submitted result",
        submittedAt: "2026-09-15T01:00:00.000Z",
        submittedBy: agent,
      },
    });
    expect(
      projectSpaceTaskAllowedActions(
        awaitingReview,
        context(humanReviewer, true)
      )
    ).toContain("review");
    expect(
      projectSpaceTaskAllowedActions(awaitingReview, context(agentReviewer))
    ).toEqual(["review"]);
    expect(
      projectSpaceTaskAllowedActions(awaitingReview, context(humanReviewer))
    ).toEqual([]);
    expect(projectSpaceTaskAllowedActions(awaitingReview, null)).toEqual([]);
    expect(
      projectSpaceTaskAllowedActions(
        task({ phase: "canceled" }),
        context(agent)
      )
    ).not.toContain("submit_result");
    expect(
      projectSpaceTaskAllowedActions(
        task({ phase: "canceled" }),
        context(requester)
      )
    ).toContain("reopen");
  });

  it("replays an exact create operation without duplicating the Task or event", () => {
    const tasks = new Map<string, SpaceTask>();
    const events: SpaceTaskEvent[] = [];
    const operations = new Map<
      string,
      { requestJson: string; receipt: SpaceTaskMutationReceipt }
    >();
    const repository: SpaceTaskRepositoryPort = {
      appendEvent: (event) => events.push(event),
      insertTask: (inserted) => tasks.set(inserted.taskId, inserted),
      listEvents: (taskId) => events.filter((event) => event.taskId === taskId),
      listTasks: () => [...tasks.values()],
      readOperation: (operationId) => operations.get(operationId) ?? null,
      readTask: (taskId) => tasks.get(taskId) ?? null,
      recordOperation: (operation) => {
        operations.set(operation.operationId, operation);
      },
      updateTask: (updated) => tasks.set(updated.taskId, updated),
    };
    const service = new SpaceTaskService({
      repository,
      runTransaction: (callback) => callback(),
      spaceId: "space-1",
    });
    const createContext = { ...context(requester), requestedBy: requester };
    const createBody = {
      operationId: "create-task-1",
      title: "Implement Space Tasks",
      assigneeProfileId: agent.profileId,
    };

    const first = service.create(createBody, createContext);
    const replay = service.create(createBody, createContext);

    expect(first.applied).toBe(true);
    expect(replay).toMatchObject({
      applied: false,
      task: { taskId: first.task.taskId },
    });
    expect(tasks.size).toBe(1);
    expect(events).toHaveLength(1);
    expect(() =>
      service.create(
        { ...createBody, title: "A different commitment" },
        createContext
      )
    ).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.operation_conflict",
      })
    );
  });
});

const githubIssue = {
  lastObservedAt: "2026-09-20T00:00:00.000Z",
  lastObservedState: "open" as const,
  number: 1143,
  owner: "amplifthq",
  provider: "github" as const,
  repo: "openmeld",
  url: "https://github.com/amplifthq/openmeld/issues/1143",
};

describe("Space Task GitHub issue links", () => {
  it("attaches a GitHub issue, rejects a second distinct copy, and observes close after cancel", () => {
    const linked = apply(
      task(),
      {
        action: "attach_external_work_item",
        expectedRevision: 1,
        item: githubIssue,
        operationId: "attach-1",
      },
      requester
    );
    expect(linked.externalWorkItems).toEqual([githubIssue]);

    const refreshed = apply(
      linked,
      {
        action: "attach_external_work_item",
        expectedRevision: 2,
        item: {
          ...githubIssue,
          lastObservedAt: "2026-09-20T01:00:00.000Z",
          owner: "AmpliftHQ",
        },
        operationId: "attach-2",
      },
      requester
    );
    expect(refreshed.externalWorkItems).toHaveLength(1);
    expect(refreshed.externalWorkItems[0]?.lastObservedAt).toBe(
      "2026-09-20T01:00:00.000Z"
    );

    const canceled = apply(
      refreshed,
      {
        action: "cancel",
        expectedRevision: 3,
        operationId: "cancel-1",
        reason: "GitHub issue amplifthq/openmeld#1143 was closed.",
      },
      requester
    );
    expect(canceled.phase).toBe("canceled");

    const observed = apply(
      canceled,
      {
        action: "observe_external_work_item",
        expectedRevision: 4,
        lastObservedState: "closed",
        number: 1143,
        operationId: "observe-1",
        owner: "amplifthq",
        provider: "github",
        repo: "openmeld",
      },
      requester,
      "2026-09-20T02:00:00.000Z"
    );
    expect(observed.externalWorkItems[0]).toMatchObject({
      lastObservedAt: "2026-09-20T02:00:00.000Z",
      lastObservedState: "closed",
    });
  });
});
