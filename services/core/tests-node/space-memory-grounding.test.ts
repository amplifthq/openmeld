import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Zep } from "@getzep/zep-cloud";
import { expect, it, vi } from "vitest";
import recorded from "../evals/memory-baseline/fixtures/superseded-rule-search.json";

vi.mock("../src/generated-runtime/zep-cloud.mjs", () => ({
  ZepClient: class {
    graph = {
      search: (query: Zep.GraphSearchQuery) => {
        if (!isDeepStrictEqual(query, recorded.searchRequest)) {
          throw new Error("Recorded provider query mismatch");
        }
        return Promise.resolve(structuredClone(recorded.searchResult));
      },
      episode: {
        get: (id: string) => {
          const episode =
            recorded.episodes[id as keyof typeof recorded.episodes];
          if (!episode) {
            return Promise.reject(new Error("Unrecorded provider episode"));
          }
          return Promise.resolve(structuredClone(episode));
        },
      },
    };
  },
}));

import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";
import { memoryBaselineCases } from "../evals/memory-baseline/cases";
import {
  buildProbeMessages,
  createOfflineAdapter,
  createReplay,
  scoreProbeAnswer,
} from "../evals/memory-baseline/replay";
import { createZepCenterAgentMemoryAdapter } from "../src/center-agent-memory/zep-memory-adapter";

async function replayCapturedRecall() {
  const seed = memoryBaselineCases.find(
    (entry) => entry.id === "stale-explicit-save"
  );
  if (!seed) {
    throw new Error("Missing rule replay");
  }
  const transport = createOfflineAdapter();
  const replay = createReplay(recorded.organizationId, transport);
  await replay.capture(seed);
  transport.search = createZepCenterAgentMemoryAdapter({
    apiKey: "offline-recorded-fixture",
  }).search;
  const envelope = await replay.attach(seed.query);
  return { seed, envelope };
}

it("grounds the captured stale-rule search in its verified later source instead of discarding that source after checking its version", async () => {
  const { seed, envelope } = await replayCapturedRecall();
  const correction = seed.turns.at(-1)?.user;
  if (!correction) {
    throw new Error("Missing correction fixture");
  }
  expect(JSON.stringify(recorded.previousEnvelope.memory)).not.toContain(
    "build it yourself"
  );
  expect(
    envelope.memory?.items.some((item) => item.text.includes(correction))
  ).toBe(true);
  expect(
    envelope.memory?.items.some((item) => item.text.includes("developer Agent"))
  ).toBe(true);
  expect(envelope.memory?.items.every((item) => item.subject === "space")).toBe(
    true
  );
  expect(
    envelope.memory?.items.reduce((sum, item) => sum + item.text.length, 0)
  ).toBeLessThanOrEqual(1600);
});

// Explicit paid replay, #340. No Zep calls or graph writes; exactly two model calls.
it.skipIf(!process.env.OPENMELD_MEMORY_GROUNDING_REPLAY)(
  "compares the recorded failing context and source-grounded context with real inference",
  async () => {
    const mode = process.env.OPENMELD_MEMORY_GROUNDING_REPLAY;
    expect(["offline", "live"]).toContain(mode);
    if (mode === "live") {
      expect(process.env.DOPPLER_PROJECT).toBe("openmeld-core");
      expect(process.env.DOPPLER_CONFIG).toBe("dev");
      if (!process.env.OPENROUTER_SMOKE_API_KEY) {
        throw new Error("Missing development smoke key");
      }
    }
    const { seed, envelope } = await replayCapturedRecall();
    const directory = resolve(`../../dev-tmp/memory-grounding/${Date.now()}`);
    await mkdir(directory, { recursive: true });
    const prior = recorded.previousEnvelope as RemoteAgentTurnEnvelope;
    const commonSystem = buildProbeMessages(seed, prior, "current_pipeline")[0];
    if (!commonSystem) {
      throw new Error("Missing system prompt");
    }
    const rows: Record<string, unknown>[] = [];
    for (const [arm, input] of [
      ["recorded_context", prior],
      ["source_grounded", envelope],
    ] as const) {
      const messages = buildProbeMessages(seed, input, "current_pipeline");
      messages[0] = commonSystem;
      if (Buffer.byteLength(JSON.stringify(messages)) > 100_000) {
        throw new Error("Replay input budget exceeded");
      }
      const row: Record<string, unknown> = { arm, messages };
      rows.push(row);
      if (mode === "offline") {
        row.score = { status: "not_run" };
        await writeFile(
          resolve(directory, "report.json"),
          JSON.stringify({ mode, rows }, null, 2)
        );
        continue;
      }
      row.status = "request_started";
      await writeFile(
        resolve(directory, "report.json"),
        JSON.stringify({ mode, rows }, null, 2)
      );
      const started = performance.now();
      try {
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(60_000),
            headers: {
              Authorization: `Bearer ${process.env.OPENROUTER_SMOKE_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://openmeld.ai",
              "X-OpenRouter-Title": "OpenMeld",
            },
            body: JSON.stringify({
              model: "z-ai/glm-5.3-flash",
              messages,
              temperature: 0,
              max_tokens: 1024,
              response_format: { type: "json_object" },
              reasoning: { effort: "low" },
            }),
          }
        );
        row.httpStatus = response.status;
        if (!response.ok) {
          throw new Error(`Inference HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
          id?: string;
          model?: string;
          choices?: { message?: { content?: string } }[];
          usage?: unknown;
        };
        row.requestId = data.id;
        row.model = data.model;
        row.usage = data.usage;
        const answer = data.choices?.[0]?.message?.content;
        if (typeof answer !== "string") {
          throw new Error("Missing model answer");
        }
        row.answer = answer;
        row.score = scoreProbeAnswer(answer, seed.expected);
        row.status = "completed";
      } catch (error) {
        row.error = error instanceof Error ? error.message : "UnknownError";
        row.status = "outcome_unavailable";
      }
      row.elapsedMs = Math.round(performance.now() - started);
      await writeFile(
        resolve(directory, "report.json"),
        JSON.stringify(
          {
            boundary:
              "Two inference calls over a captured real synthetic DEV retrieval; no Zep access or writes. Same model, question and system prompt; only memory context differs.",
            rows,
          },
          null,
          2
        )
      );
    }
  },
  150_000
);
