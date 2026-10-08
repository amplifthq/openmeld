import {
  isLinearIssueCreateAction,
  readLinearIssueReference,
  spaceTaskSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { readLinearIssueDestination } from "../agent-core/project-issue-routing";
import { attachCreatedLinearIssueToSourceTask } from "../agent-core/space-task-linear-binding";
import { buildRemoteAgentToolContext } from "../agent-core/tool-context";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { linearIssueCreateInputSchema } from "./fixtures/linear-issue-action";
import { InMemoryDurableObjectStorage } from "./storage";

const teamId = "a86813e7-c458-4af2-8cfa-73a796d81201";
// These keys match the OpenConnector action's declared output and executor.
// https://github.com/amplifthq/open-connector/blob/83a5dbcaa320b5fc98ccb8c5846fc9589c58443f/src/providers/linear/executors.ts
const issue = {
  id: "73c7947f-5bba-4e67-a668-9392b70cd424",
  identifier: "PAY-82",
  issue_title: "Fix payment retry",
  ticket_url: "https://linear.app/acme/issue/PAY-82/fix-payment-retry",
};
const providerData = issue;

describe("Linear issue Task association", () => {
  it.each([
    "project_id",
    "team_id",
  ] as const)("rejects a renamed catalog target %s before mapping any issue write", (field) => {
    const { [field]: renamed, ...properties } =
      linearIssueCreateInputSchema.properties;
    expect(() =>
      readLinearIssueDestination({
        actionId: "linear.create_linear_issue",
        service: "linear",
        actionInput: {
          team_id: teamId,
          projectId: "ef7c6509-3077-4d49-999e-0ee1c41eaef1",
        },
        inputSchema: {
          ...linearIssueCreateInputSchema,
          properties: { ...properties, [field.replace("_id", "Id")]: renamed },
        },
      })
    ).toThrow("linear.issue_action_contract_changed");
  });
  it("keeps the exact optional Linear project and rejects undeclared target aliases", () => {
    const projectId = "ef7c6509-3077-4d49-999e-0ee1c41eaef1";
    const request = {
      actionId: "linear.create_linear_issue",
      service: "linear",
      inputSchema: linearIssueCreateInputSchema,
    };
    expect(
      readLinearIssueDestination({
        ...request,
        actionInput: { team_id: teamId, project_id: projectId },
      })
    ).toEqual({ provider: "linear", teamId, projectId });
    expect(() =>
      readLinearIssueDestination({
        ...request,
        actionInput: { team_id: teamId, projectId },
      })
    ).toThrow("linear.issue_action_contract_changed");
  });
  it("recognizes the OpenConnector action and snake_case target input", () => {
    expect(isLinearIssueCreateAction("linear.create_linear_issue")).toBe(true);
    expect(isLinearIssueCreateAction("linear.create_issue")).toBe(false);
    expect(
      readLinearIssueDestination({
        actionId: "linear.create_linear_issue",
        actionInput: { team_id: teamId },
        service: "linear",
        inputSchema: linearIssueCreateInputSchema,
      })
    ).toEqual({ provider: "linear", teamId });
  });

  it("requires a verified Linear identity and URL", () => {
    expect(
      readLinearIssueReference({
        actionInput: { team_id: teamId },
        data: providerData,
      })
    ).toMatchObject({
      id: issue.id,
      identifier: issue.identifier,
      provider: "linear",
      teamId,
      url: issue.ticket_url,
      lastObservedAt: null,
      lastObservedState: null,
    });
    expect(
      readLinearIssueReference({
        actionInput: { team_id: teamId },
        data: { ...issue, ticket_url: "https://example.com/issue/PAY-82" },
      })
    ).toBeNull();
  });

  it("attaches a confirmed issue only to the one eligible source Task", async () => {
    const base = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      turnEnvelope: {
        ...base.turnEnvelope,
        space: {
          ...base.turnEnvelope.space,
          kind: "space",
          isCenterAgentDm: false,
        },
        trigger: { source: "space_wake" },
      },
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: request.idempotencyKey,
          requestId: "request_123",
          status: "pending",
          submissionId: "submission_123",
        },
        nowMs: TEST_NOW_MS,
        request,
      })
    );
    const toolContext = await buildRemoteAgentToolContext({
      storage,
      submissionId: "submission_123",
      toolName: "openmeld_execute_app_action",
    });
    const actor = {
      ownerUserId: "user_1",
      profileId: request.agentProfileId,
      profileKind: "agent" as const,
      profileName: "Builder",
    };
    const task = spaceTaskSchema.parse({
      taskId: "tsk_55555555-5555-4555-8555-555555555555",
      spaceId: request.spaceId,
      title: "Fix payment retry",
      description: null,
      completionConditions: [],
      sourceSignalId: request.triggerMessageId,
      threadId: null,
      requestedBy: actor,
      createdBy: actor,
      assignee: actor,
      reviewer: null,
      phase: "to_do",
      result: null,
      review: null,
      automaticReworkRounds: 0,
      needsHumanDecision: false,
      externalWorkItems: [],
      projectIds: ["project-payments"],
      revision: 1,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    const item = readLinearIssueReference({
      actionInput: { team_id: teamId },
      data: providerData,
    });
    const linkedTask = {
      ...task,
      externalWorkItems: item ? [item] : [],
      revision: 2,
    };
    const mutateSpaceTask = vi.fn(async () => ({
      applied: true,
      task: linkedTask,
      event: {
        actor,
        createdAt: "2026-09-20T00:01:00.000Z",
        detail: issue.identifier,
        eventId: "tse_55555555-5555-4555-8555-555555555556",
        fromPhase: "to_do",
        operationId: `linear-issue-attach:${issue.id}:${task.taskId}`,
        taskId: task.taskId,
        taskRevision: 2,
        toPhase: "to_do",
        type: "external_work_item_attached",
      },
    }));
    await expect(
      attachCreatedLinearIssueToSourceTask({
        actionInput: { team_id: teamId },
        coreWorker: {
          listSpaceTasks: vi.fn(async () => ({
            tasks: [task],
            truncated: false,
          })),
          mutateSpaceTask,
        },
        data: providerData,
        projectId: "project-payments",
        toolContext,
      })
    ).resolves.toMatchObject({ linked: true, task: linkedTask });
    expect(mutateSpaceTask).toHaveBeenCalledWith({
      body: expect.objectContaining({
        action: "attach_external_work_item",
        item: expect.objectContaining({ id: issue.id, provider: "linear" }),
      }),
      context: toolContext.context,
      spaceId: request.spaceId,
      taskContractVersion: 2,
      taskId: task.taskId,
    });
  });
});
