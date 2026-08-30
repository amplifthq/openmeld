import type { SignalEnvelope } from "@openmeld/protocol";
import { parseEnvelope } from "@openmeld/protocol";
import {
  catchupResponseSchema,
  normalizeListSignalsReadQuerySemantics,
} from "@openmeld/schemas";
import type { CatchupResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { currentSpaceAddressingHeaders } from "./addressing-contract";
import { buildSpaceSignalsPath } from "./routes";
import type {
  SpaceHistorySignalKind,
  SpaceRequestInput,
  SpaceSignalsReadQuery,
} from "./types";

const SPACE_HISTORY_SIGNAL_KIND_TO_TYPE = {
  text: "signal.text",
  status: "signal.status",
  system_notice: "signal.system_notice",
} as const satisfies Record<SpaceHistorySignalKind, string>;

type NormalizedSpaceSignalsReadQuery = {
  afterTs: number | null;
  cursor: string | null;
  recent: boolean;
  includeLimit: boolean;
  limit: number;
  afterSignalId: string | null;
  aroundSignalId: string | null;
  beforeCount: number | null;
  afterCount: number | null;
  fromProfileIds: readonly string[];
  kinds: readonly SpaceHistorySignalKind[];
};

export async function listSpaceSignals(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { query?: SpaceSignalsReadQuery }
): Promise<CatchupResponse> {
  return await client.requestJson({
    url: buildSpaceSignalsReadPath(input.spaceId, input.query),
    operation: "space.signals.read",
    headers: currentSpaceAddressingHeaders(),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: catchupResponseSchema,
    invalidMessage: "Unexpected response: expected { signals, nextCursor }",
  });
}

export async function listSpaceSignalEnvelopes(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { query?: SpaceSignalsReadQuery }
): Promise<{
  envelopes: readonly SignalEnvelope[];
  nextCursor: string | null;
}> {
  const result = await listSpaceSignals(client, input);
  return {
    envelopes: result.signals.flatMap((item) => {
      const envelope = parseEnvelope(item);
      return envelope ? [envelope] : [];
    }),
    nextCursor: result.nextCursor,
  };
}

export function buildSpaceSignalsReadPath(
  spaceId: string,
  query?: SpaceSignalsReadQuery
): string {
  const url = new URL(buildSpaceSignalsPath(spaceId), "https://openmeld.local");
  for (const [key, value] of buildSpaceSignalsReadSearchParams(query)) {
    url.searchParams.append(key, value);
  }

  return `${url.pathname}${url.search}`;
}

export function buildSpaceSignalsReadSearchParams(
  query?: SpaceSignalsReadQuery
): URLSearchParams {
  const searchParams = new URLSearchParams();
  const normalizedQuery = normalizeSpaceSignalsReadQuery(query);

  if (normalizedQuery.afterTs !== null) {
    searchParams.set("afterTs", String(normalizedQuery.afterTs));
  }
  if (normalizedQuery.cursor) {
    searchParams.set("cursor", normalizedQuery.cursor);
  }
  if (normalizedQuery.recent) {
    searchParams.set("recent", "1");
  }
  if (normalizedQuery.includeLimit) {
    searchParams.set("limit", String(normalizedQuery.limit));
  }
  if (normalizedQuery.afterSignalId) {
    searchParams.set("afterSignalId", normalizedQuery.afterSignalId);
  }
  if (normalizedQuery.aroundSignalId) {
    searchParams.set("aroundSignalId", normalizedQuery.aroundSignalId);
  }
  if (normalizedQuery.beforeCount !== null) {
    searchParams.set("beforeCount", String(normalizedQuery.beforeCount));
  }
  if (normalizedQuery.afterCount !== null) {
    searchParams.set("afterCount", String(normalizedQuery.afterCount));
  }
  for (const profileId of normalizedQuery.fromProfileIds) {
    searchParams.append("fromProfileId", profileId);
  }
  for (const kind of normalizedQuery.kinds) {
    searchParams.append("signalType", SPACE_HISTORY_SIGNAL_KIND_TO_TYPE[kind]);
  }

  return searchParams;
}

function normalizeSpaceSignalsReadQuery(
  query?: SpaceSignalsReadQuery
): NormalizedSpaceSignalsReadQuery {
  const afterTs = normalizeOptionalNonNegativeInteger(query?.afterTs);
  const cursor = normalizeOptionalString(query?.cursor);
  const afterSignalId = normalizeOptionalString(query?.afterSignalId);
  const aroundSignalId = normalizeOptionalString(query?.aroundSignalId);
  const beforeCount = normalizeOptionalNonNegativeInteger(query?.beforeCount);
  const afterCount = normalizeOptionalNonNegativeInteger(query?.afterCount);
  const limit = normalizeOptionalNonNegativeInteger(query?.limit);
  const recent = query?.recent === true;
  const fromProfileIds = normalizeUniqueStrings(query?.fromProfileIds ?? []);
  const kinds = normalizeKinds(query?.kinds ?? []);
  const semantics = normalizeListSignalsReadQuerySemantics({
    recentOnly: recent,
    hasExplicitLimit: query?.limit !== undefined,
    limit,
    afterSignalId,
    aroundSignalId,
    beforeCount,
    afterCount,
  });
  if (
    (semantics.afterSignalId || semantics.aroundSignalId) &&
    (afterTs !== null || cursor !== null)
  ) {
    throw new Error(
      "Signal anchors cannot be combined with afterTs or cursor."
    );
  }

  return {
    afterTs,
    cursor,
    recent: semantics.recentOnly,
    includeLimit: semantics.includeLimit,
    limit: semantics.limit,
    afterSignalId: semantics.afterSignalId,
    aroundSignalId: semantics.aroundSignalId,
    beforeCount: semantics.beforeCount,
    afterCount: semantics.afterCount,
    fromProfileIds,
    kinds,
  };
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalNonNegativeInteger(
  value: number | undefined
): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("history query counts must be non-negative integers");
  }
  return value;
}

function normalizeUniqueStrings(values: readonly string[]): readonly string[] {
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
}

function normalizeKinds(
  values: readonly SpaceHistorySignalKind[]
): readonly SpaceHistorySignalKind[] {
  const deduped = new Set<SpaceHistorySignalKind>();
  for (const value of values) {
    deduped.add(value);
  }
  return [...deduped];
}
