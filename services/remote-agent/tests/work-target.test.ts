import type { CenterAgentWorkTargetResponse } from "@openmeld/schemas/types";
import { strictObject } from "valibot";
import { expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  guardCenterAgentWorkTarget,
  readCenterAgentWorkTargetFacts,
} from "../flue-adapter/work-target";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const target: CenterAgentWorkTargetResponse = {
  selectionRequired: false,
  record: {
    target: {
      requestGoal: "Review the intent PR in reply, not openmeld",
      codeRepositories: [{ owner: "amplifthq", repo: "reply" }],
      issueDestinations: [
        {
          provider: "linear",
          teamId: "11111111-1111-4111-8111-111111111111",
        },
      ],
    },
    revision: 2,
    sourceSignalId: "repository-correction",
    sourceRevision: 0,
    sourceProfileId: "requester",
    sourceProfileKind: "human",
  },
};

it.each([
  {
    name: "github_list_pull_requests",
    payload: { owner: "amplifthq", repo: "openmeld" },
    blocked: true,
  },
  {
    name: "github_list_pull_requests",
    payload: { owner: "AmpliftHQ", repo: "Reply" },
    blocked: false,
  },
  {
    name: "github_execute_action",
    payload: {
      actionId: "github.create_issue",
      input: { owner: "amplifthq", repo: "reply" },
    },
    blocked: true,
  },
  {
    name: "github_search_issues_and_pull_requests",
    payload: { query: "intent repo:amplifthq/openmeld type:pr" },
    blocked: true,
  },
  {
    name: "github_search_issues_and_pull_requests",
    payload: { query: 'repo:amplifthq/reply "intent work" type:pr' },
    blocked: false,
  },
  {
    name: "github_search_issues_and_pull_requests",
    payload: { query: '"intent repo:amplifthq/reply feature"' },
    blocked: true,
    reasonCode: "center_agent.work_target.query_scope_required",
  },
  {
    name: "github_search_issues_and_pull_requests",
    payload: { query: "repo:amplifthq/reply OR repo:amplifthq/openmeld" },
    blocked: true,
    reasonCode: "center_agent.work_target.query_scope_required",
  },
  {
    name: "openmeld_execute_app_action",
    payload: {
      actionId: "linear.create_linear_issue",
      input: { teamId: "11111111-1111-4111-8111-111111111111" },
    },
    blocked: false,
  },
  {
    name: "openmeld_execute_app_action",
    payload: {
      actionId: "linear.create_linear_issue",
      input: { teamId: "another-team" },
    },
    blocked: true,
  },
])("enforces the corrected code target and independent TON issue destination: $name $payload", async ({
  name,
  payload,
  blocked,
  reasonCode,
}) => {
  const input = await fixture();
  const execute = vi.fn(async () => ({ executed: true }));
  const tool = guardCenterAgentWorkTarget(
    { name, description: "Provider action", input: strictObject({}), execute },
    input
  );
  const result = await tool.execute(payload);
  expect(execute).toHaveBeenCalledTimes(blocked ? 0 : 1);
  expect(result).toMatchObject(
    blocked
      ? {
          status: "blocked_before_execution",
          reasonCode:
            reasonCode ?? "center_agent.work_target.destination_mismatch",
          sideEffects: 0,
        }
      : { executed: true }
  );
});

it("refreshes facts from the Space owner on every generation and blocks tool work until a new Human request selects or inherits", async () => {
  const input = await fixture();
  expect(
    await readCenterAgentWorkTargetFacts({
      ...input,
      context: input.context,
      personalAgent: false,
    })
  ).toContain("reply");
  input.coreWorker.centerAgentWorkTarget.mockResolvedValue({
    ...target,
    selectionRequired: true,
  });
  const execute = vi.fn(async () => ({ executed: true }));
  const tool = guardCenterAgentWorkTarget(
    {
      name: "github_list_pull_requests",
      description: "PR lookup",
      input: strictObject({}),
      execute,
    },
    input
  );
  expect(
    await tool.execute({ owner: "amplifthq", repo: "reply" })
  ).toMatchObject({
    reasonCode: "center_agent.work_target.selection_required",
  });
  expect(execute).not.toHaveBeenCalled();
  const rolloverStorage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(rolloverStorage, input.context);
  const refreshed = await readCenterAgentWorkTargetFacts({
    ...input,
    storage: rolloverStorage,
    context: input.context,
    personalAgent: false,
  });
  expect(refreshed).toContain('"selectionRequired":true');
  expect(refreshed).toContain("repository-correction");
});

async function fixture() {
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    request,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "target-submission",
      submissionId: "target-submission",
      status: "pending",
    },
    nowMs: TEST_NOW_MS,
  });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(storage, context);
  const coreWorker = {
    centerAgentWorkTarget: vi.fn(
      async (): Promise<CenterAgentWorkTargetResponse> => target
    ),
  };
  return { coreWorker, storage, submissionId: context.submissionId, context };
}
