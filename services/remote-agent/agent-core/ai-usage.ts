import { remoteAiUsageWriteResponseSchema } from "@openmeld/schemas";
import type { AiUsageRecord } from "@openmeld/schemas/types";
import { z } from "zod/v4";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "./callback-context";
import { callCoreRpc } from "./core-rpc";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// OpenRouter usage is part of the existing JSON response or final SSE chunk.
// https://openrouter.ai/docs/cookbook/administration/usage-accounting
const responseUsage = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  usage: z.object({
    prompt_tokens: count,
    completion_tokens: count,
    total_tokens: count,
    cost: z.number().nonnegative().optional(),
    prompt_tokens_details: z
      .object({
        cached_tokens: count.optional(),
        cache_write_tokens: count.optional(),
      })
      .nullish(),
    completion_tokens_details: z
      .object({ reasoning_tokens: count.optional() })
      .nullish(),
  }),
});
const OUTBOX_PREFIX = "openmeld:ai-usage:pending:";
const SSE_LINE_PARTS = /(?<=\n)/u;

export type RemoteAiUsageScope = Pick<
  AiUsageRecord,
  | "organizationId"
  | "purpose"
  | "agentProfileId"
  | "spaceId"
  | "taskId"
  | "attemptId"
  | "dispatchId"
>;

async function writeUsage(
  coreWorker: unknown,
  phase: "begin" | "settle",
  record: AiUsageRecord
) {
  return remoteAiUsageWriteResponseSchema.parse(
    await callCoreRpc(
      coreWorker as RemoteAgentCoreWorkerBinding | undefined,
      "recordRemoteAiUsage",
      { phase, record },
      (binding, request) => binding.recordRemoteAiUsage?.(request)
    )
  );
}

export async function flushRemoteAiUsage(input: {
  coreWorker: RemoteAgentCoreWorkerBinding | undefined;
  storage: RemoteAgentStorage;
}): Promise<boolean> {
  const pending = await input.storage.list<AiUsageRecord>({
    prefix: OUTBOX_PREFIX,
    limit: 100,
  });
  for (const [key, record] of pending) {
    await writeUsage(input.coreWorker, "settle", record);
    await input.storage.delete(key);
  }
  return pending.size === 100;
}

export function createMeteredRemoteFetch(input: {
  coreWorker: unknown;
  scope: RemoteAiUsageScope;
  model: string;
  fetch?: typeof globalThis.fetch;
  storage?: RemoteAgentStorage;
  scheduleRetry?: () => Promise<void>;
}): typeof globalThis.fetch {
  return async (url, init) => {
    const record: AiUsageRecord = {
      ...input.scope,
      eventId: `openrouter:${crypto.randomUUID()}`,
      provider: "openrouter",
      model: input.model,
      source: "openrouter_response",
      status: "pending",
      providerRequestId: null,
      occurredAtMs: Date.now(),
      runtime: "remote",
      controller: null,
      computerId: null,
      tokens: null,
      cost: null,
    };
    const admission = await writeUsage(input.coreWorker, "begin", record);
    if (admission.status === "limit_reached") {
      throw new Error(
        "ai_usage.daily_limit_reached: This Organization has used its daily AI allowance. It resets at 00:00 UTC."
      );
    }
    const settle = async (value: unknown) => {
      const settled = projectProviderUsage(record, value);
      const key = `${OUTBOX_PREFIX}${record.eventId}`;
      try {
        if (input.storage) {
          await input.storage.put(key, settled);
          await input.scheduleRetry?.();
        }
        await writeUsage(input.coreWorker, "settle", settled);
        await input.storage?.delete(key);
      } catch (error) {
        // The request was admitted durably. Preserve unknown/pending evidence
        // and the outbox without making the SDK repeat an already-paid call.
        console.error("[remote_agent.ai_usage.settlement_pending]", {
          eventId: record.eventId,
          organizationId: record.organizationId,
          error: error instanceof Error ? error.message : String(error),
          durableRetry: Boolean(input.storage),
        });
      }
    };
    const response = await (input.fetch ?? globalThis.fetch)(url, init);
    if (!response.body) {
      await settle(null);
      return response;
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      await settle(
        await response
          .clone()
          .json()
          .catch(() => null)
      );
      return response;
    }
    return observeUsageStream(response, settle);
  };
}

function observeUsageStream(
  response: Response,
  settle: (value: unknown) => Promise<void>
): Response {
  const decoder = new TextDecoder();
  let buffer = "";
  let droppingLine = false;
  let observed: unknown = null;
  let settled = false;
  const observeLine = (line: string) => {
    if (!line.startsWith("data:")) {
      return;
    }
    try {
      const value: unknown = JSON.parse(line.slice(5).trim());
      if (responseUsage.safeParse(value).success) {
        observed = value;
      }
    } catch {
      // SSE control frames (including [DONE]) are not usage evidence.
    }
  };
  const body = response.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        for (const part of text.split(SSE_LINE_PARTS)) {
          if (!droppingLine) {
            buffer += part;
            if (buffer.length > 262_144) {
              buffer = "";
              droppingLine = true;
            }
          }
          if (part.endsWith("\n")) {
            if (!droppingLine) {
              observeLine(buffer.trim());
            }
            buffer = "";
            droppingLine = false;
          }
        }
        // Consumers may cancel at [DONE], so flush alone is insufficient.
        // Persist the final native usage before exposing that chunk.
        if (observed !== null && !settled) {
          await settle(observed);
          settled = true;
        }
        controller.enqueue(chunk);
      },
      async flush() {
        if (!droppingLine) {
          observeLine(buffer + decoder.decode());
        }
        if (!settled) {
          await settle(observed);
        }
      },
    })
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function projectProviderUsage(
  record: AiUsageRecord,
  value: unknown
): AiUsageRecord {
  const parsed = responseUsage.safeParse(value);
  if (!parsed.success) {
    return { ...record, status: "unavailable" };
  }
  const { usage, id, model } = parsed.data;
  return {
    ...record,
    status: "reported",
    providerRequestId: id ?? null,
    model: model ?? record.model,
    tokens: {
      input: usage.prompt_tokens,
      output: usage.completion_tokens,
      total: usage.total_tokens,
      cacheRead: usage.prompt_tokens_details?.cached_tokens ?? null,
      cacheWrite: usage.prompt_tokens_details?.cache_write_tokens ?? null,
      reasoning: usage.completion_tokens_details?.reasoning_tokens ?? null,
    },
    cost:
      usage.cost === undefined
        ? null
        : {
            nanoUsd: Math.round(usage.cost * 1_000_000_000),
            kind: "provider_reported",
          },
  };
}
