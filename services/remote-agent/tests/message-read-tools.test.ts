import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, useModel, useTool } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import {
  type MessageReadRpcInput,
  messageReadPageSchema,
} from "@openmeld/schemas";
import type { GenericSchema } from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  executeMessageRead,
  getMessageReadTools,
} from "../agent-core/message-read-tools";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

async function setup() {
  const storage = new InMemoryDurableObjectStorage();
  const submissionId = "message-read-test";
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: "remote-agent:dispatch_123",
        requestId: submissionId,
        status: "pending",
        submissionId,
      },
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    })
  );
  return { storage, submissionId };
}

function page(overrides: Record<string, unknown> = {}) {
  return messageReadPageSchema.parse({
    matches: [
      {
        signal: {
          v: 1,
          id: "message-1",
          spaceId: "space-1",
          ts: 100,
          type: "signal.text",
          profile: {
            profileId: "human-1",
            profileName: "Alice",
            kind: "human",
          },
          data: { text: "Original decision" },
        },
        threadRootSignalId: null,
        spaceName: "Feedback",
        directMessage: false,
        centerAgent: false,
        content: {
          version: "source-version",
          offset: 0,
          nextOffset: null,
          totalChars: 17,
          complete: true,
        },
      },
    ],
    nextCursor: "next-page",
    pageCursor: "current-page",
    indexing: false,
    requestedCount: 186,
    returnedCount: 1,
    completeCount: 1,
    limitBytes: 4096,
    order: "space_then_newest",
    coverage: "partial",
    ...overrides,
  });
}

