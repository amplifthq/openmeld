import { inspect } from "node:util";
import {
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  isContextOverflow,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";
import { init, observe, useModel } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { expect, it, vi } from "vitest";
import { allowsRemoteAgentContentDiagnostics } from "../agent-core/diagnostics-content-policy";
import {
  guardRemoteAgentProviderStream,
  projectRemoteAgentProviderFailure,
} from "../flue-adapter/provider-failure";

const PRIVATE_TEXT = "Project Cedar's acquisition budget is confidential.";
const INTERNAL_ORG = "11111111-1111-4111-8111-111111111111";

it.each([
  "HTTP 401: invalid request",
  "HTTP 503: Service unavailable",
  "429 insufficient_quota",
  "500 billing limit reached",
  "connection reset",
  "connection refused",
  "connection reset getaddrinfo",
  "provider finish_reason: error",
  "(retryable_interruption)",
  "Provider returned error",
  "getaddrinfo ENOTFOUND",
  "context_length_exceeded",
  "maximum context length exceeded",
] as const)("retains SDK recovery and overflow classification: %s", (reason) => {
  const original = fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage: `${reason}. Input excerpt: ${PRIVATE_TEXT}`,
  });
  const projected = projectRemoteAgentProviderFailure(original, {
    contextWindow: 32_000,
  });
  expect(projected.errorMessage).not.toContain(PRIVATE_TEXT);
  expect(isRetryableAssistantError(projected)).toBe(
    isRetryableAssistantError(original)
  );
  expect(isContextOverflow(projected, 32_000)).toBe(
    isContextOverflow(original, 32_000)
  );
});

it.each([
  "initial",
  "iterator",
] as const)("contains a provider %s throw, including its cause", async (mode) => {
  const faux = fauxProvider();
  const raw = new Error(PRIVATE_TEXT, {
    cause: new Error(`Provider body: ${PRIVATE_TEXT}`),
  });
  const source = createAssistantMessageEventStream();
  source[Symbol.asyncIterator] = async function* () {
    yield { type: "start", partial: fauxAssistantMessage("partial") };
    await Promise.resolve();
    throw raw;
  };
  const stream = guardRemoteAgentProviderStream({
    createAttempt: () => {
      if (mode === "initial") {
        throw raw;
      }
      return source;
    },
    fetch,
    model: faux.getModel(),
  });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  const result = await stream.result();
  expect(result.stopReason).toBe("error");
  expect(result.errorMessage).toBe("Provider request failed.");
  expect(inspect(events)).not.toContain(PRIVATE_TEXT);
  expect(result.content).toEqual(
    mode === "iterator" ? fauxAssistantMessage("partial").content : []
  );
});

it("keeps HTTP status inside each concurrent provider attempt", async () => {
  const faux = fauxProvider();
  const streams = [401, 503].map((status) =>
    guardRemoteAgentProviderStream({
      createAttempt: (requestFetch) => {
        const source = createAssistantMessageEventStream();
        requestFetch("https://provider.example.invalid").then(() => {
          source.push({
            type: "error",
            reason: "error",
            error: fauxAssistantMessage("", {
              stopReason: "error",
              errorMessage: `HTTP ${status}: ${PRIVATE_TEXT}`,
            }),
          });
        });
        return source;
      },
      fetch: async () => {
        await Promise.resolve();
        return new Response(null, { status });
      },
      model: faux.getModel(),
    })
  );
  const results = await Promise.all(streams.map((stream) => stream.result()));
  expect(results[0]?.errorMessage?.startsWith("HTTP 401:")).toBe(true);
  expect(results[1]?.errorMessage?.startsWith("HTTP 503:")).toBe(true);
  expect(inspect(results)).not.toContain(PRIVATE_TEXT);
});

it("passes normal events, output, usage and length stops through unchanged", async () => {
  const faux = fauxProvider();
  const message = fauxAssistantMessage(PRIVATE_TEXT, { stopReason: "length" });
  message.usage = {
    input: 100,
    output: 20,
    cacheRead: 30,
    cacheWrite: 10,
    totalTokens: 160,
    cost: {
      input: 0.01,
      output: 0.02,
      cacheRead: 0.003,
      cacheWrite: 0.001,
      total: 0.034,
    },
  };
  const source = createAssistantMessageEventStream();
  const startEvent = { type: "start", partial: message } as const;
  const doneEvent = { type: "done", reason: "length", message } as const;
  source.push(startEvent);
  source.push(doneEvent);
  const stream = guardRemoteAgentProviderStream({
    createAttempt: () => source,
    fetch,
    model: faux.getModel(),
  });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  expect(events).toEqual([startEvent, doneEvent]);
  expect(await stream.result()).toBe(message);
});

