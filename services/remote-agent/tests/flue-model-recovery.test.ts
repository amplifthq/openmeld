import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, observe, useModel, useTool } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { object } from "valibot";
import { expect, it, vi } from "vitest";
import { CENTER_AGENT_MODEL_RETRY } from "../flue-adapter/center-agent-durability";
import { extractFlueModelRecovery } from "../flue-adapter/observation";

// Exercise the actual framework loop, canonical tool history and observation
// contract. Fake timers avoid waiting through the production backoff schedule.
it.each([
  "recover",
  "exhaust",
  "cancel",
  "permanent",
] as const)("keeps model recovery bounded and preserves completed effects: %s", async (outcome) => {
  const provider = fauxProvider({
    provider: "bounded-recovery",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  const effect = vi.fn(() => ({ output: "Created record existing-123." }));
  const tool = defineTool({
    name: "create_record",
    description: "Create once.",
    input: object({}),
    run: effect,
  });
  const failure = fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage:
      outcome === "permanent"
        ? "401 Unauthorized: invalid API key"
        : "Our servers are currently overloaded. Please try again later.",
  });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("create_record", {}), {
      stopReason: "toolUse",
    }),
    ...Array.from(
      { length: { exhaust: 6, recover: 5, cancel: 1, permanent: 1 }[outcome] },
      () => failure
    ),
    fauxAssistantMessage("Continued with existing-123."),
  ]);
  function Center() {
    useModel(`${model.provider}/${model.id}`);
    useTool(tool);
    return "Preserve the created record.";
  }
  Center.modelRetry = CENTER_AGENT_MODEL_RETRY;
  Center.durability = { maxAttempts: 5, timeoutMs: 0 };
  const recovery: NonNullable<ReturnType<typeof extractFlueModelRecovery>>[] =
    [];
  const delays: number[] = [];
  const stopObserving = observe((event) => {
    const part = extractFlueModelRecovery(event);
    if (part) {
      recovery.push(part);
    }
    if (
      event.type === "log" &&
      event.attributes?.modelRecovery === true &&
      event.attributes.state === "waiting"
    ) {
      delays.push(Number(event.attributes.delayMs));
    }
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const runtime = await start({
    agents: [Center],
    providers: [provider.provider],
  });
  try {
    const agent = init(Center, { id: `bounded-${outcome}` });
    const receipt = await agent.dispatch("Create a record and report it.");
    let result: { text?: string; error?: unknown } | undefined;
    const read = agent.read(receipt).then(
      (answer) => {
        result = { text: answer.text };
      },
      (error: unknown) => {
        result = { error };
      }
    );
    await vi.waitFor(() => expect(effect).toHaveBeenCalledTimes(1));
    if (outcome === "cancel") {
      await vi.waitFor(() =>
        expect(recovery.some((part) => part.state === "waiting")).toBe(true)
      );
      await agent.abort();
    }
    for (let index = 0; index < 6 && !result; index += 1) {
      await vi.advanceTimersByTimeAsync(31_000);
    }
    await vi.waitFor(() => expect(result).toBeDefined());
    await read;
    expect(effect).toHaveBeenCalledTimes(1);
    const waits = recovery.filter((part) => part.state === "waiting");
    expect(waits.map((part) => part.attempt)).toEqual(
      {
        permanent: [],
        cancel: [1],
        recover: [1, 2, 3, 4, 5],
        exhaust: [1, 2, 3, 4, 5],
      }[outcome]
    );
    for (const [index, delay] of delays.entries()) {
      const cap = [3000, 6000, 12_000, 24_000, 30_000][index];
      if (cap === undefined) {
        throw new Error("Model recovery exceeded five retries.");
      }
      expect(delay).toBeGreaterThanOrEqual(cap * 0.75);
      expect(delay).toBeLessThanOrEqual(cap);
    }
    if (outcome === "recover") {
      expect(result?.text).toContain("Continued with existing-123.");
      expect(recovery.at(-1)?.state).toBe("recovered");
    } else {
      expect(result?.error).toBeDefined();
      if (outcome === "exhaust") {
        expect(recovery.at(-1)?.state).toBe("exhausted");
      }
    }
  } finally {
    await runtime.stop();
    stopObserving();
    vi.useRealTimers();
  }
});
