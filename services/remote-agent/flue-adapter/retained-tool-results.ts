import type { JsonValue } from "@flue/runtime";
import {
  REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES,
  REMOTE_AGENT_RETAINED_RESULT_MAX_PER_EXECUTION,
  REMOTE_AGENT_RETAINED_RESULT_READ_MAX_CHARS,
  REMOTE_AGENT_RETAINED_RESULT_TTL_MS,
  type RemoteAgentResultSource,
  remoteAgentExecutionScopeKey,
  remoteAgentReadToolResultRequestSchema,
  remoteAgentReadToolResultResponseSchema,
  remoteAgentResultSourcesSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import {
  integer,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  pipe,
  regex,
  strictObject,
  string,
} from "valibot";
import {
  array as zArray,
  literal as zLiteral,
  number as zNumber,
  strictObject as zStrictObject,
  string as zString,
  uuid as zUuid,
} from "zod/v4";
import {
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { requireRemoteAgentExecutionAccess } from "../agent-core/execution-access";
import {
  mergeRemoteAgentResultSources,
  readRemoteAgentResultSources,
  tagRemoteAgentResultSources,
} from "../agent-core/result-access";
import { REMOTE_AGENT_RETAINED_RESULT_PREFIX as PREFIX } from "../agent-core/result-retention";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  isRemoteAgentToolResultWithinBudget,
  REMOTE_AGENT_TOOL_RESULT_MAX_BYTES,
  REMOTE_AGENT_TOOL_RESULT_PRESENTATION_MAX_BYTES,
} from "../agent-core/tool-result-boundary";
import {
  toBoundedRemoteAgentToolResult,
  toFlueJsonValue,
} from "./tool-execution";

const CHUNK_CHARS = 16_384;
// ASCII-only pattern; JSON Schema cannot carry JavaScript RegExp flags.
const RESULT_ID = /^[a-f0-9]{64}$/;
const snapshotSchema = zStrictObject({
  resultId: zString().regex(RESULT_ID),
  storageId: zUuid(),
  submissionId: zString().min(1),
  scopeKey: zString().min(1),
  toolName: zString().min(1),
  totalChars: zNumber().int().nonnegative(),
  bytes: zNumber().int().min(1).max(REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES),
  chunks: zArray(zNumber().int().min(1).max(CHUNK_CHARS)).max(1024),
  sources: remoteAgentResultSourcesSchema,
  expiresAtMs: zNumber().int().nonnegative(),
  v: zLiteral(1),
});
type ResultDependencies = {
  storage: RemoteAgentStorage;
  submissionId: string;
  coreWorker?: RemoteAgentCoreWorkerBinding;
};

function presentationBudget(toolName: string): number {
  // Continuation pages have their own character budget. Re-retaining a
  // Unicode-heavy page would prevent the model from ever reading it.
  return toolName === "openmeld_read_tool_result"
    ? REMOTE_AGENT_TOOL_RESULT_MAX_BYTES
    : REMOTE_AGENT_TOOL_RESULT_PRESENTATION_MAX_BYTES;
}

/** A failed display-store write must never turn a completed provider write into a retry. */
export async function prepareRemoteAgentToolResult(
  input: ResultDependencies & {
    toolName: string;
    value: unknown;
    sources?: RemoteAgentResultSource[];
    maxBytes?: number;
  }
) {
  const json = toFlueJsonValue(input.value);
  const sources = mergeRemoteAgentResultSources(
    readRemoteAgentResultSources(input.value),
    input.sources ?? []
  );
  const maxBytes = input.maxBytes ?? presentationBudget(input.toolName);
  const needsRetention =
    json !== undefined && !isRemoteAgentToolResultWithinBudget(json, maxBytes);
  const scope =
    sources.length || needsRetention
      ? await authorizeResultPresentation(input, sources)
      : undefined;
  if (scope === null) {
    return withheldResult(input.toolName);
  }
  if (!needsRetention) {
    return tagRemoteAgentResultSources(json, sources);
  }
  const bounded = toBoundedRemoteAgentToolResult({
    toolName: input.toolName,
    value: json,
    maxBytes,
  });
  if (!(isJsonObject(bounded) && isJsonObject(bounded.presentation))) {
    return bounded;
  }
  const presentation = bounded.presentation;
  if (!scope) {
    return withheldResult(input.toolName);
  }
  let prepared: ReturnType<typeof toBoundedRemoteAgentToolResult>;
  try {
    const text = JSON.stringify(json);
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES) {
      throw new Error("retention_limit");
    }
    const scopeKey = remoteAgentExecutionScopeKey(scope);
    const resultId = await digest(
      JSON.stringify([
        scopeKey,
        input.submissionId,
        input.toolName,
        sources,
        text,
      ])
    );
    const metaPrefix = `${PREFIX}meta:${input.submissionId}:`;
    const key = `${metaPrefix}${resultId}`;
    const previous = snapshotSchema.safeParse(await input.storage.get(key));
    let expiresAtMs = previous.success
      ? previous.data.expiresAtMs
      : Date.now() + REMOTE_AGENT_RETAINED_RESULT_TTL_MS;
    if (!previous.success || expiresAtMs <= Date.now()) {
      expiresAtMs = Date.now() + REMOTE_AGENT_RETAINED_RESULT_TTL_MS;
      const storageId = crypto.randomUUID();
      const reservation = { resultId, storageId, expiresAtMs };
      const slot = await reserveSnapshotSlot(
        input.storage,
        input.submissionId,
        reservation
      );
      const chunks: number[] = [];
      const written: string[] = [];
      try {
        for (let start = 0; start < text.length; ) {
          const end = unicodeBoundary(
            text,
            Math.min(start + CHUNK_CHARS, text.length)
          );
          const chunkKey = `${PREFIX}chunk:${resultId}:${storageId}:${chunks.length}`;
          await input.storage.putExpiring(
            chunkKey,
            text.slice(start, end),
            expiresAtMs
          );
          written.push(chunkKey);
          chunks.push(end - start);
          start = end;
        }
        // Publish the reference only after every chunk exists.
        await input.storage.putExpiring(
          key,
          snapshotSchema.parse({
            resultId,
            storageId,
            submissionId: input.submissionId,
            scopeKey,
            toolName: input.toolName,
            totalChars: text.length,
            bytes,
            chunks,
            sources,
            expiresAtMs,
            v: 1,
          }),
          expiresAtMs
        );
      } catch (error) {
        await Promise.allSettled(
          written.map((chunkKey) => input.storage.delete(chunkKey))
        );
        // CAS releases only this writer's reservation, without deleting a slot
        // that a concurrent writer may already have reused after expiry.
        await input.storage.compareAndSetExpiring(
          slot,
          reservation,
          null,
          Date.now()
        );
        throw error;
      }
    }
    prepared = tagRemoteAgentResultSources(
      {
        ...bounded,
        presentation: {
          ...presentation,
          continuation: {
            tool: "openmeld_read_tool_result",
            resultId,
            expiresAtMs,
            offsetUnit: "utf16",
            format: "json",
          },
          message:
            "The tool returned; only its display is shortened. The exact returned JSON is retained for this execution. Read or search it with openmeld_read_tool_result; never repeat a write to recover output. Provider completeness limits still apply. Current execution and source-connection permissions are checked again on every read.",
        },
      },
      sources
    );
  } catch {
    // No provider body, token, or exception text enters logs or this recovery copy.
    prepared = tagRemoteAgentResultSources(
      {
        ...bounded,
        presentation: {
          ...presentation,
          continuation: null,
          message:
            "The tool returned; its authorized receipt and excerpts are shown. The full display could not be retained within the storage or size limit. Use provider pagination or a narrower read. Do not repeat a completed write.",
        },
      },
      sources
    );
  }
  // Authorization denial is never handled by the display-store fallback.
  return (await authorizeResultPresentation(input, sources))
    ? tagRemoteAgentResultSources(prepared, sources)
    : withheldResult(input.toolName);
}

