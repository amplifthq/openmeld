import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  init,
  instrument,
  setProvider,
  useModel,
  useTool,
} from "@flue/runtime";
import type { ConversationRecord } from "@flue/runtime/adapter";
import {
  createFlueContext,
  createNodeAgentCoordinator,
  resetModelsForTests,
  resolveModel,
} from "@flue/runtime/internal";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  assertRemoteAgentExecutionCanContinue,
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
  readRemoteAgentRequestedExecutionFailure,
} from "../agent-core/execution-state";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  REMOTE_AGENT_EXECUTION_INSTRUMENTATION,
  registerRemoteAgentExecutionPreparation,
} from "../flue-adapter/execution-context";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
import {
  TEST_CODE_MODE_LOADER,
  TEST_CODE_MODE_RUNTIME,
} from "./code-mode-runtime";
import { executionAccessFixture } from "./execution-access-fixture";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const AGENT_NAME = "tool-result-budget-agent";
const CALLBACK_SUBMISSION_ID = "submission-tool-result-budget";
const INSTANCE_ID = "space-tool-result-budget";
const MODEL_ID = "tool-result-budget-model";
const PROVIDER_ID = "tool-result-budget-provider";
const STREAM_PATH = `agents/${AGENT_NAME}/${INSTANCE_ID}`;
const TOOL_NAME = "read";
const CANONICAL_BATCH_SAFE_BUDGET_BYTES = 512 * 1024;

