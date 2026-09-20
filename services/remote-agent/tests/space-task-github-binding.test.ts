import {
  describeLinkedGitHubIssueClosePrompt,
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
          truncated: false,
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
      task: { taskId: existing.taskId },
    });
  });

  it("cancels still-active linked Tasks when the GitHub issue is closed", async () => {
    const linked = createTask({
      externalWorkItems: [ISSUE],
      phase: "in_progress",
      revision: 2,
    });
    const observed = createTask({
      ...linked,
      externalWorkItems: [{ ...ISSUE, lastObservedState: "closed" }],
      revision: 3,
    });
    const canceled = createTask({
      ...observed,
      phase: "canceled",
      revision: 4,
    });
    const mutateSpaceTask = vi.fn(async (input: { body: { action: string } }) =>
      receiptFor(input.body.action === "cancel" ? canceled : observed)
    );

    const summary = await applyGitHubIssueSpaceTaskBinding({
      actionId: "github.update_issue",
      actionInput: {
        issueNumber: 1143,
        owner: "amplifthq",
        repo: "openmeld",
        state: "closed",
      },
      data: { number: 1143, state: "closed" },
      ports: {
        createSpaceTask: vi.fn(),
        getSpaceTask: vi.fn(async () => ({ events: [], task: observed })),
        listSpaceTasks: vi.fn(async () => ({
          tasks: [linked],
          truncated: false,
        })),
        mutateSpaceTask,
      },
      toolContext: {
        context: CONTEXT,
        turnEnvelope: { space: SHARED_SPACE } as RemoteAgentTurnEnvelope,
      },
    });

    expect(
      mutateSpaceTask.mock.calls.map((call) => call[0].body.action)
    ).toEqual(["observe_external_work_item", "cancel"]);
    expect(summary?.closedTaskIds).toEqual([canceled.taskId]);
    expect(describeLinkedGitHubIssueClosePrompt(canceled)).toBeNull();
  });

  it("does not create or cancel Tasks for a body-only issue update", async () => {
    const summary = await applyGitHubIssueSpaceTaskBinding({
      actionId: "github.update_issue",
      actionInput: {
        body: "OpenMeld Task: tsk_55555555-5555-4555-8555-555555555555",
        issueNumber: 1143,
        owner: "amplifthq",
        repo: "openmeld",
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
    });
    expect(summary).toBeNull();
  });
});
