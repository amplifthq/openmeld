import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ZepClient as Client, Zep } from "@getzep/zep-cloud";
import { expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  phase: "",
  records: [] as {
    phase: string;
    operation: string;
    input: unknown;
    result?: unknown;
    elapsedMs: number;
    error?: string;
  }[],
  pending: new Set<Promise<unknown>>(),
}));

// Observe the real vendor client at its loader boundary. Never log credentials/headers.
vi.mock("../src/lazy-runtime-modules", async () => {
  const { ZepClient } = await import("@getzep/zep-cloud");
  const observe = <T>(
    operation: string,
    input: unknown,
    run: () => Promise<T>
  ) => {
    const row: (typeof telemetry.records)[number] = {
      phase: telemetry.phase,
      operation,
      input,
      elapsedMs: 0,
    };
    telemetry.records.push(row);
    const started = performance.now();
    const pending = (async () => {
      try {
        row.result = await run();
        return row.result as T;
      } catch (error) {
        row.error = error instanceof Error ? error.name : "UnknownError";
        throw error;
      } finally {
        row.elapsedMs = Math.round(performance.now() - started);
      }
    })();
    telemetry.pending.add(pending);
    pending.then(
      () => telemetry.pending.delete(pending),
      () => telemetry.pending.delete(pending)
    );
    return pending;
  };
  return {
    loadZepRuntime: async () => ({
      ZepClient: class {
        graph;
        user;
        constructor(options: ConstructorParameters<typeof ZepClient>[0]) {
          const client = new ZepClient(options);
          const limits = { maxRetries: 0, timeoutInSeconds: 15 };
          this.graph = {
            add: (input: Zep.AddDataRequest) =>
              observe("add", input, () => client.graph.add(input, limits)),
            create: (input: Parameters<Client["graph"]["create"]>[0]) =>
              observe("create", input, () =>
                client.graph.create(input, limits)
              ),
            delete: (id: string) =>
              observe("delete", id, () => client.graph.delete(id, limits)),
            search: (input: Zep.GraphSearchQuery) =>
              observe("search", input, () =>
                client.graph.search(input, limits)
              ),
            episode: {
              get: (id: string) =>
                observe("episode", id, () =>
                  client.graph.episode.get(id, limits)
                ),
            },
          };
          this.user = {
            add: (input: Parameters<Client["user"]["add"]>[0]) =>
              observe("user_add", input, () => client.user.add(input, limits)),
            delete: (id: string) =>
              observe("user_delete", id, () => client.user.delete(id, limits)),
          };
        }
      },
    }),
  };
});

import { memoryBaselineCases } from "../evals/memory-baseline/cases";
import {
  buildProbeMessages,
  createOfflineAdapter,
  createReplay,
  projectVerifiedCandidates,
  REPLAY_TIME,
  scoreProbeAnswer,
} from "../evals/memory-baseline/replay";
import { buildCenterAgentOrganizationMemoryRef } from "../src/center-agent-memory/contract";
import { createZepCenterAgentMemoryAdapter } from "../src/center-agent-memory/zep-memory-adapter";
import { loadZepRuntime } from "../src/lazy-runtime-modules";

