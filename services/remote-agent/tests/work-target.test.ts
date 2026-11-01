import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import type { CenterAgentWorkTargetResponse } from "@openmeld/schemas/types";
import { strictObject } from "valibot";
import { expect, it, vi } from "vitest";
import { CenterAgentV2 } from "../.flue/agents/center-agent";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { registerRemoteAgentExecutionPreparation } from "../flue-adapter/execution-context";
import {
  guardCenterAgentWorkTarget,
  readCenterAgentWorkTargetFacts,
} from "../flue-adapter/work-target";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

// Node supplies the real Flue runtime. Cloudflare binding construction is not
// part of this render/intake test and must not be invoked by the prepared Agent.
vi.mock("@flue/runtime/cloudflare", () => ({
  extend: (definition: unknown) => definition,
  getCloudflareContext: () => {
    throw new Error("Unexpected Cloudflare binding access in prepared render");
  },
}));

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

it("retains an admitted correction when the current goal read fails before the first model call", async () => {
  const input = await fixture();
  input.coreWorker.centerAgentWorkTarget.mockRejectedValueOnce(
    new Error("Controlled Core unavailability")
  );
  const provider = fauxProvider({
    provider: "work-target-input-recovery",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  const restorePreparation = registerRemoteAgentExecutionPreparation(
    async () => ({
      workTargetContext: {
        ...input,
        context: input.context,
        personalAgent: false,
      },
      model: `${model.provider}/${model.id}`,
      compaction: false,
      thinkingLevel: "low",
      interactiveResponseId: () => null,
      getAcceptedResponseInputId: () => null,
      instructions:
        "Answer from the admitted request and current Space-owned goal.",
      tools: [],
      skills: [],
      steeringSource: {
        claim: async () => [],
        listUnresolved: async () => [],
        finalize: async () => undefined,
        revert: async () => undefined,
      },
    })
  );
  const correction = "Use amplifthq/reply instead of amplifthq/openmeld.";
  provider.setResponses([
    (context) => {
      const messages = JSON.stringify(context.messages);
      expect(messages).toContain(correction);
      expect(messages).toContain("Continue the corrected request.");
      expect(messages).toContain("work_target_context");
      return fauxAssistantMessage("Retained the correction.");
    },
  ]);
  const runtime = await start({
    agents: [CenterAgentV2],
    providers: [provider.provider],
    db: sqlite(),
  });
  try {
    const agent = init(CenterAgentV2, { id: "goal-input-recovery" });
    await expect(
      agent.read(await agent.dispatch(correction))
    ).rejects.toThrow();
    expect(provider.state.callCount).toBe(0);
    expect(
      (
        await agent.read(
          await agent.dispatch("Continue the corrected request.")
        )
      ).text
    ).toBe("Retained the correction.");
    expect(input.coreWorker.centerAgentWorkTarget).toHaveBeenCalledTimes(2);
  } finally {
    await runtime.stop();
    restorePreparation();
  }
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
