import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, observe, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { expect, it } from "vitest";

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

it("retains the exact active request across repeated lossy summaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-protected-request-"));
  const provider = fauxProvider({
    provider: "protected-request",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let bounded = false;
  let reads = 0;
  const read = defineTool({
    name: "read",
    description: "Read the next document.",
    input: object({}),
    run: () => ({
      output: `Document ${++reads}. ${"Read-only evidence. ".repeat(800)}`,
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
  const runtime = await start({
    agents: [ProtectedRequest],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
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
    const request =
      'Read two documents. Return JSON with "budget": 100 as a number. Do not publish.';
    let summaries = 0;
    const lossySummary = () => {
      summaries++;
      return fauxAssistantMessage("Documents are being read.");
    };
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read", {}), { stopReason: "toolUse" }),
      lossySummary,
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("budget");
        return fauxAssistantMessage(fauxToolCall("read", {}), {
          stopReason: "toolUse",
        });
      },
      lossySummary,
      (context) => {
        const texts = context.messages.flatMap((message) =>
          message.role === "user" && Array.isArray(message.content)
            ? message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
            : []
        );
        expect(texts.filter((text) => text === request)).toHaveLength(1);
        return fauxAssistantMessage('{"budget":100}');
      },
    ]);
    expect((await agent.read(await agent.dispatch(request))).text).toBe(
      '{"budget":100}'
    );
    expect(reads).toBe(2);
    expect(summaries).toBe(2);
    expect(provider.getPendingResponseCount()).toBe(0);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  "transient",
  "empty",
  "truncated",
  "oversized",
] as const)("continues the original task after a %s summary without replaying its tool", async (failure) => {
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
  Recovery.modelRetry = { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 };
  const events: string[] = [];
  const unsubscribe = observe((event) => {
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
          oversized: "Invalid enlarged checkpoint. ".repeat(6000),
        }[failure],
        {
          stopReason: (
            {
              transient: "error",
              empty: "stop",
              truncated: "length",
              oversized: "stop",
            } as const
          )[failure],
          ...(failure === "transient"
            ? { errorMessage: "503 Service unavailable" }
            : {}),
        }
      ),
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
    expect((await agent.read(await agent.dispatch(request))).text).toBe(
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