function isJsonObject(
  value: JsonValue | undefined
): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function authorizeResultPresentation(
  input: ResultDependencies,
  sources: RemoteAgentResultSource[]
) {
  try {
    const context = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (
      !(context && input.coreWorker) ||
      sources.some((source) => source.connectionUpdatedAtMs === undefined)
    ) {
      return null;
    }
    return await requireRemoteAgentExecutionAccess({
      context,
      coreWorker: input.coreWorker,
      sources,
    });
  } catch {
    return null;
  }
}

function withheldResult(toolName: string) {
  // Even small provider fields/IDs may contain private data. Only the existing
  // trusted operation ledger can independently establish safe outcome facts.
  return {
    toolName,
    toolExecution: "returned",
    presentation: {
      kind: "withheld",
      reasonCode: "remote_agent.tool_result_access_denied",
      continuation: null,
      message:
        "The tool returned, but current access to its content could not be verified. No result content is released. Effects may already have committed: reconcile the original operation through its authorized ledger; do not repeat a write to recover output.",
    },
  };
}

export function createRemoteAgentReadToolResultDefinition(
  input: ResultDependencies
): RemoteAgentToolDefinition {
  return {
    name: "openmeld_read_tool_result",
    description:
      "Read or search the exact retained JSON from a previous tool result in this same execution. Use the resultId returned in presentation.continuation. offset/nextOffset count UTF-16 code units; limit is at most 12000 characters. Set query for a literal search with bounded surrounding excerpts. This does not rerun the original action. References expire after one hour and remain subject to current execution and connection permissions; an expired, foreign or revoked result is not recoverable by repeating a write.",
    input: strictObject({
      resultId: pipe(string(), regex(RESULT_ID)),
      offset: optional(pipe(number(), integer(), minValue(0))),
      limit: optional(
        pipe(
          number(),
          integer(),
          minValue(1),
          maxValue(REMOTE_AGENT_RETAINED_RESULT_READ_MAX_CHARS)
        )
      ),
      query: optional(pipe(string(), minLength(1), maxLength(200))),
    }),
    execute: async (value, options) => {
      options?.signal?.throwIfAborted();
      const request = remoteAgentReadToolResultRequestSchema.parse(value);
      const metadata = snapshotSchema.safeParse(
        await input.storage.get(
          `${PREFIX}meta:${input.submissionId}:${request.resultId}`
        )
      );
      if (!metadata.success || metadata.data.expiresAtMs <= Date.now()) {
        throw new Error(
          "remote_agent.tool_result_unavailable: The reference is expired or is not part of this execution."
        );
      }
      const context = await readRemoteAgentCallbackContext(
        input.storage,
        input.submissionId
      );
      if (!(context && input.coreWorker)) {
        throw new Error("remote_agent.execution_access_unavailable");
      }
      const snapshot = metadata.data;
      if (
        snapshot.submissionId !== input.submissionId ||
        snapshot.scopeKey !==
          remoteAgentExecutionScopeKey(
            resolveRemoteAgentExecutionScope(context)
          )
      ) {
        throw new Error("remote_agent.tool_result_audience_mismatch");
      }
      await requireRemoteAgentExecutionAccess({
        context,
        coreWorker: input.coreWorker,
        sources: snapshot.sources,
      });
      const offset = request.offset ?? 0;
      if (offset > snapshot.totalChars) {
        throw new Error("remote_agent.tool_result_offset_invalid");
      }
      const common = {
        resultId: request.resultId,
        format: "json" as const,
        offsetUnit: "utf16" as const,
        totalChars: snapshot.totalChars,
        expiresAtMs: snapshot.expiresAtMs,
      };
      if (request.query !== undefined) {
        const projection = await searchSnapshot(
          input.storage,
          snapshot,
          request.query,
          offset,
          options?.signal
        );
        await requireRemoteAgentExecutionAccess({
          context,
          coreWorker: input.coreWorker,
          sources: snapshot.sources,
        });
        return tagRemoteAgentResultSources(
          remoteAgentReadToolResultResponseSchema.parse({
            ...common,
            kind: "search",
            query: request.query,
            ...projection,
          }),
          snapshot.sources
        );
      }
      const projection = await readSnapshotPage(
        input.storage,
        snapshot,
        offset,
        request.limit,
        options?.signal
      );
      await requireRemoteAgentExecutionAccess({
        context,
        coreWorker: input.coreWorker,
        sources: snapshot.sources,
      });
      return tagRemoteAgentResultSources(
        remoteAgentReadToolResultResponseSchema.parse({
          ...common,
          kind: "read",
          ...projection,
        }),
        snapshot.sources
      );
    },
  };
}

