import { z } from "zod/v4";

const CATCHUP_DEFAULT_LIMIT = 200;
const CATCHUP_MAX_LIMIT = 500;
const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;
const NON_NEGATIVE_INT_RE = /^\d+$/;
const SIGNAL_TYPE_VALUES = [
  "signal.text",
  "signal.status",
  "signal.system_notice",
] as const;
const SIGNAL_TYPE_SET = new Set<string>(SIGNAL_TYPE_VALUES);

const listSignalsQueryInputSchema = z.strictObject({
  afterTs: z.string().nullable(),
  cursor: z.string().nullable(),
  limit: z.string().nullable(),
  recent: z.string().nullable(),
  afterSignalId: z.string().nullable(),
  aroundSignalId: z.string().nullable(),
  beforeCount: z.string().nullable(),
  afterCount: z.string().nullable(),
  fromProfileIds: z.array(z.string()),
  signalTypes: z.array(z.string()),
  hasLimit: z.boolean(),
});

type ListSignalsQueryRawValues = z.infer<typeof listSignalsQueryInputSchema>;

export function readListSignalsQueryRawValues(
  searchParams: URLSearchParams
): ListSignalsQueryRawValues {
  return {
    afterTs: searchParams.get("afterTs"),
    cursor: searchParams.get("cursor"),
    limit: searchParams.get("limit"),
    recent: searchParams.get("recent"),
    afterSignalId: searchParams.get("afterSignalId"),
    aroundSignalId: searchParams.get("aroundSignalId"),
    beforeCount: searchParams.get("beforeCount"),
    afterCount: searchParams.get("afterCount"),
    fromProfileIds: searchParams.getAll("fromProfileId"),
    signalTypes: searchParams.getAll("signalType"),
    hasLimit: searchParams.has("limit"),
  };
}

const parseOptionalNonNegativeInt = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  if (normalized === "") {
    return null;
  }

  if (!NON_NEGATIVE_INT_RE.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

const hasNonEmptyQueryValue = (value: string | null): boolean =>
  value !== null && value.trim() !== "";

/** `null` and `0` both map to default page size; other values are capped. */
const parseLimit = (parsed: number | null): number => {
  if (parsed === null || parsed === 0) {
    return CATCHUP_DEFAULT_LIMIT;
  }
  return Math.min(parsed, CATCHUP_MAX_LIMIT);
};

const normalizeCursor = (value: string | null): string | null => {
  const cursor = String(value ?? "").trim();
  return cursor.length > 0 ? cursor : null;
};

const normalizeIdentifier = (value: string | null): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const parseRecentQuery = (value: string | null): boolean => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true";
};

const normalizeUniqueStrings = (
  values: readonly string[]
): readonly string[] => {
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized.length > 0) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
};

const normalizeSignalTypes = (
  values: readonly string[]
): readonly ("signal.text" | "signal.status" | "signal.system_notice")[] => {
  const deduped = new Set<
    "signal.text" | "signal.status" | "signal.system_notice"
  >();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (SIGNAL_TYPE_SET.has(normalized)) {
      deduped.add(
        normalized as "signal.text" | "signal.status" | "signal.system_notice"
      );
    }
  }
  return [...deduped];
};

type ListSignalsQueryValidationState = {
  afterTs: number | null;
  parsedLimit: number | null;
  afterSignalId: string | null;
  aroundSignalId: string | null;
  beforeCount: number | null;
  afterCount: number | null;
  recentOnly: boolean;
  cursor: string | null;
};

const addQueryIssue = (
  ctx: z.core.$RefinementCtx<unknown>,
  path: string,
  message: string
): void => {
  ctx.addIssue({
    code: "custom",
    message,
    path: [path],
  });
};

const buildListSignalsQueryValidationState = (
  value: z.infer<typeof listSignalsQueryInputSchema>
): ListSignalsQueryValidationState => ({
  afterTs: parseOptionalNonNegativeInt(value.afterTs),
  parsedLimit: parseOptionalNonNegativeInt(value.limit),
  afterSignalId: normalizeIdentifier(value.afterSignalId),
  aroundSignalId: normalizeIdentifier(value.aroundSignalId),
  beforeCount: parseOptionalNonNegativeInt(value.beforeCount),
  afterCount: parseOptionalNonNegativeInt(value.afterCount),
  recentOnly: parseRecentQuery(value.recent),
  cursor: normalizeCursor(value.cursor),
});

