import {
  SPACE_TASK_EXTERNAL_WORK_ITEM_LIMIT_ERROR_CODE,
  SPACE_TASK_LIST_MAX_ITEMS,
  spaceTaskMutationReceiptSchema,
  spaceTaskSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  RemoteAgentTurnEnvelope,
  SpaceTask,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  appendOpenMeldTaskReferenceToIssueBody,
  applyGitHubIssueSpaceTaskBinding,
  findSpaceTaskForGitHubIssue,
  readGitHubIssueIdentityFromWrite,
  type SpaceTaskGitHubBindingError,
  shouldBindGitHubIssueToSpaceTask,
} from "../agent-core/space-task-github-binding";

const ACTOR: SpaceTask["createdBy"] = {
  ownerUserId: "user-avery",
  profileId: "agt_11111111-1111-4111-8111-111111111111",
  profileKind: "agent",
  profileName: "Builder",
};

const SHARED_SPACE: RemoteAgentTurnEnvelope["space"] = {
  id: "space_shared",
  isCenterAgentDm: false,
  kind: "space",
  name: "Delivery",
};

const CONTEXT: OpenMeldRequestContext = {
  activeOrganizationId: "org_123",
  actorContext: {
    agentControllerRef: "hosted:center-agent",
    callerPrincipalId: ACTOR.profileId,
    openMeldProfileId: ACTOR.profileId,
    profileKind: "agent",
    requestId: "req-1",
  },
  agentControllerConversationId: "submission-1",
};

const ISSUE = {
  lastObservedAt: "2026-09-20T00:00:00.000Z",
  lastObservedState: "open" as const,
  number: 1143,
  owner: "amplifthq",
  provider: "github" as const,
  repo: "openmeld",
  url: "https://github.com/amplifthq/openmeld/issues/1143",
};

function createTask(overrides: Partial<SpaceTask> = {}): SpaceTask {
  return spaceTaskSchema.parse({
    assignee: ACTOR,
    automaticReworkRounds: 0,
    completionConditions: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    createdBy: ACTOR,
    description: null,
    needsHumanDecision: false,
    phase: "to_do",
    requestedBy: ACTOR,
    result: null,
    review: null,
    reviewer: null,
    revision: 1,
    sourceSignalId: null,
    spaceId: SHARED_SPACE.id,
    taskId: "tsk_55555555-5555-4555-8555-555555555555",
    threadId: null,
    title: "Follow GitHub issue #1143",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  });
}

function receiptFor(task: SpaceTask) {
  return spaceTaskMutationReceiptSchema.parse({
    applied: true,
    event: {
      actor: ACTOR,
      createdAt: task.updatedAt,
      detail: task.title,
      eventId: "tse_55555555-5555-4555-8555-555555555555",
      fromPhase: null,
      operationId: "op-1",
      taskId: task.taskId,
      taskRevision: task.revision,
      toPhase: task.phase,
      type: "created",
    },
    task,
  });
}

