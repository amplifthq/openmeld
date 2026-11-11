import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Zep } from "@getzep/zep-cloud";
import { expect, it, vi } from "vitest";
import recorded from "../evals/memory-baseline/fixtures/superseded-rule-search.json";

const failedEpisodes = vi.hoisted(() => new Set<string>());
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
          if (failedEpisodes.has(id)) {
            return Promise.reject(
              Object.assign(new Error("Episode unavailable"), {
                statusCode: 503,
              })
            );
          }
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
import { renderRemoteAgentTurnEnvelope } from "../../remote-agent/agent-core/turn-envelope";
import { memoryBaselineCases } from "../evals/memory-baseline/cases";
import {
  buildProbeMessages,
  createOfflineAdapter,
  createReplay,
  scoreProbeAnswer,
} from "../evals/memory-baseline/replay";
import { buildCenterAgentSpaceMemoryRef } from "../src/center-agent-memory/contract";
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

it.each([
  "unavailable",
  "partial",
] as const)("preserves %s provenance coverage from the same failed provider read in automatic and explicit recall", async (expected) => {
  const ids = Object.keys(recorded.episodes);
  for (const id of expected === "unavailable" ? ids : ids.slice(0, 1)) {
    failedEpisodes.add(id);
  }
  try {
    const { envelope } = await replayCapturedRecall();
    const detail = await createZepCenterAgentMemoryAdapter({
      apiKey: "offline-recorded-fixture",
    }).searchDetailed({
      query: recorded.searchRequest.query,
      limit: recorded.searchRequest.limit,
      ref: buildCenterAgentSpaceMemoryRef({
        organizationId: recorded.organizationId,
        spaceId: "fixture-space",
      }),
    });
    expect(envelope.memory?.status).toBe(expected);
    expect(detail.status).toBe(expected);
    expect(Boolean(envelope.memory?.items.length)).toBe(expected === "partial");
    expect(Boolean(detail.items.length)).toBe(expected === "partial");
  } finally {
    failedEpisodes.clear();
  }
});

it.skipIf(!process.env.OPENMELD_RULE_BEHAVIOR_INPUT_DIR)(
  "prepares the historical-rule and action probes with actionable tools registered",
  async () => {
    const { seed, envelope } = await replayCapturedRecall();
    const directory = process.env.OPENMELD_RULE_BEHAVIOR_INPUT_DIR;
    if (!directory) {
      throw new Error("Missing output directory");
    }
    const { getRemoteAgentFlueTools } = await import(
      "../../remote-agent/flue-adapter/tools"
    );
    const { toRemoteAgentToolJsonSchema } = await import(
      "../../remote-agent/flue-adapter/tool-json-schema"
    );
    const { InMemoryDurableObjectStorage } = await import(
      "../../remote-agent/tests/storage"
    );
    const catalog = await getRemoteAgentFlueTools({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "fictional-rule-replay",
      turnEnvelope: envelope,
      env: { LOADER: {} as WorkerLoader },
      codeModeRuntime: {
        createExecutor: () => ({}),
        createCodeTool: ({ description }) => ({ description }),
      },
    });
    expect(catalog.capabilities.map((tool) => tool.name)).toContain(
      "openmeld_execute_app_action"
    );
    const tools = catalog.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toRemoteAgentToolJsonSchema(tool.input),
      },
    }));
    expect(tools.map((tool) => tool.function.name)).toContain("codemode");
    const [system] = buildProbeMessages(seed, envelope, "current_pipeline");
    if (!system) {
      throw new Error("Missing production system message");
    }
    await mkdir(directory, { recursive: true });
    for (const [id, request] of [
      [
        "rule",
        `${seed.question} Include explicitRequestRequired and mayMergeOwnPR (boolean) and give the rule in a short summary.`,
      ],
      [
        "decision-semantics",
        "Under the last recorded Cedar Issues rule, suppose a member has already explicitly asked Center Agent to build. Is a second owner decision about who may build still required before it follows the recorded workflow? Separately, does this historical question itself request a build? Return JSON with builder, needsBuildDecision (the second owner decision in that hypothetical), explicitRequestRequired, createIssueFirst, humanReview, mayMergeOwnPR, and currentTurnRequestsBuild. Give the workflow in one sentence. Do not infer an actual request from the hypothetical.",
      ],
      [
        "no-action",
        "Thanks, that's everything I needed to know about the build rule.",
      ],
    ] as const) {
      const body = {
        model: "z-ai/glm-5.3-flash",
        temperature: 0,
        max_tokens: 1024,
        reasoning: { effort: "low" },
        tools,
        tool_choice: "auto",
        messages: [
          system,
          {
            role: "user",
            content: `${renderRemoteAgentTurnEnvelope(envelope)}\n\n${request}`,
          },
        ],
      };
      await writeFile(
        resolve(directory, `${id}.json`),
        JSON.stringify(body, null, 2)
      );
    }
  }
);

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