export type ListSignalsReadQuerySemanticsInput = {
  recentOnly: boolean;
  hasExplicitLimit: boolean;
  limit: number | null;
  afterSignalId: string | null;
  aroundSignalId: string | null;
  beforeCount: number | null;
  afterCount: number | null;
};

export type ListSignalsReadQuerySemanticsIssue = {
  path:
    | "afterSignalId"
    | "aroundSignalId"
    | "beforeCount"
    | "afterCount"
    | "limit"
    | "recent";
  message: string;
};

export type ResolvedListSignalsReadQuerySemantics = {
  recentOnly: boolean;
  includeLimit: boolean;
  limit: number;
  afterSignalId: string | null;
  aroundSignalId: string | null;
  beforeCount: number | null;
  afterCount: number | null;
};

export function resolveListSignalsReadQuerySemantics(
  input: ListSignalsReadQuerySemanticsInput
):
  | {
      ok: true;
      value: ResolvedListSignalsReadQuerySemantics;
    }
  | {
      ok: false;
      issues: readonly ListSignalsReadQuerySemanticsIssue[];
    } {
  const issues: ListSignalsReadQuerySemanticsIssue[] = [];

  if (input.afterSignalId && input.aroundSignalId) {
    issues.push({
      path: "afterSignalId",
      message: "Cannot use both afterSignalId and aroundSignalId.",
    });
  }

  if (input.recentOnly && (input.afterSignalId || input.aroundSignalId)) {
    issues.push({
      path: "recent",
      message: "Recent history mode cannot be combined with signal anchors.",
    });
  }

  if (
    (input.beforeCount !== null || input.afterCount !== null) &&
    !input.aroundSignalId
  ) {
    issues.push({
      path: input.beforeCount === null ? "afterCount" : "beforeCount",
      message: "beforeCount and afterCount require aroundSignalId.",
    });
  }

  if (input.aroundSignalId && input.hasExplicitLimit) {
    issues.push({
      path: "aroundSignalId",
      message: "aroundSignalId cannot be combined with limit.",
    });
  }

  if (
    input.aroundSignalId &&
    (input.beforeCount ?? 0) <= 0 &&
    (input.afterCount ?? 0) <= 0
  ) {
    issues.push({
      path: "aroundSignalId",
      message: "aroundSignalId requires beforeCount > 0 or afterCount > 0.",
    });
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    value: {
      recentOnly: input.recentOnly,
      includeLimit: input.hasExplicitLimit,
      limit:
        input.afterSignalId && input.limit === 0 ? 0 : parseLimit(input.limit),
      afterSignalId: input.afterSignalId,
      aroundSignalId: input.aroundSignalId,
      beforeCount: input.beforeCount,
      afterCount: input.afterCount,
    },
  };
}

export function normalizeListSignalsReadQuerySemantics(
  input: ListSignalsReadQuerySemanticsInput
): ResolvedListSignalsReadQuerySemantics {
  const result = resolveListSignalsReadQuerySemantics(input);
  if (!result.ok) {
    throw new Error(result.issues[0]?.message ?? "Invalid list signals query.");
  }
  return result.value;
}

const validateListSignalsPrimitiveValues = (
  value: z.infer<typeof listSignalsQueryInputSchema>,
  state: ListSignalsQueryValidationState,
  ctx: z.core.$RefinementCtx<unknown>
): void => {
  if (
    hasNonEmptyQueryValue(value.afterTs) &&
    (state.afterTs === null || state.afterTs > MAX_DATE_TIMESTAMP_MS)
  ) {
    addQueryIssue(ctx, "afterTs", "Invalid afterTs");
  }
  if (hasNonEmptyQueryValue(value.limit) && state.parsedLimit === null) {
    addQueryIssue(ctx, "limit", "Invalid limit");
  }
  if (value.afterSignalId !== null && state.afterSignalId === null) {
    addQueryIssue(ctx, "afterSignalId", "Invalid afterSignalId");
  }
  if (value.aroundSignalId !== null && state.aroundSignalId === null) {
    addQueryIssue(ctx, "aroundSignalId", "Invalid aroundSignalId");
  }
  if (hasNonEmptyQueryValue(value.beforeCount) && state.beforeCount === null) {
    addQueryIssue(ctx, "beforeCount", "Invalid beforeCount");
  }
  if (hasNonEmptyQueryValue(value.afterCount) && state.afterCount === null) {
    addQueryIssue(ctx, "afterCount", "Invalid afterCount");
  }
};