describe("durable message reads", () => {
  it("uses the actual Flue compactor and recovers a read even when its summary omits the cursor", async () => {
    const input = await setup();
    const dependencies = {
      ...input,
      coreWorker: { remoteAgentReadMessages: vi.fn(async () => page()) },
    };
    let resumeId = "";
    let replayed = false;
    const tools = getMessageReadTools(dependencies).map((definition) =>
      defineTool({
        name: definition.name,
        description: definition.description,
        input: definition.input as GenericSchema<
          Record<string, unknown>,
          unknown
        >,
        run: async ({ data }) => {
          const output = await definition.execute(
            data as Record<string, unknown>
          );
          if (
            output &&
            typeof output === "object" &&
            "resumeId" in output &&
            typeof output.resumeId === "string"
          ) {
            resumeId = output.resumeId;
            replayed = "replayed" in output && output.replayed === true;
          }
          return { output: JSON.stringify(output) };
        },
      })
    );
    const primary = fauxProvider({
      provider: "message-read-primary",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const summarizer = fauxProvider({
      provider: "message-read-summary",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = primary.getModel();
    const summaryModel = summarizer.getModel();
    summarizer.setResponses([
      fauxAssistantMessage(
        "Continue reviewing the feedback. Recover the read checkpoint using the available tools."
      ),
    ]);
    primary.setResponses([
      fauxAssistantMessage(
        fauxToolCall("openmeld_query_messages", {
          spaceId: "space-1",
          mode: "full",
          limit: 186,
          maxBytes: 4096,
        }),
        { stopReason: "toolUse" }
      ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("openmeld_query_messages", {
            resumeId,
            cursor: "next-page",
          }),
          { stopReason: "toolUse" }
        ),
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "413 (request_too_large)",
      }),
      fauxAssistantMessage(fauxToolCall("openmeld_list_message_reads", {}), {
        stopReason: "toolUse",
      }),
      () =>
        fauxAssistantMessage(
          fauxToolCall("openmeld_query_messages", { resumeId }),
          { stopReason: "toolUse" }
        ),
      fauxAssistantMessage("Recovered the last page."),
    ]);
    function Reader() {
      useModel(`${model.provider}/${model.id}`, {
        compaction: {
          model: `${summaryModel.provider}/${summaryModel.id}`,
          reserveTokens: 1024,
          keepRecentTokens: 1,
        },
      });
      for (const tool of tools) {
        useTool(tool);
      }
      return "Read feedback in batches. Recover checkpoints after context compaction.";
    }
    const runtime = await start({
      agents: [Reader],
      providers: [primary.provider, summarizer.provider],
    });
    try {
      const agent = init(Reader, { id: "message-read-compaction" });
      expect(
        (await agent.read(await agent.dispatch("Review all feedback."))).text
      ).toContain("Recovered");
      expect(summarizer.state.callCount).toBeGreaterThan(0);
      expect(replayed).toBe(true);
      expect(
        dependencies.coreWorker.remoteAgentReadMessages
      ).toHaveBeenCalledTimes(3);
    } finally {
      await runtime.stop();
    }
  }, 30_000);

  it("recovers after losing model context, replays safely, then advances without double counting", async () => {
    const input = await setup();
    const rpc = vi.fn(async (_input: MessageReadRpcInput) => page());
    let budget = 4096;
    const dependencies = {
      ...input,
      coreWorker: { remoteAgentReadMessages: rpc },
      reserveMessageReadBytes: () => budget,
    };
    const first = await executeMessageRead(dependencies, {
      spaceId: "space-1",
      mode: "full",
      limit: 186,
      maxBytes: 4096,
    });
    expect(first).toMatchObject({ deliveredCount: 1, replayed: false });
    // Recreate the tools with no prior message/result in working context.
    const recovered = await getMessageReadTools(dependencies)[1]?.execute({});
    expect(recovered).toMatchObject({
      reads: [
        {
          resumeId: first.resumeId,
          deliveredCount: 1,
          nextCursor: "next-page",
        },
      ],
    });
    budget = 2048;
    expect(
      await executeMessageRead(dependencies, { resumeId: first.resumeId })
    ).toMatchObject({ status: "context_budget_exhausted" });
    expect(rpc).toHaveBeenCalledTimes(1);
    budget = 4096;
    expect(
      await executeMessageRead(dependencies, { resumeId: first.resumeId })
    ).toMatchObject({ replayed: true, deliveredCount: 1 });
    expect(rpc.mock.calls.at(-1)?.[0]).toMatchObject({
      cursor: "current-page",
      maxBytes: 4096,
    });
    rpc.mockResolvedValueOnce(
      page({ nextCursor: null, pageCursor: "next-page", coverage: "complete" })
    );
    expect(
      await executeMessageRead(dependencies, {
        resumeId: first.resumeId,
        cursor: "next-page",
      })
    ).toMatchObject({
      replayed: false,
      deliveredCount: 2,
      coverage: "complete",
    });
    await expect(
      executeMessageRead(dependencies, {
        resumeId: first.resumeId,
        q: "different selection",
      })
    ).rejects.toThrow("different filters");
  });

  it("continues an indexing checkpoint and detects source edits on replay", async () => {
    const input = await setup();
    const rpc = vi.fn(async () => page());
    rpc.mockResolvedValueOnce(
      page({
        matches: [],
        returnedCount: 0,
        completeCount: 0,
        indexing: true,
        coverage: "indexing",
      })
    );
    const dependencies = {
      ...input,
      coreWorker: { remoteAgentReadMessages: rpc },
    };
    const indexing = await executeMessageRead(dependencies, {
      spaceId: "space-1",
      q: "decision",
      maxBytes: 4096,
    });
    expect(indexing).toMatchObject({ indexing: true, deliveredCount: 0 });
    expect(
      await executeMessageRead(dependencies, { resumeId: indexing.resumeId })
    ).toMatchObject({ indexing: false, replayed: false });
    const changed = page();
    changed.matches = changed.matches.map((match) => ({
      ...match,
      content: { ...match.content, version: "changed-source" },
    }));
    rpc.mockResolvedValueOnce(changed);
    await expect(
      executeMessageRead(dependencies, { resumeId: indexing.resumeId })
    ).rejects.toThrow("source changed");
  });
});
