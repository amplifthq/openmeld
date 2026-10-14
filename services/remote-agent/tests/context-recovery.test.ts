import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Context,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, observe, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { expect, it } from "vitest";

it("reopens after a failed checkpoint rewrite without replacing history or repeating work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-context-restart-"));
  const provider = fauxProvider({
    provider: "context-restart",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let executions = 0;
  const record = defineTool({
    name: "record",
    description: "Record the requested operation once.",
    input: object({}),
    run: () => {
      executions++;
      return {
        output: `Receipt COMPLETE-781. ${"Recorded evidence. ".repeat(1800)}`,
      };
    },
  });
  function Restart() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: {
        workingContextTokens: 6000,
        maxWorkingContextTokens: 7000,
        keepRecentTokens: 512,
        maxSummaryTokens: 512,
        reserveTokens: 8192,
        preserveActiveInput: true,
      },
    });
    useTool(record);
    return "Use the recorded outcome. Never repeat completed work to recover its result.";
  }
  const database = join(directory, "history.sqlite");
  const open = () =>
    start({
      agents: [Restart],
      providers: [provider.provider],
      db: sqlite(database),
    });
  const compactions: boolean[] = [];
  const summaryOutputLimits: Array<number | undefined> = [];
  const unsubscribe = observe((event) => {
    if (event.type === "compaction") {
      compactions.push(event.isError);
    }
    if (event.type === "turn_request" && event.purpose === "compaction") {
      summaryOutputLimits.push(event.request.maxTokens);
    }
  });
  let runtime = await open();
  try {
    const agent = init(Restart, { id: "restart" });
    provider.setResponses([
      fauxAssistantMessage("Historical review evidence. ".repeat(250)),
    ]);
    await agent.read(
      await agent.dispatch(
        `Earlier archive MAPLE-104 is read-only. ${"Historical question. ".repeat(
          1000
        )}`
      )
    );
    const previousCheckpoint =
      `Archive MAPLE-104 is read-only. ${"Earlier measurements are preserved in the original conversation. ".repeat(
        60
      )}`.trimEnd();
    provider.setResponses([
      fauxAssistantMessage(previousCheckpoint),
      fauxAssistantMessage("Historical review checkpoint saved."),
    ]);
    await agent.read(await agent.dispatch("Prepare to continue the review."));
    expect(compactions).toEqual([false]);

    const original =
      "Record once for archive CEDAR-519. No publication is authorized.";
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("record", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Incomplete checkpoint", { stopReason: "length" }),
    ]);
    await expect(agent.read(await agent.dispatch(original))).rejects.toThrow(
      "Agent run failed"
    );
    expect(executions).toBe(1);
    expect(compactions).toEqual([false, true]);
    await runtime.stop();
    runtime = await open();
    const correction =
      "Report the existing receipt in JSON. Do not record again.";
    const userTexts = (context: Context) =>
      context.messages
        .filter((message) => message.role === "user")
        .map((message) => JSON.stringify(message.content));
    let rewriteSystemPrompt = "";
    let rewriteSource = "";
    provider.setResponses([
      (context) => {
        const prompt = userTexts(context).join("\n");
        rewriteSystemPrompt = context.messages
          .filter((message) => message.role === "system")
          .map((message) => JSON.stringify(message.content))
          .join("\n");
        rewriteSource = prompt;
        return fauxAssistantMessage(
          "The operation completed with receipt COMPLETE-781. No publication is authorized. The archive identifier remains in the original request."
        );
      },
      (context) => {
        expect(
          userTexts(context).filter((text) => text.includes(correction))
        ).toHaveLength(1);
        expect(JSON.stringify(context.messages)).toContain("COMPLETE-781");
        expect(JSON.stringify(context.messages)).not.toContain(
          "Incomplete checkpoint"
        );
        return fauxAssistantMessage(
          fauxToolCall("recall_conversation", { query: "CEDAR-519" }),
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        const recalled = context.messages.findLast(
          (message) => message.role === "toolResult"
        );
        expect(JSON.stringify(recalled)).toContain(original);
        return fauxAssistantMessage('{"receipt":"COMPLETE-781"}');
      },
    ]);
    const resumed = init(Restart, { id: "restart" });
    expect((await resumed.read(await resumed.dispatch(correction))).text).toBe(
      '{"receipt":"COMPLETE-781"}'
    );
    expect(executions).toBe(1);
    expect(compactions).toEqual([false, true, false]);
    expect(summaryOutputLimits).toEqual([512, 512, 512]);
    expect(rewriteSource).toContain("at most 256 tokens");
    expect(rewriteSource).toContain(previousCheckpoint);
    expect(rewriteSource).toContain("COMPLETE-781");
    expect(rewriteSource).not.toContain("Incomplete checkpoint");
    // The supplier sees the rewrite contract above historical user text; it
    // must not receive the old checkpoint as a draft to preserve and expand.
    expect(rewriteSystemPrompt).toContain("Write a new checkpoint");
    expect(rewriteSystemPrompt).toContain(
      "A previous checkpoint is not a draft"
    );
    expect(provider.getPendingResponseCount()).toBe(0);
  } finally {
    unsubscribe();
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it("does not defer an irreducible request beyond the configured ceiling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-context-ceiling-"));
  const provider = fauxProvider({
    provider: "context-ceiling",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  function Ceiling() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: {
        workingContextTokens: 2000,
        maxWorkingContextTokens: 3000,
        preserveActiveInput: true,
      },
    });
    return "Keep the complete request.";
  }
  const runtime = await start({
    agents: [Ceiling],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  try {
    const agent = init(Ceiling, { id: "ceiling" });
    await expect(
      agent.read(
        await agent.dispatch("Required current evidence. ".repeat(1500))
      )
    ).rejects.toThrow("Agent run failed");
    expect(provider.state.callCount).toBe(0);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  "text",
  "opaque-signature",
] as const)("retains the exact active request across repeated lossy summaries (%s)", async (contentKind) => {
  const directory = await mkdtemp(join(tmpdir(), "flue-protected-request-"));
  const provider = fauxProvider({
    provider: "protected-request",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let bounded = false;
  let reads = 0;
  const documentCount = contentKind === "text" ? 3 : 6;
  // Provider-owned opaque state counts toward the next request even when it
  // has no visible reasoning text. Never use real provider reasoning here.
  const thoughtSignature = "opaque-test-signature".repeat(700);
  const read = defineTool({
    name: "read",
    description: "Read the next document.",
    input: object({}),
    run: () => ({
      output: `Document ${++reads}. ${contentKind === "text" ? "Read-only evidence. ".repeat(800) : "Read complete."}`,
    }),
  });
  function ProtectedRequest() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: bounded
        ? {
            workingContextTokens: 6000,
            maxWorkingContextTokens: 8000,
            preserveActiveInput: true,
            keepRecentTokens: 512,
            maxSummaryTokens: 512,
            reserveTokens: 8192,
          }
        : false,
    });
    useTool(read);
    return "Follow the current request exactly.";
  }
  const correction = "Use EUR. Keep budget as a number. Do not send messages.";
  let correctionApplied = false;
  ProtectedRequest.joinQueuedDeliveries = false;
  ProtectedRequest.steeringSource = (submissionId: string) => ({
    claim: async () =>
      bounded && reads > 0 && !correctionApplied
        ? [
            {
              targetSubmissionId: submissionId,
              status: "joining" as const,
              input: {
                kind: "dispatch" as const,
                submissionId: "budget-correction",
                agent: "ProtectedRequest",
                id: "protected",
                acceptedAt: new Date().toISOString(),
                message: { kind: "user" as const, body: correction },
              },
            },
          ]
        : [],
    listUnresolved: async () => [],
    finalize: () => {
      correctionApplied = true;
      return Promise.resolve();
    },
    revert: async () => undefined,
  });
  const runtime = await start({
    agents: [ProtectedRequest],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  let summarizing = false;
  const unsubscribe = observe((event) => {
    if (event.type === "turn_request") {
      summarizing = event.purpose === "compaction";
    }
  });
  try {
    const agent = init(ProtectedRequest, { id: "protected" });
    provider.setResponses(
      Array.from({ length: 4 }, () => fauxAssistantMessage("Recorded."))
    );
    for (let i = 0; i < 4; i++) {
      await agent.read(
        await agent.dispatch(`Archive ${i}. ${"Old evidence. ".repeat(180)}`)
      );
    }
    bounded = true;
    const request = `Read ${documentCount} documents. Return JSON with "budget": 100 as a number. Do not publish.`;
    let summaries = 0;
    provider.setResponses(
      Array.from({ length: 20 }, () => (context) => {
        if (summarizing) {
          summaries++;
          return fauxAssistantMessage("Documents are being read.");
        }
        const retainedCalls = new Set(
          context.messages.flatMap((message) =>
            message.role === "assistant"
              ? message.content.flatMap((block) =>
                  block.type === "toolCall" ? [block.id] : []
                )
              : []
          )
        );
        for (const message of context.messages) {
          if (message.role === "toolResult") {
            expect(retainedCalls.has(message.toolCallId)).toBe(true);
          }
          if (
            contentKind === "opaque-signature" &&
            message.role === "assistant"
          ) {
            for (const block of message.content) {
              if (block.type === "toolCall") {
                expect(block.thoughtSignature).toBe(thoughtSignature);
              }
            }
          }
        }
        if (reads < documentCount) {
          return fauxAssistantMessage(
            [
              {
                ...fauxToolCall("read", {}),
                ...(contentKind === "opaque-signature"
                  ? { thoughtSignature }
                  : {}),
              },
            ],
            {
              stopReason: "toolUse",
            }
          );
        }
        const texts = context.messages.flatMap((message) =>
          message.role === "user" && Array.isArray(message.content)
            ? message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
            : []
        );
        expect(texts.filter((text) => text === request)).toHaveLength(1);
        expect(texts.filter((text) => text === correction)).toHaveLength(1);
        return fauxAssistantMessage('{"budget":100}');
      })
    );
    expect((await agent.read(await agent.dispatch(request))).text).toBe(
      '{"budget":100}'
    );
    expect(reads).toBe(documentCount);
    expect(summaries).toBeGreaterThanOrEqual(2);
    expect(correctionApplied).toBe(true);
  } finally {
    unsubscribe();
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  "transient",
  "exhausted",
  "cancelled",
  "permanent",
  "empty",
  "truncated",
  "oversized",
] as const)("handles %s summary behavior without replaying its tool", async (failure) => {
  const directory = await mkdtemp(join(tmpdir(), "flue-context-recovery-"));
  const provider = fauxProvider({
    provider: `context-recovery-${failure}`,
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let bounded = false;
  let executions = 0;
  const record = defineTool({
    name: "record",
    description: "Record one completed operation.",
    input: object({}),
    run: () => {
      executions++;
      return {
        output: `Receipt COMPLETE-781. ${"Recorded evidence. ".repeat(1400)}`,
      };
    },
  });
  function Recovery() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: bounded
        ? {
            workingContextTokens: 6000,
            maxWorkingContextTokens: 20_000,
            keepRecentTokens: 512,
            maxSummaryTokens: 512,
            reserveTokens: 8192,
            preserveActiveInput: true,
            thinkingLevel: "low",
          }
        : false,
    });
    useTool(record);
    return "Complete the task using recorded evidence.";
  }
  Recovery.modelRetry = {
    maxRetries: 1,
    baseDelayMs: failure === "cancelled" ? 10_000 : 1,
    maxDelayMs: failure === "cancelled" ? 10_000 : 1,
  };
  const retryScheduled = Promise.withResolvers<void>();
  const events: string[] = [];
  const unsubscribe = observe((event) => {
    if (
      event.type === "log" &&
      event.message === "[flue:compaction] Retrying summary request"
    ) {
      retryScheduled.resolve();
    }
    if (event.type === "compaction") {
      events.push(event.isError ? "failed" : "committed");
    }
  });
  const runtime = await start({
    agents: [Recovery],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  try {
    const agent = init(Recovery, { id: "recovery" });
    provider.setResponses(
      Array.from({ length: 4 }, () => fauxAssistantMessage("Recorded."))
    );
    for (let i = 0; i < 4; i++) {
      await agent.read(
        await agent.dispatch(`Archive ${i}. ${"Old evidence. ".repeat(180)}`)
      );
    }
    bounded = true;
    const request =
      'Record once. Return JSON with "budget": 100 as a number. Do not publish.';
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("record", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        {
          empty: "",
          truncated: "Partial summary",
          transient: "Partial summary",
          exhausted: "Partial summary",
          cancelled: "Partial summary",
          permanent: "Partial summary",
          oversized: "Invalid enlarged checkpoint. ".repeat(6000),
        }[failure],
        {
          stopReason: (
            {
              transient: "error",
              exhausted: "error",
              cancelled: "error",
              permanent: "error",
              empty: "stop",
              truncated: "length",
              oversized: "stop",
            } as const
          )[failure],
          ...(["transient", "exhausted", "cancelled", "permanent"].includes(
            failure
          )
            ? {
                errorMessage:
                  failure === "permanent"
                    ? "401 Unauthorized"
                    : "503 Service unavailable",
              }
            : {}),
        }
      ),
      ...(failure === "exhausted"
        ? [
            fauxAssistantMessage("", {
              stopReason: "error",
              errorMessage: "503 Service unavailable",
            }),
          ]
        : []),
      ...(failure === "transient"
        ? [
            fauxAssistantMessage(
              "An operation is recorded. Continue with its receipt."
            ),
          ]
        : []),
      (context) => {
        const serialized = JSON.stringify(context.messages);
        expect(serialized).toContain("COMPLETE-781");
        expect(serialized).not.toContain("Partial summary");
        expect(
          context.messages.filter(
            (message) =>
              message.role === "user" &&
              JSON.stringify(message.content).includes("Record once.")
          )
        ).toHaveLength(1);
        expect(serialized).toContain("budget");
        return fauxAssistantMessage('{"budget":100,"receipt":"COMPLETE-781"}');
      },
    ]);
    const receipt = await agent.dispatch(request);
    if (failure === "cancelled") {
      const read = agent.read(receipt).catch((error: unknown) => error);
      await retryScheduled.promise;
      await agent.abort();
      expect(await read).toMatchObject({ outcome: "aborted" });
      expect(executions).toBe(1);
      expect(provider.getPendingResponseCount()).toBe(1);
      expect(events).not.toContain("committed");
      return;
    }
    expect((await agent.read(receipt)).text).toBe(
      '{"budget":100,"receipt":"COMPLETE-781"}'
    );
    expect(executions).toBe(1);
    expect(events).toEqual([failure === "transient" ? "committed" : "failed"]);
    expect(provider.getPendingResponseCount()).toBe(0);
  } finally {
    unsubscribe();
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