const validateListSignalsSignalTypes = (
  signalTypes: readonly string[],
  ctx: z.core.$RefinementCtx<unknown>
): void => {
  for (const signalType of signalTypes) {
    const normalized = signalType.trim();
    if (normalized.length === 0 || !SIGNAL_TYPE_SET.has(normalized)) {
      addQueryIssue(ctx, "signalTypes", "Invalid signalType");
      break;
    }
  }
};

const validateListSignalsQueryCombinations = (
  value: z.infer<typeof listSignalsQueryInputSchema>,
  state: ListSignalsQueryValidationState,
  ctx: z.core.$RefinementCtx<unknown>
): void => {
  if (
    (state.afterSignalId || state.aroundSignalId) &&
    (state.afterTs !== null || state.cursor !== null)
  ) {
    addQueryIssue(
      ctx,
      state.afterSignalId ? "afterSignalId" : "aroundSignalId",
      "signal anchors cannot be combined with afterTs or cursor"
    );
  }

  const resolvedSemantics = resolveListSignalsReadQuerySemantics({
    recentOnly: state.recentOnly,
    hasExplicitLimit: value.hasLimit,
    limit: state.parsedLimit,
    afterSignalId: state.afterSignalId,
    aroundSignalId: state.aroundSignalId,
    beforeCount: state.beforeCount,
    afterCount: state.afterCount,
  });
  if (!resolvedSemantics.ok) {
    for (const issue of resolvedSemantics.issues) {
      addQueryIssue(ctx, issue.path, issue.message);
    }
  }
};

/**
 * Normalizes list-signals query into one execution shape.
 * `hasLimit` keeps cursor-response mode explicit even without cursor/afterTs.
 */
export const listSignalsQuerySchema = listSignalsQueryInputSchema
  .superRefine((value, ctx) => {
    const state = buildListSignalsQueryValidationState(value);
    validateListSignalsPrimitiveValues(value, state, ctx);
    validateListSignalsSignalTypes(value.signalTypes, ctx);
    validateListSignalsQueryCombinations(value, state, ctx);
  })
  .transform((value) => {
    const afterTs = parseOptionalNonNegativeInt(value.afterTs);
    const cursor = normalizeCursor(value.cursor);
    const afterSignalId = normalizeIdentifier(value.afterSignalId);
    const aroundSignalId = normalizeIdentifier(value.aroundSignalId);
    const parsedLimit = parseOptionalNonNegativeInt(value.limit);
    const recentOnly = parseRecentQuery(value.recent);
    const semantics = normalizeListSignalsReadQuerySemantics({
      recentOnly,
      hasExplicitLimit: value.hasLimit,
      limit: parsedLimit,
      afterSignalId,
      aroundSignalId,
      beforeCount: parseOptionalNonNegativeInt(value.beforeCount),
      afterCount: parseOptionalNonNegativeInt(value.afterCount),
    });
    const useCursorResponse =
      afterTs !== null || cursor !== null || value.hasLimit;

    return {
      afterTs,
      cursor,
      limit: semantics.limit,
      recentOnly: semantics.recentOnly,
      useCursorResponse,
      afterSignalId: semantics.afterSignalId,
      aroundSignalId: semantics.aroundSignalId,
      beforeCount: semantics.beforeCount,
      afterCount: semantics.afterCount,
      fromProfileIds: normalizeUniqueStrings(value.fromProfileIds),
      signalTypes: normalizeSignalTypes(value.signalTypes),
    };
  });