async function searchSnapshot(
  storage: RemoteAgentStorage,
  snapshot: ReturnType<typeof snapshotSchema.parse>,
  query: string,
  offset: number,
  signal?: AbortSignal
) {
  // Bounded by the snapshot byte budget, never a repeated provider action.
  const text = await readRange(
    storage,
    snapshot,
    0,
    snapshot.totalChars,
    signal
  );
  const matches: { offset: number; excerptOffset: number; text: string }[] = [];
  let cursor = offset;
  while (matches.length < 20) {
    signal?.throwIfAborted();
    const at = text.indexOf(query, cursor);
    if (at === -1) {
      cursor = text.length;
      break;
    }
    const start = unicodeBoundary(text, Math.max(0, at - 160));
    const end = unicodeBoundary(
      text,
      Math.min(text.length, at + query.length + 160)
    );
    matches.push({
      offset: at,
      excerptOffset: start,
      text: text.slice(start, end),
    });
    cursor = at + query.length;
  }
  return { matches, nextOffset: cursor < text.length ? cursor : null };
}

async function readSnapshotPage(
  storage: RemoteAgentStorage,
  snapshot: ReturnType<typeof snapshotSchema.parse>,
  offset: number,
  limit: number | undefined,
  signal?: AbortSignal
) {
  const baseOffset = Math.max(0, offset - 1);
  const requestedEnd = Math.min(
    snapshot.totalChars,
    offset + (limit ?? REMOTE_AGENT_RETAINED_RESULT_READ_MAX_CHARS)
  );
  const text = await readRange(
    storage,
    snapshot,
    baseOffset,
    Math.min(snapshot.totalChars, requestedEnd + 1),
    signal
  );
  const start = unicodeBoundary(text, offset === 0 ? 0 : 1);
  const end = unicodeBoundary(text, requestedEnd - baseOffset);
  const actualOffset = baseOffset + start;
  const actualEnd = baseOffset + end;
  if (actualEnd <= actualOffset && offset < snapshot.totalChars) {
    throw new Error(
      "remote_agent.tool_result_limit_too_small: Use at least two characters at this Unicode boundary."
    );
  }
  return {
    offset: actualOffset,
    text: text.slice(start, end),
    nextOffset: actualEnd < snapshot.totalChars ? actualEnd : null,
  };
}

