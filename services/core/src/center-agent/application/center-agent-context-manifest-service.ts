import {
  CENTER_AGENT_CONTEXT_TOKEN_ESTIMATE_ALGORITHM,
  createCenterAgentContextManifestResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentContextManifestEntry,
  CenterAgentContextManifestMaterialization,
  CenterAgentContextManifestSourceRef,
  CreateCenterAgentContextManifestResponse,
  SignalEnvelope,
} from "@openmeld/schemas/types";

const CURSOR_VERSION = "center_agent_context_cursor.v1" as const;
const TEXT_ENCODER = new TextEncoder();

type TextSignalEnvelope = Extract<SignalEnvelope, { type: "signal.text" }>;
type TruncationReason =
  CreateCenterAgentContextManifestResponse["budget"]["truncationReasons"][number];

export type CenterAgentContextMessageProjection = {
  budget: CreateCenterAgentContextManifestResponse["budget"];
  continuation: CreateCenterAgentContextManifestResponse["continuation"];
  entries: CenterAgentContextManifestEntry[];
  materializations: CenterAgentContextManifestMaterialization[];
  sourceRefs: CenterAgentContextManifestSourceRef[];
};

export class CenterAgentContextTokenBudgetTooSmallError extends Error {
  readonly code = "center_agent.context_token_budget_too_small" as const;
  readonly minimumRequiredTokens: number;

  constructor(minimumRequiredTokens: number) {
    super(
      `Center Agent context token budget must be at least ${minimumRequiredTokens} tokens for the next visible message.`
    );
    this.name = "CenterAgentContextTokenBudgetTooSmallError";
    this.minimumRequiredTokens = minimumRequiredTokens;
  }
}

export async function buildCenterAgentContextMessageProjection(input: {
  hasOlderMessages: boolean;
  limit: number;
  maxContextTokens: number;
  signals: readonly SignalEnvelope[];
  spaceId: string;
}): Promise<CenterAgentContextMessageProjection> {
  const textSignals = input.signals.filter(
    (signal): signal is TextSignalEnvelope => signal.type === "signal.text"
  );
  const limitedSignals = textSignals.slice(-input.limit);
  const reasons = new Set<TruncationReason>();
  if (textSignals.length > limitedSignals.length) {
    reasons.add("message_limit");
  }

  const selectedNewestFirst: CenterAgentContextManifestEntry[] = [];
  let estimatedTokens = 0;
  for (const signal of limitedSignals.toReversed()) {
    const entry = await materializeEntry({
      signal,
      spaceId: input.spaceId,
    });
    const entryTokens = estimateTokens(entry);
    if (estimatedTokens + entryTokens <= input.maxContextTokens) {
      selectedNewestFirst.push(entry);
      estimatedTokens += entryTokens;
      continue;
    }

    reasons.add("context_token_budget");
    if (selectedNewestFirst.length > 0) {
      break;
    }
    const truncatedEntry = await truncateEntryToTokenBudget({
      entry,
      maxContextTokens: input.maxContextTokens,
    });
    selectedNewestFirst.push(truncatedEntry);
    estimatedTokens = estimateTokens(truncatedEntry);
    reasons.add("message_content_budget");
  }

  const entries = selectedNewestFirst.toReversed();
  const omittedByBudget = entries.length < limitedSignals.length;
  const hasMore = input.hasOlderMessages || omittedByBudget;
  if (hasMore) {
    reasons.add("older_messages_available");
  }
  const oldestEntry = entries.at(0);
  const cursor =
    hasMore && oldestEntry
      ? encodeCenterAgentContextCursor({ signalId: oldestEntry.sourceRef.id })
      : null;
  const result: CenterAgentContextMessageProjection = {
    budget: {
      estimateAlgorithm: CENTER_AGENT_CONTEXT_TOKEN_ESTIMATE_ALGORITHM,
      estimatedTokens,
      includedMessages: entries.length,
      requestedTokens: input.maxContextTokens,
      truncated: reasons.size > 0,
      truncationReasons: [...reasons],
    },
    continuation: { cursor, hasMore },
    entries,
    materializations: entries.map((entry) => ({
      estimatedTokens: estimateTokens(entry),
      materializedContentHash: entry.materializedContentHash,
      sourceRef: entry.sourceRef,
    })),
    sourceRefs: entries.map((entry) => entry.sourceRef),
  };
  return result;
}

export function encodeCenterAgentContextCursor(input: {
  signalId: string;
}): string {
  return `${CURSOR_VERSION}:${encodeURIComponent(input.signalId)}`;
}