describe("GitHub issue Space Task binding", () => {
  it("binds created issues only in a shared Space", () => {
    expect(
      shouldBindGitHubIssueToSpaceTask({ ...SHARED_SPACE, kind: "dm" })
    ).toBe(false);
    expect(shouldBindGitHubIssueToSpaceTask(SHARED_SPACE)).toBe(true);
    expect(
      readGitHubIssueIdentityFromWrite({
        actionInput: { owner: "amplifthq", repo: "openmeld" },
        data: { number: 1143 },
      })
    ).toEqual({
      number: 1143,
      owner: "amplifthq",
      repo: "openmeld",
      url: "https://github.com/amplifthq/openmeld/issues/1143",
    });
  });

  it("creates a Task for a newly filed issue and appends a Task reference to the issue body", async () => {
    const created = createTask({ externalWorkItems: [ISSUE] });
    const createSpaceTask = vi.fn(async () => receiptFor(created));
    const summary = await applyGitHubIssueSpaceTaskBinding({
      actionId: "github.create_issue",
      actionInput: {
        owner: "amplifthq",
        repo: "openmeld",
        title: "Follow GitHub issue #1143",
      },
      data: { html_url: ISSUE.url, number: 1143 },
      now: ISSUE.lastObservedAt,
      ports: {
        createSpaceTask,
        getSpaceTask: vi.fn(),
        listSpaceTasks: vi.fn(async () => ({ tasks: [], truncated: false })),
        mutateSpaceTask: vi.fn(),
      },
      toolContext: {
        context: CONTEXT,
        turnEnvelope: {
          organization: {
            id: "org_123",
            memberCount: 1,
            name: "Acme",
            personal: false,
            webUrl: "https://app.openmeld.example/o/acme",
          },
          space: SHARED_SPACE,
        } as RemoteAgentTurnEnvelope,
      },
    });

    expect(createSpaceTask).toHaveBeenCalledTimes(1);
    expect(createSpaceTask).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ assigneeProfileId: null }),
      })
    );
    expect(summary).toMatchObject({
      created: true,
      issueBodyAppendix: `OpenMeld Task: https://app.openmeld.example/o/acme/spaces/${SHARED_SPACE.id} (${created.taskId})`,
      task: { taskId: created.taskId },
    });
    expect(
      appendOpenMeldTaskReferenceToIssueBody(
        "File this from the Space.",
        summary?.issueBodyAppendix ?? ""
      )
    ).toContain(created.taskId);
  });

  it("reuses an already linked Task instead of creating another card", async () => {
    const existing = createTask({ externalWorkItems: [ISSUE] });
    const createSpaceTask = vi.fn();
    const summary = await applyGitHubIssueSpaceTaskBinding({
      actionId: "github.create_issue",
      actionInput: {
        owner: "AmpliftHQ",
        repo: "openmeld",
        title: existing.title,
      },
      data: { number: 1143 },
      ports: {
        createSpaceTask,
        getSpaceTask: vi.fn(),
        listSpaceTasks: vi.fn(async () => ({
          tasks: [existing],
          truncated: true,
        })),
        mutateSpaceTask: vi.fn(),
      },
      toolContext: {
        context: CONTEXT,
        turnEnvelope: { space: SHARED_SPACE } as RemoteAgentTurnEnvelope,
      },
    });

    expect(createSpaceTask).not.toHaveBeenCalled();
    expect(findSpaceTaskForGitHubIssue([existing], ISSUE)?.taskId).toBe(
      existing.taskId
    );
    expect(summary).toMatchObject({
      created: false,
      issueBodyAppendix: `OpenMeld Task: ${existing.taskId}`,
      task: { taskId: existing.taskId },
    });
  });

  it.each([
    "done",
    "canceled",
    "in_review",
    "in_progress",
  ] as const)("reports only terminal Tasks as closed after provider synchronization: %s", async (phase) => {
    const linked = createTask({
      externalWorkItems: [ISSUE],
      phase,
      revision: 2,
    });
    const mutateSpaceTask = vi.fn();
    const summary = await applyGitHubIssueSpaceTaskBinding({
      actionId: "github.update_issue",
      eventIdentity: "close-1",
      actionInput: {
        owner: ISSUE.owner,
        repo: ISSUE.repo,
        issueNumber: ISSUE.number,
        state: "closed",
      },
      data: {
        number: ISSUE.number,
        state: "closed",
        state_reason: "completed",
      },
      ports: {
        createSpaceTask: vi.fn(),
        getSpaceTask: vi.fn(),
        mutateSpaceTask,
        listSpaceTasks: vi.fn(async () => ({
          tasks: [linked],
          truncated: false,
        })),
      },
      toolContext: {
        context: CONTEXT,
        turnEnvelope: { space: SHARED_SPACE } as RemoteAgentTurnEnvelope,
      },
    });
    expect(mutateSpaceTask).not.toHaveBeenCalled();
    expect(summary?.closedTaskIds).toEqual(
      phase === "done" || phase === "canceled" ? [linked.taskId] : []
    );
    expect(summary?.task?.phase).toBe(phase);
  });

  it("refuses a linked issue close without a stable provider operation identity", async () => {
    await expect(
      applyGitHubIssueSpaceTaskBinding({
        actionId: "github.update_issue",
        actionInput: {
          issueNumber: 1143,
          owner: "amplifthq",
          repo: "openmeld",
          state: "closed",
        },
        data: { number: 1143 },
        ports: {
          createSpaceTask: vi.fn(),
          getSpaceTask: vi.fn(),
          listSpaceTasks: vi.fn(),
          mutateSpaceTask: vi.fn(),
        },
        toolContext: {
          context: CONTEXT,
          turnEnvelope: { space: SHARED_SPACE } as RemoteAgentTurnEnvelope,
        },
      })
    ).rejects.toMatchObject({
      code: "space_task.github_event_identity_required",
    });
  });

  it.each([
    { actionId: "github.update_issue", space: SHARED_SPACE },
    { actionId: "github.get_issue", space: SHARED_SPACE },
    {
      actionId: "github.create_issue",
      space: { ...SHARED_SPACE, kind: "dm" as const },
    },
  ])("does not acquire an observation or bind Tasks for $actionId in $space.kind when no binding applies", async ({
    actionId,
    space,
  }) => {
    const readObservationAt = vi.fn(async () => ISSUE.lastObservedAt);
    const summary = await applyGitHubIssueSpaceTaskBinding({
      actionId,
      actionInput: {
        body: "OpenMeld Task: tsk_55555555-5555-4555-8555-555555555555",
        issueNumber: 1143,
        owner: "amplifthq",
        repo: "openmeld",
      },
      data: { number: 1143 },
      now: readObservationAt,
      ports: {
        createSpaceTask: vi.fn(),
        getSpaceTask: vi.fn(),
        listSpaceTasks: vi.fn(),
        mutateSpaceTask: vi.fn(),
      },
      toolContext: {
        context: CONTEXT,
        turnEnvelope: { space } as RemoteAgentTurnEnvelope,
      },
    });
    expect(summary).toBeNull();
    expect(readObservationAt).not.toHaveBeenCalled();
  });

  it.each([
    {
      actionId: "github.create_issue" as const,
      actionInput: {
        owner: "amplifthq",
        repo: "openmeld",
        title: "Follow GitHub issue #1143",
      },
      data: { html_url: ISSUE.url, number: 1143 },
    },
    {
      actionId: "github.update_issue" as const,
      actionInput: {
        issueNumber: 1143,
        owner: "amplifthq",
        repo: "openmeld",
        state: "closed",
      },
      data: { number: 1143, state: "closed" },
    },
  ])("does not treat a truncated Task list miss as not found for $actionId", async ({
    actionId,
    actionInput,
    data,
  }) => {
    const createSpaceTask = vi.fn();
    const mutateSpaceTask = vi.fn();
    await expect(
      applyGitHubIssueSpaceTaskBinding({
        actionId,
        actionInput,
        data,
        eventIdentity: "truncated-list-write",
        ports: {
          createSpaceTask,
          getSpaceTask: vi.fn(),
          listSpaceTasks: vi.fn(async () => ({
            tasks: [],
            truncated: true,
          })),
          mutateSpaceTask,
        },
        toolContext: {
          context: CONTEXT,
          turnEnvelope: { space: SHARED_SPACE } as RemoteAgentTurnEnvelope,
        },
      })
    ).rejects.toThrowError(
      expect.objectContaining<Partial<SpaceTaskGitHubBindingError>>({
        code: SPACE_TASK_EXTERNAL_WORK_ITEM_LIMIT_ERROR_CODE,
        message: `This Space has more than ${SPACE_TASK_LIST_MAX_ITEMS} Tasks, so OpenMeld cannot confirm whether GitHub issue amplifthq/openmeld#1143 already has a linked Task.`,
        name: "SpaceTaskGitHubBindingError",
      })
    );
    expect(createSpaceTask).not.toHaveBeenCalled();
    expect(mutateSpaceTask).not.toHaveBeenCalled();
  });
});
