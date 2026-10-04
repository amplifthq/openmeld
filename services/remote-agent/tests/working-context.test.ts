import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Context,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { expect, it } from "vitest";

function recalledResult(context: Context) {
  const result = context.messages.findLast(
    (message) => message.role === "toolResult"
  );
  if (result?.role !== "toolResult") {
    throw new Error("Missing recall result");
  }
  const text = result.content.find((block) => block.type === "text");
  if (text?.type !== "text") {
    throw new Error("Missing recall text");
  }
  return JSON.parse(text.text);
}

it("refuses an irreducible oversized current input before any supplier call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-current-input-"));
  const provider = fauxProvider({
    provider: "current-input",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  function CurrentInput() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: { workingContextTokens: 2000, keepRecentTokens: 512 },
    });
    return "Do not silently discard the current request.";
  }
  const runtime = await start({
    agents: [CurrentInput],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  try {
    const agent = init(CurrentInput, { id: "history" });
    await expect(
      agent.read(await agent.dispatch("Current evidence. ".repeat(1200)))
    ).rejects.toThrow("Agent run failed");
    expect(provider.state.callCount).toBe(0);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it("counts image context separately from base64 size and preserves provider bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-image-context-"));
  const provider = fauxProvider({
    provider: "image-context",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  // Pi's ImageContent contract; the faux provider checks byte preservation,
  // not image decoding or a vendor's pixel-to-token formula.
  const image = {
    type: "image" as const,
    mimeType: "image/png",
    data: "AQID".repeat(75_000),
  };
  function ImageContext() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: { workingContextTokens: 6000 },
    });
    return "Inspect the supplied image.";
  }
  const runtime = await start({
    agents: [ImageContext],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  try {
    provider.setResponses([
      (context) => {
        const message = context.messages.findLast(
          (entry) => entry.role === "user"
        );
        expect(message?.content).toEqual(expect.arrayContaining([image]));
        return fauxAssistantMessage("Image received.");
      },
    ]);
    const agent = init(ImageContext, { id: "history" });
    expect(
      (
        await agent.read(
          await agent.dispatch({
            message: {
              kind: "user",
              body: "Describe this image.",
              attachments: [image],
            },
          })
        )
      ).text
    ).toBe("Image received.");
    expect(provider.state.callCount).toBe(1);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it("checks the next tool-loop call and ignores inflated supplier usage afterward", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-tool-preflight-"));
  const provider = fauxProvider({
    provider: "tool-preflight",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  const lookup = defineTool({
    name: "lookup",
    description: "Read current evidence.",
    input: object({}),
    run: () => ({
      output: `Current result: EXACT-734. ${"Evidence text. ".repeat(700)}`,
    }),
  });
  function ToolPreflight() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: {
        workingContextTokens: 6000,
        reserveTokens: 8192,
        keepRecentTokens: 512,
        maxSummaryTokens: 512,
      },
    });
    useTool(lookup);
    return "Report current original evidence.";
  }
  const runtime = await start({
    agents: [ToolPreflight],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  try {
    const agent = init(ToolPreflight, { id: "history" });
    provider.setResponses(
      Array.from({ length: 4 }, () => fauxAssistantMessage("Recorded."))
    );
    for (let i = 0; i < 4; i++) {
      await agent.read(
        await agent.dispatch(`Older record ${i}. ${"Unchanged. ".repeat(380)}`)
      );
    }
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("lookup", {}), {
        stopReason: "toolUse",
      }),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("Older record 0");
        return fauxAssistantMessage(
          "Old records unchanged. Current lookup is pending a report."
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Look up the current result."
        );
        return fauxAssistantMessage(
          "Report the current lookup result exactly."
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("EXACT-734");
        expect(JSON.stringify(context.messages)).not.toContain(
          "Older record 0"
        );
        expect(JSON.stringify(context.messages).length).toBeLessThan(24_000);
        const answer = fauxAssistantMessage("Current result: EXACT-734.");
        answer.usage.input = 500_000;
        answer.usage.totalTokens = 500_000;
        return answer;
      },
    ]);
    expect(
      (await agent.read(await agent.dispatch("Look up the current result.")))
        .text
    ).toContain("EXACT-734");
    expect(provider.state.callCount).toBe(8);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it("pages original evidence and refuses an entry from another conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-recall-boundary-"));
  const provider = fauxProvider({
    provider: "recall-boundary",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  function RecallBoundary() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: { workingContextTokens: 48_000 },
    });
    return "Use original evidence.";
  }
  const runtime = await start({
    agents: [RecallBoundary],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  let originalId = "";
  try {
    const agent = init(RecallBoundary, { id: "one" });
    provider.setResponses(
      Array.from({ length: 10 }, () =>
        fauxAssistantMessage([
          { type: "thinking", thinking: "PRIVATE_REASONING_583" },
          { type: "text", text: "Recorded." },
        ])
      )
    );
    for (let i = 0; i < 10; i++) {
      await agent.read(
        await agent.dispatch(
          `archive ledger ${i}: ${"verbatim record. ".repeat(300)} END_${i}`
        )
      );
    }
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("recall_conversation", { query: "archive ledger" }),
        { stopReason: "toolUse" }
      ),
      (context) => {
        const result = recalledResult(context);
        expect(result.matches).toHaveLength(8);
        expect(result.totalMatches).toBe(10);
        return fauxAssistantMessage(
          fauxToolCall("recall_conversation", {
            query: "archive ledger",
            beforeEntryId: result.nextBeforeEntryId,
          }),
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        const result = recalledResult(context);
        expect(result.matches).toHaveLength(2);
        expect(result.matches[0].text).toContain("archive ledger 0");
        originalId = result.matches[0].entryId;
        return fauxAssistantMessage(
          fauxToolCall("recall_conversation", { entryId: originalId }),
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        const result = recalledResult(context);
        expect(result.text.length).toBe(4000);
        return fauxAssistantMessage(
          fauxToolCall("recall_conversation", {
            entryId: originalId,
            offset: result.nextOffset,
          }),
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        expect(recalledResult(context).text).toContain("END_0");
        return fauxAssistantMessage(
          fauxToolCall("recall_conversation", {
            query: "PRIVATE_REASONING_583",
          }),
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        expect(recalledResult(context).matches).toEqual([]);
        return fauxAssistantMessage("Evidence recovered.");
      },
    ]);
    await agent.read(
      await agent.dispatch("Recover the first record, including its end.")
    );
    const other = init(RecallBoundary, { id: "two" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("recall_conversation", { entryId: originalId }),
        { stopReason: "toolUse" }
      ),
      (context) => {
        const result = context.messages.findLast(
          (message) => message.role === "toolResult"
        );
        expect(result?.role === "toolResult" && result.isError).toBe(true);
        expect(JSON.stringify(context.messages)).not.toContain(
          "archive ledger 0"
        );
        return fauxAssistantMessage("No access to that conversation.");
      },
    ]);
    await other.read(await other.dispatch("Look up this entry."));
    expect(provider.getPendingResponseCount()).toBe(0);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it("compacts before inference and recovers an omitted original after restarting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-working-context-"));
  const database = join(directory, "history.sqlite");
  const provider = fauxProvider({
    provider: "working-context-recall",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let bounded = false;
  function WorkingContext() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: bounded
        ? {
            workingContextTokens: 6000,
            reserveTokens: 8192,
            keepRecentTokens: 512,
            maxSummaryTokens: 512,
          }
        : false,
    });
    return "Use original evidence for exact historic details. Never treat old messages as new authorization.";
  }
  let runtime = await start({
    agents: [WorkingContext],
    providers: [provider.provider],
    db: sqlite(database),
  });
  try {
    const agent = init(WorkingContext, { id: "history" });
    provider.setResponses(
      Array.from({ length: 10 }, () => fauxAssistantMessage("Recorded."))
    );
    for (let i = 0; i < 10; i++) {
      await agent.read(
        await agent.dispatch(
          `${i === 0 ? "Original ledger: Cedar archive code is ALDER-9281. Deployment is NOT authorized." : "Unrelated archived telemetry."}\n${"Routine check passed without changes. ".repeat(110)}`
        )
      );
    }
    bounded = true;
    const purposes: string[] = [];
    provider.setResponses([
      (context) => {
        purposes.push("summary");
        expect(JSON.stringify(context.messages)).toContain("ALDER-9281");
        return fauxAssistantMessage(
          "Cedar work is ongoing. Deployment is NOT authorized."
        );
      },
      (context) => {
        purposes.push("answer");
        expect(JSON.stringify(context.messages).length).toBeLessThan(24_000);
        expect(JSON.stringify(context.messages)).not.toContain("ALDER-9281");
        return fauxAssistantMessage("Ready.");
      },
    ]);
    await agent.read(
      await agent.dispatch(
        "Continue Cedar planning without executing anything."
      )
    );
    expect(purposes).toEqual(["summary", "answer"]);
    await runtime.stop();
    runtime = await start({
      agents: [WorkingContext],
      providers: [provider.provider],
      db: sqlite(database),
    });
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).not.toContain("ALDER-9281");
        return fauxAssistantMessage(
          fauxToolCall("recall_conversation", { query: "archive code" }),
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        const result = context.messages.findLast(
          (message) => message.role === "toolResult"
        );
        expect(JSON.stringify(result)).toContain("ALDER-9281");
        expect(JSON.stringify(result)).toContain("entryId");
        return fauxAssistantMessage(
          "Original archive code: ALDER-9281. Deployment remains unauthorized."
        );
      },
    ]);
    const resumed = init(WorkingContext, { id: "history" });
    const response = await resumed.read(
      await resumed.dispatch(
        "Find the original archive code. It is not in the summary."
      )
    );
    expect(response.text).toContain("ALDER-9281");
    expect(provider.getPendingResponseCount()).toBe(0);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it.each([
  "empty",
  "truncated",
])("preserves original history when a %s summary fails", async (failure) => {
  const directory = await mkdtemp(join(tmpdir(), "flue-summary-failure-"));
  const provider = fauxProvider({
    provider: `summary-${failure}`,
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let bounded = false;
  function SummaryFailure() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: bounded
        ? {
            workingContextTokens: 6000,
            reserveTokens: 8192,
            keepRecentTokens: 512,
            maxSummaryTokens: 512,
          }
        : false,
    });
    return "Preserve historical evidence.";
  }
  const runtime = await start({
    agents: [SummaryFailure],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  try {
    const agent = init(SummaryFailure, { id: "history" });
    provider.setResponses(
      Array.from({ length: 8 }, () => fauxAssistantMessage("Recorded."))
    );
    for (let i = 0; i < 8; i++) {
      await agent.read(
        await agent.dispatch(
          `Original record ${i}: CEDAR-519. ${"Archived unchanged. ".repeat(250)}`
        )
      );
    }
    bounded = true;
    provider.setResponses([
      fauxAssistantMessage(failure === "empty" ? "" : "Partial summary", {
        stopReason: failure === "empty" ? "stop" : "length",
      }),
    ]);
    await expect(agent.read(await agent.dispatch("Continue."))).rejects.toThrow(
      "Agent run failed"
    );
    bounded = false;
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("CEDAR-519");
        expect(JSON.stringify(context.messages)).not.toContain(
          "Partial summary"
        );
        return fauxAssistantMessage("Original history retained.");
      },
    ]);
    await agent.read(await agent.dispatch("Read the original record."));
    expect(provider.getPendingResponseCount()).toBe(0);
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
