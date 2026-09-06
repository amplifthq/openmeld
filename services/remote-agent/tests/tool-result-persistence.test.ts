import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { setProvider, useModel, useTool } from "@flue/runtime";
import type { ConversationRecord } from "@flue/runtime/adapter";
import {
  createFlueContext,
  createNodeAgentCoordinator,
  resetModelsForTests,
  resolveModel,
} from "@flue/runtime/internal";
import { sqlite } from "@flue/runtime/node";
import { object } from "valibot";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
import {
  TEST_CODE_MODE_LOADER,
  TEST_CODE_MODE_RUNTIME,
} from "./code-mode-runtime";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const AGENT_NAME = "tool-result-budget-agent";
const CALLBACK_SUBMISSION_ID = "submission-tool-result-budget";
const INSTANCE_ID = "space-tool-result-budget";
const MODEL_ID = "tool-result-budget-model";
const PROVIDER_ID = "tool-result-budget-provider";
const STREAM_PATH = `agents/${AGENT_NAME}/${INSTANCE_ID}`;
const TOOL_NAME = "test_oversized_read";
const CANONICAL_BATCH_SAFE_BUDGET_BYTES = 512 * 1024;

describe("Remote Agent canonical tool result persistence", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
    resetModelsForTests();
  });

  it("persists an oversized tool response as a bounded explicit error instead of a successful semantic shell", async () => {
    const storage = await createToolExecutionStorage();
    const definition: RemoteAgentToolDefinition = {
      description: "Return an intentionally oversized read result.",
      execute: async () => ({ data: "A".repeat(2_100_000) }),
      input: object({}),
      name: TOOL_NAME,
    };
    const tools = await getRemoteAgentFlueTools({
      codeModeRuntime: TEST_CODE_MODE_RUNTIME,
      coreWorker: {},
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
        "The read was too large, so I need a bounded request."
      ),
    ]);

    const persistence = sqlite();
    cleanups.push(async () => await persistence.close?.());
    await persistence.migrate?.();
    const stores = await persistence.connect();
    const agent = () => {
      useModel(`${PROVIDER_ID}/${MODEL_ID}`);
      useTool(tool);
      return "Call the oversized read tool once, then explain its error.";
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
      isError: true,
      toolName: TOOL_NAME,
    });
    expect(toolOutcome).not.toHaveProperty("output");
    expect(JSON.stringify(toolOutcome?.content)).toContain(
      "remote_agent.tool_result_too_large"
    );
    expect(JSON.stringify(toolOutcome)).not.toContain("AAAA");
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
