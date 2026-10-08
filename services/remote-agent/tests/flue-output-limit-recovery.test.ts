import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, observe, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";
import { expect, it, vi } from "vitest";

it.each([
  "recover",
  "exhaust",
] as const)("handles a truncated final answer without replaying completed work: %s", async (outcome) => {
  const provider = fauxProvider({
    provider: `output-limit-${outcome}`,
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  const effect = vi.fn(() => ({ output: "Created record receipt-781." }));
  const record = defineTool({
    name: "record",
    description: "Create one record.",
    input: object({}),
    run: effect,
  });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("record", {}), { stopReason: "toolUse" }),
    ...Array.from({ length: outcome === "recover" ? 2 : 3 }, () =>
      fauxAssistantMessage('{"budget":', { stopReason: "length" })
    ),
    (context) => {
      expect(JSON.stringify(context.messages)).toContain("receipt-781");
      return fauxAssistantMessage('{"budget":100}');
    },
  ]);
  function OutputLimit() {
    useModel(`${model.provider}/${model.id}`);
    useTool(record);
    return "Create the requested record once and return a complete answer.";
  }
  const runtime = await start({
    agents: [OutputLimit],
    providers: [provider.provider],
  });
  try {
    const agent = init(OutputLimit, { id: outcome });
    const receipt = await agent.dispatch(
      'Create one record. Return JSON with "budget":100.'
    );
    if (outcome === "recover") {
      expect((await agent.read(receipt)).text).toBe('{"budget":100}');
      expect(provider.getPendingResponseCount()).toBe(0);
    } else {
      await expect(agent.read(receipt)).rejects.toThrow("Agent run failed");
      expect(provider.getPendingResponseCount()).toBe(1);
    }
    expect(effect).toHaveBeenCalledTimes(1);
  } finally {
    await runtime.stop();
  }
});

it.each([
  "continuing",
  "exhausted",
] as const)("retains the output continuation budget when a runtime resumes a %s submission", async (boundary) => {
  const directory = await mkdtemp(join(tmpdir(), "flue-output-resume-"));
  const original = join(directory, "original.sqlite");
  const snapshot = join(directory, "snapshot.sqlite");
  const provider = fauxProvider({
    provider: "output-resume",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  function OutputResume() {
    useModel(`${model.provider}/${model.id}`);
    return "Return a complete, concise answer.";
  }
  const realNow = Date.now.bind(Date);
  const clock = vi.spyOn(Date, "now");
  let captured = false;
  const unsubscribe = observe((event) => {
    const atBoundary =
      boundary === "continuing"
        ? event.type === "log" &&
          event.message ===
            "[flue:output-limit] Continuing incomplete response" &&
          event.attributes?.attempt === 2
        : event.type === "operation" &&
          event.operationKind === "prompt" &&
          event.isError;
    if (captured || !atBoundary) {
      return;
    }
    const sql = new DatabaseSync(original);
    try {
      sql.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
      captured = true;
    } finally {
      sql.close();
    }
  });
  provider.setResponses(
    Array.from({ length: 3 }, () =>
      fauxAssistantMessage("Incomplete", { stopReason: "length" })
    )
  );
  let runtime = await start({
    agents: [OutputResume],
    providers: [provider.provider],
    db: sqlite(original),
  });
  try {
    const receipt = await init(OutputResume, { id: "resume" }).dispatch(
      "Return a complete answer."
    );
    await expect(
      init(OutputResume, { id: "resume" }).read(receipt)
    ).rejects.toThrow("Agent run failed");
    expect(captured).toBe(true);
    unsubscribe();
    await runtime.stop();
    clock.mockImplementation(() => realNow() + 120_000);
    provider.setResponses([
      fauxAssistantMessage("Still incomplete", { stopReason: "length" }),
      fauxAssistantMessage("This fourth attempt must not run."),
    ]);
    runtime = await start({
      agents: [OutputResume],
      providers: [provider.provider],
      db: sqlite(snapshot),
    });
    await expect(
      init(OutputResume, { id: "resume" }).read(receipt)
    ).rejects.toThrow("Agent run failed");
    expect(provider.getPendingResponseCount()).toBe(
      boundary === "continuing" ? 1 : 2
    );
  } finally {
    unsubscribe();
    await runtime.stop();
    clock.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