async function readRange(
  storage: RemoteAgentStorage,
  snapshot: ReturnType<typeof snapshotSchema.parse>,
  start: number,
  end: number,
  signal?: AbortSignal
) {
  let cursor = 0;
  const parts: string[] = [];
  for (let index = 0; index < snapshot.chunks.length; index += 1) {
    signal?.throwIfAborted();
    const length = snapshot.chunks[index] ?? 0;
    const next = cursor + length;
    if (next > start && cursor < end) {
      const chunk = await storage.get<string>(
        `${PREFIX}chunk:${snapshot.resultId}:${snapshot.storageId}:${index}`
      );
      if (typeof chunk !== "string" || chunk.length !== length) {
        throw new Error("remote_agent.tool_result_incomplete");
      }
      parts.push(
        chunk.slice(Math.max(0, start - cursor), Math.min(length, end - cursor))
      );
    }
    cursor = next;
    if (cursor >= end) {
      break;
    }
  }
  if (snapshot.expiresAtMs <= Date.now()) {
    throw new Error("remote_agent.tool_result_expired");
  }
  return parts.join("");
}

type SnapshotReservation = {
  resultId: string;
  storageId: string;
  expiresAtMs: number;
};

async function reserveSnapshotSlot(
  storage: RemoteAgentStorage,
  submissionId: string,
  reservation: SnapshotReservation
) {
  for (
    let index = 0;
    index < REMOTE_AGENT_RETAINED_RESULT_MAX_PER_EXECUTION;
    index += 1
  ) {
    const key = `${PREFIX}slot:${submissionId}:${index}`;
    const previous = await storage.get<SnapshotReservation | null>(key);
    if (previous && previous.expiresAtMs > Date.now()) {
      if (previous.resultId === reservation.resultId) {
        throw new Error("result_retention_in_progress");
      }
      continue;
    }
    if (
      await storage.compareAndSetExpiring(
        key,
        previous,
        reservation,
        reservation.expiresAtMs
      )
    ) {
      return key;
    }
  }
  throw new Error("retention_quota");
}

function unicodeBoundary(text: string, offset: number) {
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return previous >= 0xd8_00 &&
    previous <= 0xdb_ff &&
    current >= 0xdc_00 &&
    current <= 0xdf_ff
    ? offset - 1
    : offset;
}

async function digest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}
