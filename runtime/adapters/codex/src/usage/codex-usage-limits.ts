import { createHash } from "node:crypto";
import {
  type AdapterProviderUsageAdmission,
  type AdapterProviderUsageLimit,
  createUnavailableProviderUsageLimits,
} from "@openmeld/adapter-core";

const DEFAULT_LIMIT_ID = "codex";
const MAX_LIMIT_ID_LENGTH = 160;
const MAX_LIMIT_LABEL_LENGTH = 160;
const SECONDS_PER_MILLISECOND = 1000;

type CodexRateLimitBucket = {
  bucketKey: string;
  snapshot: Record<string, unknown>;
};

export async function readCodexAccountUsageObservation(input: {
  readAccountEpoch: () => number;
  request: (method: string, params: unknown) => Promise<unknown>;
}) {
  const epoch = input.readAccountEpoch();
  const before = toRecord(await input.request("account/rateLimits/read", null));
  const accountResponse = await input.request("account/read", {});
  const after = toRecord(await input.request("account/rateLimits/read", null));
  const observedAt = new Date().toISOString();
  const accountId =
    typeof before?.accountId === "string" ? before.accountId.trim() : null;
  const account = toRecord(toRecord(accountResponse)?.account);
  const sameAccount = Boolean(
    accountId &&
      after?.accountId === accountId &&
      account?.type === "chatgpt" &&
      input.readAccountEpoch() === epoch
  );
  return {
    accountEpoch: epoch,
    accountResponse,
    accountKey:
      sameAccount && accountId
        ? `codex:${createHash("sha256").update(accountId).digest("hex")}`
        : null,
    usageObservation: projectCodexUsageObservation({
      observedAt,
      response: sameAccount ? after : null,
      source: "account_read",
    }),
  };
}

export function projectCodexUsageObservation(input: {
  observedAt: string;
  response: unknown;
  source: "account_read" | "rolling_update";
}): {
  usageAdmission?: AdapterProviderUsageAdmission;
  usageLimits: AdapterProviderUsageLimit[];
} {
  const blocksNewWork = readAccountAdmission(input.response);
  return {
    // Native rolling notifications are sparse: omitted/null account metadata
    // does not clear an earlier snapshot or refresh its observation time.
    ...(input.source === "account_read" || blocksNewWork !== null
      ? { usageAdmission: { blocksNewWork, observedAt: input.observedAt } }
      : {}),
    usageLimits: projectUsageLimits(input),
  };
}

function readAccountAdmission(response: unknown): boolean | null {
  const record = toRecord(response);
  // The native response validates ordinaryUsageAllowed against the active
  // account. Its backward-compatible snapshot carries account credits and
  // spend control; unrelated metered buckets must not veto that account fact.
  const snapshot = toRecord(record?.rateLimits);
  if (snapshot?.spendControlReached === true) {
    return true;
  }
  if (snapshot?.spendControlReached !== false) {
    return null;
  }
  if (record?.ordinaryUsageAllowed === true) {
    return false;
  }
  if (record?.ordinaryUsageAllowed !== false) {
    return null;
  }
  const credits = toRecord(snapshot.credits);
  if (credits?.unlimited === true) {
    return false;
  }
  if (credits?.unlimited !== false || typeof credits.hasCredits !== "boolean") {
    return null;
  }
  const balance =
    typeof credits.balance === "string" && credits.balance.trim()
      ? Number(credits.balance)
      : null;
  if (balance !== null && Number.isFinite(balance) && balance >= 0) {
    if (balance > 0) {
      return credits.hasCredits ? false : null;
    }
    return credits.hasCredits === false ? true : null;
  }
  return credits.hasCredits === false && credits.balance === null ? true : null;
}

function projectUsageLimits(input: {
  observedAt: string;
  response: unknown;
}): AdapterProviderUsageLimit[] {
  const buckets = readRateLimitBuckets(input.response);
  const limits = buckets.flatMap((bucket) =>
    projectRateLimitBucket({ ...bucket, observedAt: input.observedAt })
  );
  if (limits.length === 0) {
    return createUnavailableProviderUsageLimits(input.observedAt);
  }

  const uniqueLimits = new Map<string, AdapterProviderUsageLimit>();
  for (const limit of limits) {
    if (!uniqueLimits.has(limit.key)) {
      uniqueLimits.set(limit.key, limit);
    }
  }
  return [...uniqueLimits.values()];
}

function readRateLimitBuckets(response: unknown): CodexRateLimitBucket[] {
  const record = toRecord(response);
  const bucketsById = toRecord(record?.rateLimitsByLimitId);
  if (bucketsById && Object.keys(bucketsById).length > 0) {
    return Object.entries(bucketsById).flatMap(([bucketKey, snapshot]) => {
      const recordSnapshot = toRecord(snapshot);
      return recordSnapshot ? [{ bucketKey, snapshot: recordSnapshot }] : [];
    });
  }

  const legacySnapshot = toRecord(record?.rateLimits);
  return legacySnapshot
    ? [{ bucketKey: DEFAULT_LIMIT_ID, snapshot: legacySnapshot }]
    : [];
}

function projectRateLimitBucket(
  input: CodexRateLimitBucket & {
    observedAt: string;
  }
): AdapterProviderUsageLimit[] {
  const limitId = resolveLimitId(input);
  const limitName = normalizeLabel(input.snapshot.limitName);
  return (["primary", "secondary"] as const).flatMap((windowKind) => {
    const window = toRecord(input.snapshot[windowKind]);
    const usedPercent = normalizeUsedPercent(window?.usedPercent);
    if (usedPercent === null) {
      return [];
    }

    const windowDurationMins = normalizePositiveInteger(
      window?.windowDurationMins
    );
    const windowLabel = formatWindowLabel({
      windowDurationMins,
      windowKind,
    });
    return [
      {
        key: `${limitId}:${windowKind}`,
        label: limitName
          ? `${limitName} ${windowLabel.toLocaleLowerCase("en-US")}`
          : windowLabel,
        observedAt: input.observedAt,
        resetsAt: normalizeResetTime(window?.resetsAt),
        status: usedPercent >= 100 ? "exhausted" : "available",
        usedPercent,
      } satisfies AdapterProviderUsageLimit,
    ];
  });
}

function resolveLimitId(input: CodexRateLimitBucket): string {
  const providerLimitId = normalizeLimitId(input.snapshot.limitId);
  const bucketLimitId = normalizeLimitId(input.bucketKey);
  return providerLimitId ?? bucketLimitId ?? DEFAULT_LIMIT_ID;
}

function normalizeLimitId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_LIMIT_ID_LENGTH);
  return normalized || null;
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized ? normalized.slice(0, MAX_LIMIT_LABEL_LENGTH) : null;
}

function normalizeUsedPercent(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function normalizeResetTime(value: unknown): string | null {
  const unixSeconds = normalizePositiveInteger(value);
  if (unixSeconds === null) {
    return null;
  }
  const date = new Date(unixSeconds * SECONDS_PER_MILLISECOND);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatWindowLabel(input: {
  windowDurationMins: number | null;
  windowKind: "primary" | "secondary";
}): string {
  if (input.windowDurationMins === 60) {
    return "Hourly usage";
  }
  if (input.windowDurationMins === 300) {
    return "5-hour usage";
  }
  if (input.windowDurationMins === 24 * 60) {
    return "Daily usage";
  }
  if (input.windowDurationMins === 7 * 24 * 60) {
    return "Weekly usage";
  }
  return input.windowKind === "primary"
    ? "Short-term usage"
    : "Long-term usage";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
