/** Opt-in supplier replay and public Flue single-execution experiments.
 * See fixtures/retained-context-evaluation.md for the evidence boundary.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Context, Provider } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { instrument } from "@flue/runtime";
import { expect, it, vi } from "vitest";
import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc";

const evaluation = vi.hoisted(() => ({
  provider: undefined as Provider | undefined,
  variant: "",
  requests: 0,
  directory: "",
  purpose: "agent",
  pending: [] as Promise<void>[],
  rows: [] as {
    variant: string;
    bytes: number;
    status: number;
    elapsedMs: number;
    usage: Record<string, unknown>;
    purpose: string;
    headersMs?: number;
    firstByteMs?: number;
    error?: string;
    gatewayLogId?: string;
    cloudflareRay?: string;
    responseId?: string;
    responseBytes?: number;
  }[],
}));
vi.mock("@flue/runtime", async (original) => {
  const runtime = await original<typeof import("@flue/runtime")>();
  return {
    ...runtime,
    setProvider: (provider: Provider) => {
      evaluation.provider = provider;
      runtime.setProvider(provider);
    },
  };
});
vi.mock("../flue-adapter/ai-usage", () => ({
  createFlueMeteredFetch: () => async (url: string, options: RequestInit) => {
    const bytes = Buffer.byteLength(String(options.body));
    // Replay permits 24 requests; runtime mode permits 64. Each is <= 180 KB.
    // Agent output is capped at 1,024 tokens and summaries at 4,096 tokens.
    const requestLimit =
      process.env.OPENMELD_RETAINED_CONTEXT_MODE === "runtime" ? 64 : 24;
    if (++evaluation.requests > requestLimit || bytes > 180_000) {
      throw new Error("Evaluation request guard reached");
    }
    const started = Date.now();
    // These opt-in cases contain synthetic fixture data only. Never save headers.
    await writeFile(
      resolve(evaluation.directory, `request-${evaluation.requests}.json`),
      String(options.body)
    );
    const row: (typeof evaluation.rows)[number] = {
      variant: evaluation.variant,
      purpose: evaluation.purpose,
      bytes,
      status: 0,
      elapsedMs: 0,
      usage: {},
    };
    evaluation.rows.push(row);
    const save = async () => {
      row.elapsedMs = Date.now() - started;
      await writeFile(
        resolve(evaluation.directory, "requests.json"),
        JSON.stringify(evaluation.rows, null, 2)
      );
    };
    const recordError = (error: unknown) => {
      const failure = error as { name?: string; cause?: { code?: string } };
      row.error = `${failure.name ?? "Error"}:${failure.cause?.code ?? "unknown"}`;
    };
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.any([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(120_000),
        ]),
      });
    } catch (error) {
      recordError(error);
      await save();
      throw error;
    }
    row.status = response.status;
    row.headersMs = Date.now() - started;
    row.gatewayLogId = response.headers.get("cf-aig-log-id") ?? undefined;
    row.cloudflareRay = response.headers.get("cf-ray") ?? undefined;
    await save();
    const observe = async () => {
      let body = "";
      try {
        const reader = response.clone().body?.getReader();
        if (!reader) {
          throw new Error("Missing response stream");
        }
        const decoder = new TextDecoder();
        for (;;) {
          const next = await reader.read();
          if (next.done) {
            break;
          }
          row.firstByteMs ??= Date.now() - started;
          body += decoder.decode(next.value, { stream: true });
        }
        body += decoder.decode();
      } catch (error) {
        recordError(error);
      } finally {
        row.responseBytes = Buffer.byteLength(body);
        for (const line of body.split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") {
            continue;
          }
          let chunk: { id?: string; usage?: Record<string, unknown> };
          try {
            chunk = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          row.responseId ??= chunk.id;
          if (chunk.usage) {
            row.usage = chunk.usage;
          }
        }
        await save();
      }
    };
    evaluation.pending.push(observe());
    return response;
  },
}));

import { registerRemoteAgentCloudflareProvider } from "../flue-adapter/model";
import { TEST_CENTER_AGENT_MODEL_ROUTE } from "./fixtures";
import {
  ORIGINAL_CODE,
  projectRetainedContext,
  promptPrefixMeasurements,
  retainedContextScenario,
} from "./helpers/retained-context-evaluation";
import { runRetainedContextSingleTurn } from "./helpers/retained-context-single-turn";

it.skipIf(
  process.env.OPENMELD_LIVE_RETAINED_CONTEXT_EVAL !== "1" ||
    process.env.OPENMELD_RETAINED_CONTEXT_MODE === "runtime"
)(
  "compares old-result previews with recoverable receipts using real inference",
  async () => {
    expect(process.env.OPENMELD_DEV_DOPPLER_COMPONENT).toBe("remote-agent");
    evaluation.directory = resolve(
      `../../dev-tmp/retained-context-evaluation/${Date.now()}`
    );
    await mkdir(evaluation.directory, { recursive: true });
    const config = parseJsoncObject(
      await readFile("wrangler.jsonc", "utf8")
    ) as { vars: Record<string, string> };
    await registerRemoteAgentCloudflareProvider({
      env: { ...config.vars, ...process.env },
      modelRoute: {
        ...TEST_CENTER_AGENT_MODEL_ROUTE,
        modelId: "openai/gpt-6-luna",
        displayName: "GPT-6 Luna",
        contextWindow: 1_050_000,
        maxOutputTokens: 1024,
        reasoningLevel: "low",
      },
    });
    const provider = evaluation.provider;
    const model = provider?.getModels()[0];
    if (!(provider && model)) {
      throw new Error("Missing evaluation provider");
    }
    const scenario = await retainedContextScenario();
    const projected = await projectRetainedContext(scenario);
    const results: {
      variant: string;
      answer: string;
      passed: boolean;
      reads: number;
      toolErrors: string[];
      error?: string;
    }[] = [];
    const order = ["baseline-1", "receipts-1", "receipts-2", "baseline-2"];
    await writeFile(
      resolve(evaluation.directory, "input-metrics.json"),
      JSON.stringify(
        {
          baselineBytes: Buffer.byteLength(JSON.stringify(scenario.context)),
          projectedBytes: Buffer.byteLength(JSON.stringify(projected.context)),
          removedPreviews: projected.removed,
          promptPrefixes: promptPrefixMeasurements(),
          boundary:
            "Replay of one continuation with real retained-result reads. No Flue preflight or summary call; no claim about avoided summaries, whole-task cost or production savings.",
        },
        null,
        2
      )
    );
    for (const variant of order) {
      evaluation.variant = variant;
      const context: Context = structuredClone(
        variant.startsWith("baseline") ? scenario.context : projected.context
      );
      let reads = 0;
      const toolErrors: string[] = [];
      let answer = "";
      let passed = false;
      let error: string | undefined;
      try {
        for (let round = 0; round < 6; round++) {
          const response = await provider
            .streamSimple(model, normalizeContext(context), {
              apiKey: "unused",
              maxTokens: 1024,
              reasoning: "low",
              sessionId: `retained-context-${variant}`,
            })
            .result();
          if (
            response.stopReason === "error" ||
            response.stopReason === "aborted"
          ) {
            throw new Error(response.errorMessage ?? response.stopReason);
          }
          context.messages.push(response);
          const calls = response.content.filter(
            (block) => block.type === "toolCall"
          );
          if (!calls.length) {
            answer = response.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("");
            const parsed = JSON.parse(
              answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1)
            );
            passed =
              parsed.owner === "Nora" &&
              parsed.budget === 390 &&
              parsed.deploymentAuthorized === false &&
              parsed.archiveCode === ORIGINAL_CODE &&
              parsed.completedWrites === 8;
            break;
          }
          for (const call of calls) {
            if (call.name !== "openmeld_read_tool_result") {
              throw new Error(`Unexpected operation: ${call.name}`);
            }
            reads++;
            let output: unknown;
            let isError = false;
            try {
              output = await scenario.read.execute(call.arguments);
            } catch (caught) {
              const message =
                caught instanceof Error ? caught.message : String(caught);
              toolErrors.push(message);
              output = { error: message };
              isError = true;
            }
            context.messages.push({
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: [{ type: "text", text: JSON.stringify(output) }],
              isError,
              timestamp: Date.now(),
            });
          }
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      results.push({
        variant,
        answer,
        passed,
        reads,
        toolErrors,
        ...(error ? { error } : {}),
      });
      await writeFile(
        resolve(evaluation.directory, "outcomes.json"),
        JSON.stringify(results, null, 2)
      );
    }
    console.info("Retained context evaluation:", evaluation.directory, results);
    await Promise.all(evaluation.pending);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(
      evaluation.rows.every(
        (row) =>
          typeof row.usage.cost === "number" &&
          Number.isFinite(row.usage.cost) &&
          row.usage.cost >= 0
      )
    ).toBe(true);
  },
  600_000
);

it.skipIf(
  process.env.OPENMELD_LIVE_RETAINED_CONTEXT_EVAL !== "1" ||
    process.env.OPENMELD_RETAINED_CONTEXT_MODE !== "runtime"
)(
  "compares one complete execution through repeated real Flue compaction",
  async () => {
    expect(process.env.OPENMELD_DEV_DOPPLER_COMPONENT).toBe("remote-agent");
    evaluation.directory = resolve(
      `../../dev-tmp/retained-context-evaluation/single-turn-${Date.now()}`
    );
    await mkdir(evaluation.directory, { recursive: true });
    const config = parseJsoncObject(
      await readFile("wrangler.jsonc", "utf8")
    ) as { vars: Record<string, string> };
    const registered = await registerRemoteAgentCloudflareProvider({
      env: { ...config.vars, ...process.env },
      modelRoute: {
        ...TEST_CENTER_AGENT_MODEL_ROUTE,
        modelId: "openai/gpt-6-luna",
        displayName: "GPT-6 Luna",
        contextWindow: 1_050_000,
        maxOutputTokens: 4096,
        reasoningLevel: "low",
      },
    });
    const provider = evaluation.provider;
    const model = provider?.getModels()[0];
    if (!(provider && model)) {
      throw new Error("Missing real provider");
    }
    if (process.env.OPENMELD_RETAINED_CONTEXT_PROBE === "1") {
      evaluation.variant = "connection-probe";
      const reply = await provider
        .streamSimple(
          model,
          normalizeContext({
            messages: [
              {
                role: "user",
                content: "Reply with OK only.",
                timestamp: Date.now(),
              },
            ],
          }),
          { apiKey: "unused", maxTokens: 64, reasoning: "low" }
        )
        .result();
      await Promise.all(evaluation.pending);
      expect(reply.stopReason).toBe("stop");
      expect(JSON.stringify(reply.content)).toContain("OK");
      console.info("Connection probe:", evaluation.directory, evaluation.rows);
      return;
    }
    instrument({
      key: Symbol.for("retained-runtime-purpose"),
      observe(event) {
        if (event.type === "turn_request") {
          evaluation.purpose = event.purpose;
        }
      },
      interceptor: (_operation, _context, next) => next(),
      dispose() {
        /* No owned resources. */
      },
    });
    const outcomes: {
      variant: string;
      passed: boolean;
      result?: Awaited<ReturnType<typeof runRetainedContextSingleTurn>>;
      error?: string;
    }[] = [];
    const variants = ["baseline-1", "receipts-1", "receipts-2", "baseline-2"];
    const pair = process.env.OPENMELD_RETAINED_CONTEXT_PAIR;
    let selectedVariants = variants;
    if (pair === "1") {
      selectedVariants = variants.slice(0, 2);
    }
    if (pair === "reverse") {
      selectedVariants = variants.slice(2);
    }
    for (const variant of selectedVariants) {
      evaluation.variant = variant;
      let result:
        | Awaited<ReturnType<typeof runRetainedContextSingleTurn>>
        | undefined;
      let passed = false;
      let error: string | undefined;
      try {
        result = await runRetainedContextSingleTurn({
          database: resolve(evaluation.directory, `${variant}.sqlite`),
          enabled: variant.startsWith("receipts"),
          summaryModel: registered.modelSpecifier,
          continuation: async (context) =>
            await provider
              .streamSimple(model, context, {
                apiKey: "unused",
                maxTokens: 1024,
                reasoning: "low",
                sessionId: `${evaluation.directory}-${variant}`,
              })
              .result(),
        });
        const parsed = JSON.parse(
          result.answer.slice(
            result.answer.indexOf("{"),
            result.answer.lastIndexOf("}") + 1
          )
        );
        passed =
          parsed.owner === "Nora" &&
          parsed.budget === 390 &&
          parsed.deploymentAuthorized === false &&
          parsed.archiveCode === ORIGINAL_CODE &&
          parsed.completedWrites === 8 &&
          parsed.observationCount === 8 &&
          parsed.firstObservationCode === "OBS-0-VERIFIED" &&
          parsed.lastObservationCode === "OBS-7-VERIFIED" &&
          !result.duplicateAttempt &&
          JSON.stringify(result.writes) === "[0,1,2,3,4,5,6,7]" &&
          JSON.stringify(result.observations) === "[0,1,2,3,4,5,6,7]";
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      outcomes.push({
        variant,
        passed,
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
      });
      await Promise.all(evaluation.pending);
      await writeFile(
        resolve(evaluation.directory, "outcomes.json"),
        JSON.stringify(outcomes, null, 2)
      );
    }
    console.info(
      "Single-execution context evaluation:",
      evaluation.directory,
      outcomes
    );
    expect(outcomes.every((outcome) => outcome.passed)).toBe(true);
    for (const outcome of outcomes) {
      expect(
        evaluation.rows.filter(
          (row) =>
            row.variant === outcome.variant && row.purpose === "compaction"
        ).length
      ).toBeGreaterThanOrEqual(2);
    }
    expect(
      evaluation.rows.every(
        (row) =>
          typeof row.usage.cost === "number" && Number.isFinite(row.usage.cost)
      )
    ).toBe(true);
  },
  600_000
);
