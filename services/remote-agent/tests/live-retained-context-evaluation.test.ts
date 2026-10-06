/** Opt-in supplier replay and public Flue single-execution experiments.
 * See fixtures/retained-context-evaluation.md for the evidence boundary.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Context, Provider } from "@earendil-works/pi-ai";
import { instrument } from "@flue/runtime";
import { expect, it, vi } from "vitest";
import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc";

const evaluation = vi.hoisted(() => ({
  provider: undefined as Provider | undefined,
  variant: "",
  requests: 0,
  directory: "",
  purpose: "agent",
  rows: [] as {
    variant: string;
    bytes: number;
    status: number;
    elapsedMs: number;
    usage: Record<string, unknown>;
    purpose: string;
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
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        AbortSignal.timeout(120_000),
      ]),
    });
    const body = await response.text();
    let usage: Record<string, unknown> = {};
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") {
        continue;
      }
      const chunk = JSON.parse(line.slice(6));
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }
    evaluation.rows.push({
      variant: evaluation.variant,
      purpose: evaluation.purpose,
      bytes,
      status: response.status,
      elapsedMs: Date.now() - started,
      usage,
    });
    await writeFile(
      resolve(evaluation.directory, "requests.json"),
      JSON.stringify(evaluation.rows, null, 2)
    );
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
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
            .streamSimple(model, context, {
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
    for (const variant of [
      "baseline-1",
      "receipts-1",
      "receipts-2",
      "baseline-2",
    ]) {
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