describe("Remote Agent canonical tool result persistence", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
    resetModelsForTests();
  });

  it("settles an actual SDK refusal loop without another model request after the safety fence", async () => {
    const storage = await createToolExecutionStorage();
    const context = await readRemoteAgentCallbackContext(
      storage,
      CALLBACK_SUBMISSION_ID
    );
    if (!context) {
      throw new Error("Missing execution context");
    }
    const identity = buildRemoteAgentExecutionIdentity(context);
    let reads = 0;
    const { tools } = await getRemoteAgentFlueTools({
      codeModeRuntime: TEST_CODE_MODE_RUNTIME,
      coreWorker: {},
      env: { LOADER: TEST_CODE_MODE_LOADER },
      storage,
      submissionId: CALLBACK_SUBMISSION_ID,
      callLimit: 4,
      sandboxDefinitions: [
        {
          name: TOOL_NAME,
          input: object({}),
          description: "Read one unchanged status.",
          progressTracking: "observation",
          execute: () => {
            reads += 1;
            return Promise.resolve({ status: "waiting" });
          },
        },
      ],
    });
    const registeredTool = tools.find((tool) => tool.name === TOOL_NAME);
    if (!registeredTool) {
      throw new Error("Missing observation tool");
    }
    const provider = fauxProvider({
      provider: "refusal-loop",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    provider.setResponses(
      Array.from({ length: 25 }, (_, index) =>
        fauxAssistantMessage(
          fauxToolCall(TOOL_NAME, {}, { id: `read-${index}` }),
          { stopReason: "toolUse" }
        )
      )
    );
    cleanups.push(instrument(REMOTE_AGENT_EXECUTION_INSTRUMENTATION));
    cleanups.push(
      registerRemoteAgentExecutionPreparation(() =>
        Promise.resolve({
          beforeModel: () =>
            assertRemoteAgentExecutionCanContinue({ identity, storage }),
        })
      )
    );
    const agentFunction = () => {
      useModel(`${model.provider}/${model.id}`);
      useTool(registeredTool);
      return "Read the status until it changes.";
    };
    const runtime = await start({
      agents: [agentFunction],
      providers: [provider.provider],
    });
    cleanups.push(() => runtime.stop());
    const agent = init(agentFunction, { id: "refusal-loop" });
    await expect(
      agent.read(await agent.dispatch("Read the status."))
    ).rejects.toMatchObject({ outcome: "failed" });
    expect(provider.state.callCount).toBe(5);
    expect(reads).toBe(3);
    await expect(
      readRemoteAgentRequestedExecutionFailure({ identity, storage })
    ).resolves.toMatchObject({
      code: "remote_agent.tool_call_budget_exceeded",
    });
  });

  it.each([
    false,
    true,
  ])("finishes more than 64 real tool turns across SDK compaction (personal=%s)", async (personalAgent) => {
    const storage = await createToolExecutionStorage();
    const receipts: number[] = [];
    const { tools } = await getRemoteAgentFlueTools({
      codeModeRuntime: TEST_CODE_MODE_RUNTIME,
      coreWorker: {
        personalRemoteAgentSpaceTool: () =>
          Promise.resolve({ kind: "authorize" }),
      },
      personalAgent,
      env: { LOADER: TEST_CODE_MODE_LOADER },
      sandboxDefinitions: [
        {
          name: TOOL_NAME,
          description:
            "Complete the next distinct item and return its receipt.",
          input: object({}),
          execute: () => {
            const receipt = receipts.length + 1;
            receipts.push(receipt);
            return Promise.resolve({
              receipt,
              details: "Completed item evidence. ".repeat(60),
            });
          },
        },
      ],
      storage,
      submissionId: CALLBACK_SUBMISSION_ID,
    });
    const tool = tools.find((candidate) => candidate.name === TOOL_NAME);
    if (!tool) {
      throw new Error("Expected the real OpenMeld tool wrapper.");
    }
    const registeredTool = tool;
    const provider = fauxProvider({
      provider: "continuous-work",
      tokensPerSecond: Number.POSITIVE_INFINITY,
      models: [{ id: "work", contextWindow: 128_000, maxTokens: 1024 }],
    });
    const summarizer = fauxProvider({
      provider: "continuous-summary",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const summaryModel = summarizer.getModel();
    summarizer.setResponses(
      Array.from({ length: 65 }, () =>
        fauxAssistantMessage(
          "## Goal\nComplete all 65 requested items.\n## Current Status\nKeep completed receipts; continue the next unfinished item."
        )
      )
    );
    let finalContext = "";
    const workSteps = Array.from({ length: 65 }, (_, index) =>
      fauxAssistantMessage(
        fauxToolCall(TOOL_NAME, {}, { id: `item-${index + 1}` }),
        { stopReason: "toolUse" }
      )
    );
    provider.setResponses([
      ...workSteps.slice(0, 20),
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "413 (request_too_large)",
      }),
      ...workSteps.slice(20),
      (context) => {
        finalContext = JSON.stringify(context.messages);
        return fauxAssistantMessage("All 65 requested items are complete.");
      },
    ]);
    function ContinuousWork() {
      useModel("continuous-work/work", {
        compaction: {
          reserveTokens: 20_000,
          keepRecentTokens: 2048,
          model: `${summaryModel.provider}/${summaryModel.id}`,
        },
      });
      useTool(registeredTool);
      return "Complete all 65 requested items. Never repeat a completed item.";
    }
    const runtime = await start({
      agents: [ContinuousWork],
      providers: [provider.provider, summarizer.provider],
    });
    cleanups.push(() => runtime.stop());
    const agent = init(ContinuousWork, { id: "continuous-work" });
    const receipt = await agent.dispatch("Complete all 65 requested items.");
    const answer = await agent.read(receipt);
    expect(JSON.stringify(answer)).toContain(
      "All 65 requested items are complete."
    );
    expect(receipts).toEqual(
      Array.from({ length: 65 }, (_, index) => index + 1)
    );
    expect(summarizer.state.callCount).toBeGreaterThan(0);
    expect(provider.state.callCount).toBe(67);
    expect(finalContext).toContain("Complete all 65 requested items.");
    expect(
      await readRemoteAgentCallbackContext(storage, CALLBACK_SUBMISSION_ID)
    ).not.toHaveProperty("workLoopCheckpoint");
  });

  it("persists an authorized oversized tool response with its completed receipt and retained continuation", async () => {
    const storage = await createToolExecutionStorage();
    const context = await readRemoteAgentCallbackContext(
      storage,
      CALLBACK_SUBMISSION_ID
    );
    if (!context) {
      throw new Error("Missing execution context");
    }
    let executions = 0;
    const definition: RemoteAgentToolDefinition = {
      description: "Return an intentionally oversized read result.",
      execute: () => {
        executions += 1;
        return Promise.resolve({
          data: "A".repeat(2_100_000),
          operationId: "completed-operation",
          status: "completed",
        });
      },
      input: object({}),
      name: TOOL_NAME,
    };
    const { tools } = await getRemoteAgentFlueTools({
      codeModeRuntime: TEST_CODE_MODE_RUNTIME,
      coreWorker: {
        authorizeRemoteAgentExecutionAccess: executionAccessFixture(context),
      },
      env: { LOADER: TEST_CODE_MODE_LOADER },
      sandboxDefinitions: [definition],
      storage,
      submissionId: CALLBACK_SUBMISSION_ID,
    });
    const tool = tools.find((candidate) => candidate.name === TOOL_NAME);
    if (!tool) {
      throw new Error(`Expected ${TOOL_NAME} to be registered.`);
    }

    const faux = fauxProvider({
      api: "tool-result-budget-faux",
      models: [
        {
          contextWindow: 32_000,
          id: MODEL_ID,
          maxTokens: 1024,
        },
      ],
      provider: PROVIDER_ID,
    });
    setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(TOOL_NAME, {}, { id: "call-1" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        "The operation completed; only part of its returned evidence is shown."
      ),
    ]);

    const persistence = sqlite();
    cleanups.push(async () => await persistence.close?.());
    await persistence.migrate?.();
    const stores = await persistence.connect();
    const agent = () => {
      useModel(`${PROVIDER_ID}/${MODEL_ID}`);
      useTool(tool);
      return "Call the tool once, then explain its result and presentation limits.";
    };
    const coordinator = createNodeAgentCoordinator({
      agents: [{ agent, name: AGENT_NAME }],
      attachmentStore: stores.attachmentStore,
      conversationStreamStore: stores.conversationStreamStore,
      createContext: ({ agentName, id, request, submissionId }) =>
        createFlueContext({
          agentConfig: { resolveModel },
          agentName,
          env: {},
          id,
          req: request,
          submissionId,
        }),
      submissions: stores.submissionStore,
    });
    cleanups.push(async () => await coordinator.shutdown());

    await coordinator.createAdmission(
      AGENT_NAME,
      INSTANCE_ID
    )({ kind: "user", body: `Call ${TOOL_NAME}.` });
    await coordinator.waitForIdle();

    const stream = await stores.conversationStreamStore.read(STREAM_PATH, {
      limit: 100,
      offset: "-1",
    });
    const toolOutcome = stream.batches
      .flatMap((batch) => batch.records)
      .find(isToolOutcomeForTestTool);

    expect(toolOutcome, JSON.stringify(stream.batches, null, 2)).toBeDefined();
    expect(toolOutcome).toMatchObject({
      isError: false,
      toolName: TOOL_NAME,
      output: {
        toolExecution: "returned",
        resultMetadata: {
          operationId: "completed-operation",
          status: "completed",
        },
        presentation: {
          kind: "partial",
          continuation: {
            resultId: expect.any(String),
            expiresAtMs: expect.any(Number),
          },
        },
      },
    });
    expect(JSON.stringify(toolOutcome)).toContain(
      "remote_agent.tool_result_too_large"
    );
    expect(executions).toBe(1);
    expect(JSON.stringify(toolOutcome)).not.toContain("A".repeat(20_000));
    for (const batch of stream.batches) {
      expect(utf8ByteLength(JSON.stringify(batch.records))).toBeLessThanOrEqual(
        CANONICAL_BATCH_SAFE_BUDGET_BYTES
      );
    }
  });
});

function isToolOutcomeForTestTool(
  record: ConversationRecord
): record is Extract<ConversationRecord, { type: "tool_outcome" }> {
  return record.type === "tool_outcome" && record.toolName === TOOL_NAME;
}

async function createToolExecutionStorage(): Promise<InMemoryDurableObjectStorage> {
  const storage = new InMemoryDurableObjectStorage();
  const request = createSubmitTurnRequest({
    idempotencyKey: "remote-agent:tool-result-budget",
  });
  const context = createRemoteAgentCallbackContext({
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: CALLBACK_SUBMISSION_ID,
      status: "pending",
      submissionId: CALLBACK_SUBMISSION_ID,
    },
    nowMs: TEST_NOW_MS,
    request,
  });
  await putRemoteAgentCallbackContext(storage, context);
  await initializeRemoteAgentExecutionState({
    acceptedAtMs: TEST_NOW_MS,
    identity: buildRemoteAgentExecutionIdentity(context),
    storage,
  });
  return storage;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