// Explicit opt-in experiment, not CI or a production smoke test: #340.
it.skipIf(!process.env.OPENMELD_MEMORY_BASELINE)(
  "records the causal memory baseline without changing product policy",
  async () => {
    const mode = process.env.OPENMELD_MEMORY_BASELINE;
    expect(["offline", "live"]).toContain(mode);
    const live = mode === "live";
    const zepKey = process.env.ZEP_OPENMELD_API_KEY ?? "";
    if (memoryBaselineCases.length * 3 > 18) {
      throw new Error("Corpus exceeds the bounded evaluation budget");
    }
    if (live) {
      expect(process.env.DOPPLER_PROJECT).toBe("openmeld-core");
      expect(process.env.DOPPLER_CONFIG).toBe("dev");
      if (
        !(
          process.env.ZEP_OPENMELD_API_KEY &&
          process.env.OPENROUTER_SMOKE_API_KEY
        )
      ) {
        throw new Error(
          "DEV Zep and OpenRouter smoke credentials are required"
        );
      }
    }
    const runId = `memory-baseline-${randomUUID()}`;
    const directory = resolve(`../../dev-tmp/memory-baseline/${runId}`);
    await mkdir(directory, { recursive: true });
    const model = "z-ai/glm-5.3-flash";
    const report = {
      runId,
      mode,
      candidate: "Space capture, source-bound saves and whole-fact projection",
      corpusSha256: createHash("sha256")
        .update(JSON.stringify(memoryBaselineCases))
        .digest("hex"),
      trackedPatchSha256: createHash("sha256")
        .update(
          execFileSync("git", ["diff", "--binary"], {
            maxBuffer: 16 * 1024 * 1024,
          })
        )
        .digest("hex"),
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirtySource:
        execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim().length > 0,
      startedAt: new Date().toISOString(),
      model: live ? model : null,
      boundary:
        "Sanitized historical reconstructions and labeled controls. Real Core capture/recall and Remote prompt rendering; in-memory policy repository; no native dispatch, tool execution, production subject, or historical Zep trace. Explicit-save wording is reconstructed from visible reports, not a captured write payload. Live client disables retries and caps transport at 15s; Core retains its normal 3s recall and 5s write deadlines.",
      cases: [] as Record<string, unknown>[],
      projection: {} as Record<string, unknown>,
      providerRecords: telemetry.records,
      cleanup: [] as { subjectId: string; status: string }[],
      inferenceRequests: 0,
      reportedInferenceCostUsd: 0,
      inferenceCostsComplete: true,
      zepCost: "unavailable: adapter does not expose provider billing",
      adapterWarnings: [] as unknown[][],
    };
    const save = () =>
      writeFile(
        resolve(directory, "report.json"),
        JSON.stringify(report, null, 2)
      );
    const baseAdapter = live
      ? createZepCenterAgentMemoryAdapter({
          apiKey: zepKey,
          logger: { warn: (...args) => report.adapterWarnings.push(args) },
        })
      : createOfflineAdapter();
    const { ZepClient } = live
      ? await loadZepRuntime()
      : { ZepClient: undefined };
    const client = ZepClient ? new ZepClient({ apiKey: zepKey }) : undefined;
    const owned = new Map<
      string,
      ReturnType<typeof buildCenterAgentOrganizationMemoryRef>
    >();
    const adapter = {
      ...baseAdapter,
      ensureOrganizationGraph: async (
        ref: ReturnType<typeof buildCenterAgentOrganizationMemoryRef>
      ) => {
        if (
          !ref.subject.organizationId.startsWith(`${runId}-`) ||
          (!owned.has(ref.subjectId) && owned.size >= 8)
        ) {
          throw new Error("Evaluation graph budget or ownership mismatch");
        }
        owned.set(ref.subjectId, ref);
        await baseAdapter.ensureOrganizationGraph(ref);
      },
    };

    async function waitForProcessing(receipts: { episodeId: string }[]) {
      if (receipts.length === 0) {
        return { status: "not_applicable" };
      }
      if (!client) {
        return { status: "not_run" };
      }
      const deadline = Date.now() + 90_000;
      let pending = receipts.map((item) => item.episodeId);
      let polls = 0;
      while (pending.length && Date.now() < deadline) {
        polls++;
        const results = await Promise.all(
          pending.map((id) => client.graph.episode.get(id))
        );
        pending = results
          .filter((episode) => !episode.processed)
          .map((episode) => episode.uuid);
        if (pending.length && Date.now() < deadline) {
          await delay(2000);
        }
      }
      return {
        status: pending.length ? "processing_timeout" : "processed",
        pending,
        polls,
      };
    }

    try {
      for (const [index, seed] of memoryBaselineCases.entries()) {
        const subjectId = `${runId}-${index}`;
        const replay = createReplay(subjectId, adapter);
        const row: Record<string, unknown> = {
          id: seed.id,
          origin: seed.origin,
          description: seed.description,
          provider: live ? "live_dev" : "not_run",
          writes: replay.writes,
          queries: replay.queries,
          searches: replay.searches,
          warnings: replay.warnings,
          saveValidation: replay.saveValidation,
          model: [],
        };
        report.cases.push(row);
        telemetry.phase = `${seed.id}:capture`;
        try {
          await replay.capture(seed);
          row.processing = await waitForProcessing(
            replay.writes.flatMap((write) =>
              write.receipt ? [write.receipt] : []
            )
          );
          telemetry.phase = `${seed.id}:current_pipeline`;
          const envelope = await replay.attach(seed.query);
          row.envelope = envelope;
          await Promise.allSettled([...telemetry.pending]);
          row.capture = {
            suppliedTurns: seed.turns.length,
            attemptedWrites: replay.writes.length,
            explicitSave: Boolean(seed.explicitSave),
            activeSubjects: replay.active.size,
          };
          await save();

          // Same prompt/question/model in every arm. Alternate arm order across cases.
          const arms =
            index % 2
              ? (["verified_context", "current_pipeline", "no_memory"] as const)
              : ([
                  "no_memory",
                  "current_pipeline",
                  "verified_context",
                ] as const);
          const systemMessage = buildProbeMessages(
            seed,
            envelope,
            "no_memory"
          )[0];
          if (!systemMessage) {
            throw new Error("Missing system prompt");
          }
          for (const arm of arms) {
            const messages = buildProbeMessages(seed, envelope, arm);
            messages[0] = systemMessage;
            const result: Record<string, unknown> = {
              arm,
              messages,
              score: scoreProbeAnswer(undefined, seed.expected),
            };
            (row.model as unknown[]).push(result);
            if (live) {
              if (
                ++report.inferenceRequests > 18 ||
                Buffer.byteLength(JSON.stringify(messages)) > 100_000 ||
                report.reportedInferenceCostUsd >= 2
              ) {
                throw new Error("Evaluation inference budget reached");
              }
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
                      model,
                      messages,
                      temperature: 0,
                      max_tokens: 1024,
                      response_format: { type: "json_object" },
                      reasoning: { effort: "low" },
                    }),
                  }
                );
                result.httpStatus = response.status;
                if (!response.ok) {
                  throw new Error(`Inference HTTP ${response.status}`);
                }
                const data = (await response.json()) as {
                  id?: string;
                  model?: string;
                  error?: unknown;
                  choices?: {
                    message?: { content?: string };
                    finish_reason?: string;
                  }[];
                  usage?: { cost?: number };
                };
                result.requestId = data.id;
                result.actualModel = data.model;
                result.usage = data.usage;
                result.finishReason = data.choices?.[0]?.finish_reason;
                if (data.error) {
                  throw new Error("Inference provider error");
                }
                const answer = data.choices?.[0]?.message?.content;
                if (typeof answer !== "string") {
                  throw new Error("Inference response has no answer");
                }
                result.answer = answer;
                result.score = scoreProbeAnswer(answer, seed.expected);
                if (typeof data.usage?.cost === "number") {
                  report.reportedInferenceCostUsd += data.usage.cost;
                } else {
                  report.inferenceCostsComplete = false;
                }
              } catch (error) {
                result.error =
                  error instanceof Error ? error.message : "UnknownError";
                result.score = { status: "provider_error", mismatches: [] };
              }
              result.elapsedMs = Math.round(performance.now() - started);
            }
            await save();
          }

          if (live && seed.turns.length) {
            // Intervention: supply all corrected source turns to a NEW graph. This is
            // explicitly not the current shared-Space capture policy or baseline.
            const interventionId = `${subjectId}-source-intervention`;
            const ref = buildCenterAgentOrganizationMemoryRef({
              organizationId: interventionId,
            });
            telemetry.phase = `${seed.id}:source_intervention`;
            await adapter.ensureOrganizationGraph(ref);
            const receipts: { episodeId: string; processed: boolean }[] = [];
            for (const [turnIndex, turn] of seed.turns.entries()) {
              receipts.push(
                await adapter.addEpisode({
                  ref,
                  episode: {
                    source: "space_conversation",
                    captureMethod: "automatic_turn",
                    sourceConversationId: "fixture-space",
                    sourceMessageId: `fixture-${turnIndex}`,
                    occurredAtMs: REPLAY_TIME + turnIndex * 60_000,
                    userMessage: turn.user,
                    assistantMessage: turn.assistant,
                  },
                })
              );
            }
            const intervention: Record<string, unknown> = {
              receipts,
              processing: await waitForProcessing(receipts),
              searches: [],
            };
            row.sourceIntervention = intervention;
            for (const [queryKind, query] of [
              ["actual", seed.query],
              ["focused", seed.focusedQuery],
            ] as const) {
              telemetry.phase = `${seed.id}:source_intervention:${queryKind}`;
              const started = performance.now();
              try {
                const items = await adapter.search({ ref, query, limit: 6 });
                (intervention.searches as unknown[]).push({
                  queryKind,
                  query,
                  items,
                  elapsedMs: Math.round(performance.now() - started),
                });
              } catch (error) {
                (intervention.searches as unknown[]).push({
                  queryKind,
                  query,
                  error: error instanceof Error ? error.name : "UnknownError",
                });
              }
            }
          }
        } catch (error) {
          row.error = error instanceof Error ? error.message : "UnknownError";
        } finally {
          await Promise.allSettled(replay.background);
        }
        await save();
        console.log(
          JSON.stringify({
            evaluation: "memory-baseline",
            case: seed.id,
            capture: row.capture,
            error: row.error,
          })
        );
      }
      const qualifier = "Explicit build requests are the exception.";
      const candidate = `${"Historical background. ".repeat(30)}${qualifier}`;
      const projection = await projectVerifiedCandidates([
        candidate,
        ...Array.from({ length: 5 }, () => "Unrelated fact."),
      ]);
      report.projection = {
        kind: "derived_boundary_intervention",
        candidate,
        qualifier,
        inputContainsQualifier: candidate.includes(qualifier),
        envelopeContainsQualifier: JSON.stringify(projection.memory).includes(
          qualifier
        ),
        memory: projection.memory,
      };
    } finally {
      await Promise.allSettled([...telemetry.pending]);
      if (live) {
        telemetry.phase = "cleanup";
        for (const [subjectId, ref] of owned) {
          if (!ref.subject.organizationId.startsWith(`${runId}-`)) {
            report.cleanup.push({
              subjectId: "redacted",
              status: "unowned_target_refused",
            });
            continue;
          }
          try {
            report.cleanup.push({
              subjectId,
              status: await adapter.deleteOrganizationGraph(ref),
            });
          } catch (error) {
            report.cleanup.push({
              subjectId,
              status: error instanceof Error ? error.name : "UnknownError",
            });
          }
        }
      }
      await save();
      console.log(
        JSON.stringify({
          evaluation: "memory-baseline",
          report: resolve(directory, "report.json"),
          inferenceRequests: report.inferenceRequests,
          reportedInferenceCostUsd: report.reportedInferenceCostUsd,
        })
      );
    }
  },
  900_000
);
