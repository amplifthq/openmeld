import { remoteAiUsageWriteResponseSchema } from "@openmeld/schemas";
import type {
  AiUsageRecord,
  RemoteAiCreditHold,
} from "@openmeld/schemas/types";
// biome-ignore lint/performance/noNamespaceImport: Worker-safe Zod imports avoid bundling unused locales.
import * as z from "zod/v4";
import { estimateRemoteAiCreditHold } from "./ai-credit-hold";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "./callback-context";
import { callCoreRpc } from "./core-rpc";
import { remoteAgentDiagnosticErrorFields } from "./diagnostics-content-policy";
import {
  type RemoteAgentModelEnv,
  resolveRemoteAgentAiGatewayOpenRouterBaseUrl,
} from "./model";

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

export type RemoteAiUsageDurability = {
  storage: RemoteAgentStorage;
  scheduleRetry?: () => Promise<void>;
};

async function writeUsage(
  coreWorker: unknown,
  phase: "begin" | "settle",
  record: AiUsageRecord,
  creditHold?: RemoteAiCreditHold
) {
  return remoteAiUsageWriteResponseSchema.parse(
    await callCoreRpc(
      coreWorker as RemoteAgentCoreWorkerBinding | undefined,
      "recordRemoteAiUsage",
      {
        phase,
        record,
        ...(phase === "begin"
          ? { providerAuthorizationVersion: 2 as const, creditHold }
          : {}),
      },
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
  env?: RemoteAgentModelEnv;
  coreWorker: unknown;
  scope: RemoteAiUsageScope;
  model: string;
  fetch?: typeof globalThis.fetch;
  storage?: RemoteAgentStorage;
  scheduleRetry?: () => Promise<void>;
}): typeof globalThis.fetch {
  return async (url, init) => {
    assertProviderDestination(url, input.env ?? {});
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
    const requestBody = await readRequestBody(url, init);
    // Core admission is required for every new provider call. Deployment order
    // installs the receiver first; a missing RPC is never allowance evidence.
    const admission = await writeUsage(
      input.coreWorker,
      "begin",
      record,
      requestBody
        ? estimateRemoteAiCreditHold({
            modelId: input.model,
            body: requestBody,
          })
        : { status: "unavailable", reason: "unsupported_request" }
    );
    if (admission.status === "limit_reached") {
      throw new Error(
        "ai_usage.monthly_limit_reached: This workspace doesn't have enough included AI credits left. Add an OpenRouter API key in AI usage settings, or wait for the monthly reset."
      );
    }
    const authorization = admission.providerAuthorization;
    if (!authorization) {
      throw new Error(
        "AI provider authorization is unavailable. Try again later."
      );
    }
    record.fundingSource = authorization.source;
    let settlement: Promise<void> | undefined;
    const settle = (
      value: unknown,
      failure?: AiUsageRecord["collectionFailure"]
    ) => {
      settlement ??= persistSettlement(value, failure);
      return settlement;
    };
    const persistSettlement = async (
      value: unknown,
      failure?: AiUsageRecord["collectionFailure"]
    ) => {
      const settled = projectProviderUsage(record, value);
      if (failure && settled.status !== "reported") {
        settled.status = "collection_failed";
        settled.collectionFailure = failure;
      }
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
          ...remoteAgentDiagnosticErrorFields(error, {
            env: input.env,
            organizationId: record.organizationId,
          }),
          durableRetry: Boolean(input.storage),
        });
      }
    };
    let response: Response;
    try {
      const headers = new Headers(
        url instanceof Request ? url.headers : undefined
      );
      new Headers(init?.headers).forEach((value, name) => {
        headers.set(name, value);
      });
      headers.set("Authorization", `Bearer ${authorization.apiKey}`);
      headers.delete("cf-aig-byok-alias");
      // Attribute every hosted model request, including customer-funded calls.
      // https://openrouter.ai/docs/app-attribution
      headers.set("HTTP-Referer", "https://openmeld.ai");
      headers.set("X-OpenRouter-Title", "OpenMeld");
      headers.delete("X-Title");
      const body = withOrganizationAttribution(requestBody, record);
      headers.delete("Content-Length");
      response = await (input.fetch ?? globalThis.fetch)(url, {
        ...init,
        body,
        headers,
        redirect: "manual",
      });
    } catch (error) {
      await settle(null, "request_failed");
      throw error;
    }
    if (!response.body) {
      await settle(null);
      return response;
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      try {
        await settle(await readBoundedUsageJson(response.clone()));
      } catch {
        await settle(null, "invalid_response");
      }
      return response;
    }
    return observeUsageStream(response, settle);
  };
}

async function readRequestBody(
  url: Parameters<typeof globalThis.fetch>[0],
  init: RequestInit | undefined
) {
  const body = init?.body ?? (url instanceof Request ? url.clone().body : null);
  if (!body) {
    return null;
  }
  return z
    .record(z.string(), z.unknown())
    .parse(await new Response(body).json());
}

function withOrganizationAttribution(
  body: Record<string, unknown> | null,
  record: AiUsageRecord
) {
  if (!body) {
    return body;
  }
  return JSON.stringify({
    ...body,
    // This boundary owns attribution. Do not trust caller metadata or put
    // tenant identities in the public application title/referer.
    metadata: {
      openmeld_organization_id: record.organizationId,
      openmeld_funding_source: record.fundingSource,
      openmeld_purpose: record.purpose,
    },
  });
}

function observeUsageStream(
  response: Response,
  settle: (
    value: unknown,
    failure?: AiUsageRecord["collectionFailure"]
  ) => Promise<void>
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
  const observeChunk = (chunk: Uint8Array) => {
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
  };
  const reader = response.body?.getReader();
  if (!reader) {
    return response;
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch (error) {
        await settle(observed, "stream_interrupted");
        controller.error(error);
        return;
      }
      if (next.done) {
        if (!droppingLine) {
          observeLine(buffer + decoder.decode());
        }
        if (!settled) {
          await settle(observed);
        }
        controller.close();
        return;
      }
      const chunk = next.value;
      observeChunk(chunk);
      // Consumers may cancel at [DONE], so flush alone is insufficient.
      // Persist the final native usage before exposing that chunk.
      if (observed !== null && !settled) {
        await settle(observed);
        settled = true;
      }
      controller.enqueue(chunk);
    },
    async cancel(reason) {
      await settle(observed, "stream_interrupted");
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function readBoundedUsageJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return JSON.parse(text + decoder.decode());
      }
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        // Cancel the observer branch without waiting for the consumer's tee.
        reader.cancel().catch(() => undefined);
        throw new Error("AI usage response exceeds 2 MiB.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function projectProviderUsage(
  record: AiUsageRecord,
  value: unknown
): AiUsageRecord {
  const parsed = responseUsage.safeParse(value);
  if (!parsed.success) {
    if (
      value &&
      typeof value === "object" &&
      "usage" in value &&
      value.usage != null
    ) {
      return {
        ...record,
        status: "collection_failed",
        collectionFailure: "invalid_response",
      };
    }
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

function assertProviderDestination(
  url: RequestInfo | URL,
  env: RemoteAgentModelEnv
) {
  const destination = new URL(url instanceof Request ? url.url : String(url));
  const allowed = `${resolveRemoteAgentAiGatewayOpenRouterBaseUrl(env)}/chat/completions`;
  if (destination.href !== allowed) {
    throw new Error("AI provider request destination is not configured.");
  }
}