it("does not expose a provider error through a previously emitted partial", async () => {
  const faux = fauxProvider();
  const partial = fauxAssistantMessage("");
  const source = createAssistantMessageEventStream();
  source.push({ type: "start", partial });
  const stream = guardRemoteAgentProviderStream({
    createAttempt: () => source,
    fetch,
    model: faux.getModel(),
  });
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  partial.stopReason = "error";
  partial.errorMessage = PRIVATE_TEXT;
  source.push({ type: "error", reason: "error", error: partial });
  await stream.result();
  expect(inspect(first.value)).not.toContain(PRIVATE_TEXT);
});

it.each([
  { environment: "prod", organizationId: "external", rich: false },
  { environment: undefined, organizationId: INTERNAL_ORG, rich: false },
  { environment: "dev", organizationId: "external", rich: true },
  { environment: "stg", organizationId: "external", rich: true },
  { environment: "prod", organizationId: INTERNAL_ORG, rich: true },
])("controls real SDK failure logs for $environment/$organizationId", async (policy) => {
  for (const compact of [false, true]) {
    const faux = fauxProvider({
      provider: `privacy-${policy.environment ?? "unknown"}-${compact}`,
      models: [{ id: "model", contextWindow: 32_000 }],
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const rich = allowsRemoteAgentContentDiagnostics({
      env: {
        OPENMELD_WORKER_ENVIRONMENT: policy.environment,
        CLOUDFLARE_OPENMELD_INTERNAL_DIAGNOSTICS_ORGANIZATION_ID: INTERNAL_ORG,
      },
      organizationId: policy.organizationId,
    });
    const guard = (
      createAttempt: () => AssistantMessageEventStream
    ): AssistantMessageEventStream =>
      rich
        ? createAttempt()
        : guardRemoteAgentProviderStream({
            createAttempt,
            fetch,
            model: faux.getModel(),
          });
    const provider = {
      ...faux.provider,
      stream: (...args: Parameters<typeof faux.provider.stream>) =>
        guard(() => faux.provider.stream(...args)),
      streamSimple: (...args: Parameters<typeof faux.provider.streamSimple>) =>
        guard(() => faux.provider.streamSimple(...args)),
    };
    let seeding = compact;
    function PrivacyAgent() {
      useModel(`${faux.provider.id}/model`, {
        compaction:
          compact && !seeding
            ? {
                workingContextTokens: 2500,
                maxWorkingContextTokens: 4000,
                reserveTokens: 512,
                keepRecentTokens: 512,
                maxSummaryTokens: 256,
                preserveActiveInput: true,
              }
            : false,
      });
      return "Answer briefly.";
    }
    PrivacyAgent.agentName = "PrivacyAgent";
    PrivacyAgent.modelRetry = { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 };
    let sawCompaction = false;
    const stopObserving = observe((event) => {
      if (event.type === "turn_request" && event.purpose === "compaction") {
        sawCompaction = true;
      }
    });
    const logs: string[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((...args) => {
        logs.push(args.map((arg) => inspect(arg)).join(" "));
      });
    const runtime = await start({
      agents: [PrivacyAgent],
      providers: [provider],
    });
    try {
      const agent = init(PrivacyAgent, { id: "privacy-regression" });
      if (seeding) {
        faux.setResponses(
          Array.from({ length: 3 }, () => fauxAssistantMessage("Recorded."))
        );
        for (let index = 0; index < 3; index += 1) {
          const receipt = await agent.dispatch(
            PRIVATE_TEXT +
              " These are the current project constraints.".repeat(180)
          );
          expect((await agent.read(receipt)).text).toBe("Recorded.");
        }
        seeding = false;
      }
      faux.setResponses([
        fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: `Invalid request. Input excerpt: ${PRIVATE_TEXT}`,
        }),
      ]);
      await expect(
        agent.read(await agent.dispatch("Summarize the agreed budget."))
      ).rejects.toThrow();
      await runtime.stop();
      expect(sawCompaction).toBe(compact);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((line) => line.includes(PRIVATE_TEXT))).toBe(
        policy.rich
      );
      if (!policy.rich) {
        expect(logs.join("\n")).toContain("Provider request failed.");
      }
    } finally {
      await runtime.stop();
      stopObserving();
      consoleError.mockRestore();
    }
  }
});