export function decodeCenterAgentContextCursor(cursor: string): {
  signalId: string;
} {
  const prefix = `${CURSOR_VERSION}:`;
  if (!cursor.startsWith(prefix)) {
    throw new Error("Unsupported Center Agent context cursor.");
  }
  const signalId = decodeURIComponent(cursor.slice(prefix.length)).trim();
  if (!signalId) {
    throw new Error("Invalid Center Agent context cursor.");
  }
  return { signalId };
}

export function validateCenterAgentContextManifestResponse(
  response: CreateCenterAgentContextManifestResponse
): CreateCenterAgentContextManifestResponse {
  const parsed =
    createCenterAgentContextManifestResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      `failed to build Center Agent context manifest response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

async function materializeEntry(input: {
  signal: TextSignalEnvelope;
  spaceId: string;
}): Promise<CenterAgentContextManifestEntry> {
  const originalText = input.signal.data.text;
  const redactions: CenterAgentContextManifestEntry["redactions"] = [];
  if ((input.signal.data.attachments?.length ?? 0) > 0) {
    redactions.push("attachments_not_in_messages_view");
  }
  const interactionSource =
    input.signal.data.meta?.centerAgentInteractionSource;
  if (interactionSource?.sessionId) {
    redactions.push("local_session_locator_omitted");
  }
  const version = await sha256(
    JSON.stringify({
      data: {
        replyToSignalId:
          input.signal.data.messageEnvelope?.replyToSignalId ??
          input.signal.data.replyTo?.signalId ??
          null,
        text: originalText,
      },
      id: input.signal.id,
      profile: {
        kind: input.signal.profile.kind,
        profileId: input.signal.profile.profileId,
        profileName: input.signal.profile.profileName ?? null,
      },
      ts: input.signal.ts,
    })
  );
  const entry: CenterAgentContextManifestEntry = {
    author: {
      profileId: input.signal.profile.profileId,
      profileKind: input.signal.profile.kind,
      profileName:
        input.signal.profile.profileName ?? input.signal.profile.profileId,
    },
    ...(interactionSource
      ? {
          carrier: {
            client: interactionSource.client,
            kind: interactionSource.kind,
          },
        }
      : {}),
    content: {
      originalCharacterCount: Array.from(originalText).length,
      text: originalText,
      truncated: false,
      type: "text",
    },
    materializedContentHash: await sha256(originalText),
    occurredAt: new Date(input.signal.ts).toISOString(),
    redactions,
    ...((input.signal.data.messageEnvelope?.replyToSignalId ??
    input.signal.data.replyTo?.signalId)
      ? {
          replyToSignalId:
            input.signal.data.messageEnvelope?.replyToSignalId ??
            input.signal.data.replyTo?.signalId,
        }
      : {}),
    sourceRef: {
      id: input.signal.id,
      type: "space_signal",
      uri: `openmeld://spaces/${encodeURIComponent(input.spaceId)}/signals/${encodeURIComponent(input.signal.id)}`,
      version,
    },
  };
  return entry;
}

async function truncateEntryToTokenBudget(input: {
  entry: CenterAgentContextManifestEntry;
  maxContextTokens: number;
}): Promise<CenterAgentContextManifestEntry> {
  const characters = Array.from(input.entry.content.text);
  const minimumEntry = await buildTruncatedEntry(input.entry, "");
  const minimumRequiredTokens = estimateTokens(minimumEntry);
  if (minimumRequiredTokens > input.maxContextTokens) {
    throw new CenterAgentContextTokenBudgetTooSmallError(minimumRequiredTokens);
  }

  let lower = 1;
  let upper = characters.length;
  let best = minimumEntry;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const text = characters.slice(0, middle).join("");
    const candidate = await buildTruncatedEntry(input.entry, text);
    if (estimateTokens(candidate) <= input.maxContextTokens) {
      best = candidate;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return best;
}

async function buildTruncatedEntry(
  entry: CenterAgentContextManifestEntry,
  text: string
): Promise<CenterAgentContextManifestEntry> {
  return {
    ...entry,
    content: { ...entry.content, text, truncated: true },
    materializedContentHash: await sha256(text),
    redactions: [
      ...entry.redactions,
      ...(entry.redactions.includes("message_content_budget")
        ? []
        : (["message_content_budget"] as const)),
    ],
  };
}

function estimateTokens(value: unknown): number {
  return Math.ceil(TEXT_ENCODER.encode(JSON.stringify(value)).byteLength / 3);
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    TEXT_ENCODER.encode(value)
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}
