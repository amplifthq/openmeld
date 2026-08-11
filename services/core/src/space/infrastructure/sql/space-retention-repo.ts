// Durable Objects (SQLite-backed) support up to 10 GB per object.
// Source: https://developers.cloudflare.com/durable-objects/platform/limits/
// We keep a safety buffer below the hard limit to reduce SQLITE_FULL risk during writes.
// soft limit: 9 GiB (~9.66 GB decimal), cleanup target: 8.5 GiB (~9.13 GB decimal).
export const SOFT_LIMIT_BYTES = 9 * 1024 * 1024 * 1024;
export const TARGET_BYTES = 8.5 * 1024 * 1024 * 1024;
export const RETENTION_DELETE_BATCH_ROWS = 100;
export const MAX_CLEANUP_BATCHES_PER_REQUEST = 5;
export const POST_CLEANUP_DEBOUNCE_MS = 3000;

type RetentionBudget = {
  remainingCleanupBatches: number;
};

type CleanupPhase = "pre" | "post" | "emergency";

type CleanupResult = {
  phase: CleanupPhase;
  batchesUsed: number;
  rowsDeleted: number;
  sizeBefore: number;
  sizeAfter: number;
  budgetExhausted: boolean;
  stillAboveSoftLimit: boolean;
};

type RetentionDebtInfo = {
  databaseSizeBytes: number;
  softLimitBytes: number;
  targetBytes: number;
  reason: "budget_exhausted_still_over_soft";
};

export type PersistSignalWithRetentionInput = {
  insertSignal: () => void;
  deleteOldestSignalsBatch: (limit: number) => number;
  readDatabaseSizeBytes: () => number;
  nowMs: number;
  lastPostCleanupAtMs: number;
  setLastPostCleanupAtMs: (timestampMs: number) => void;
  onPostCleanupFailure?: (error: unknown) => void;
  onRetentionDebt?: (info: RetentionDebtInfo) => void;
};

export type PersistSignalWithRetentionResult = {
  preCleanup: CleanupResult | null;
  postCleanup: CleanupResult | null;
  emergencyCleanup: CleanupResult | null;
  capacityRetryAttempted: boolean;
  retentionDebtReported: boolean;
  finalDatabaseSizeBytes: number;
};

export const persistSignalWithRetention = (
  input: PersistSignalWithRetentionInput
): PersistSignalWithRetentionResult => {
  const budget: RetentionBudget = {
    remainingCleanupBatches: MAX_CLEANUP_BATCHES_PER_REQUEST,
  };

  const preCleanup = runCleanupPhase({
    phase: "pre",
    budget,
    readDatabaseSizeBytes: input.readDatabaseSizeBytes,
    deleteOldestSignalsBatch: input.deleteOldestSignalsBatch,
    maxBatches: budget.remainingCleanupBatches,
    requiredStartBytes: SOFT_LIMIT_BYTES,
    targetBytes: TARGET_BYTES,
  });

  let retentionDebtReported = false;

  let emergencyCleanup: CleanupResult | null = null;
  let capacityRetryAttempted = false;

  try {
    input.insertSignal();
  } catch (error) {
    if (!isCapacityError(error)) {
      throw error;
    }

    capacityRetryAttempted = true;
    emergencyCleanup = runCleanupPhase({
      phase: "emergency",
      budget,
      readDatabaseSizeBytes: input.readDatabaseSizeBytes,
      deleteOldestSignalsBatch: input.deleteOldestSignalsBatch,
      maxBatches: 1,
      requiredStartBytes: 0,
      targetBytes: TARGET_BYTES,
      forceFirstBatch: true,
      bypassBudget: true,
    });
    input.insertSignal();
  }

  let postCleanup: CleanupResult | null = null;
  if (
    input.readDatabaseSizeBytes() >= SOFT_LIMIT_BYTES &&
    shouldRunPostCleanup({
      nowMs: input.nowMs,
      lastPostCleanupAtMs: input.lastPostCleanupAtMs,
    })
  ) {
    input.setLastPostCleanupAtMs(input.nowMs);
    try {
      postCleanup = runCleanupPhase({
        phase: "post",
        budget,
        readDatabaseSizeBytes: input.readDatabaseSizeBytes,
        deleteOldestSignalsBatch: input.deleteOldestSignalsBatch,
        maxBatches: 1,
        requiredStartBytes: SOFT_LIMIT_BYTES,
        targetBytes: TARGET_BYTES,
      });
    } catch (error) {
      input.onPostCleanupFailure?.(error);
    }
  }

  const finalDatabaseSizeBytes = input.readDatabaseSizeBytes();
  const shouldReportRetentionDebt =
    budget.remainingCleanupBatches === 0 &&
    finalDatabaseSizeBytes >= SOFT_LIMIT_BYTES;
  if (shouldReportRetentionDebt) {
    input.onRetentionDebt?.({
      databaseSizeBytes: finalDatabaseSizeBytes,
      softLimitBytes: SOFT_LIMIT_BYTES,
      targetBytes: TARGET_BYTES,
      reason: "budget_exhausted_still_over_soft",
    });
    retentionDebtReported = true;
  }

  return {
    preCleanup,
    postCleanup,
    emergencyCleanup,
    capacityRetryAttempted,
    retentionDebtReported,
    finalDatabaseSizeBytes,
  };
};

export const isCapacityError = (error: unknown): boolean => {
  const message = extractCapacityErrorText(error);
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("sqlite_full") ||
    normalized.includes("database or disk is full") ||
    normalized.includes("no space left") ||
    normalized.includes("enospc") ||
    normalized.includes("quota exceeded")
  );
};

function runCleanupPhase(input: {
  phase: CleanupPhase;
  budget: RetentionBudget;
  readDatabaseSizeBytes: () => number;
  deleteOldestSignalsBatch: (limit: number) => number;
  maxBatches: number;
  requiredStartBytes: number;
  targetBytes: number;
  forceFirstBatch?: boolean;
  bypassBudget?: boolean;
}): CleanupResult | null {
  const sizeBefore = input.readDatabaseSizeBytes();
  if (
    sizeBefore < input.requiredStartBytes ||
    input.maxBatches <= 0 ||
    (!input.bypassBudget && input.budget.remainingCleanupBatches <= 0)
  ) {
    return null;
  }

  let batchesUsed = 0;
  let rowsDeleted = 0;

  while (
    batchesUsed < input.maxBatches &&
    (input.bypassBudget || input.budget.remainingCleanupBatches > 0) &&
    (input.readDatabaseSizeBytes() >= input.targetBytes ||
      (input.forceFirstBatch === true && batchesUsed === 0))
  ) {
    const deleted = input.deleteOldestSignalsBatch(RETENTION_DELETE_BATCH_ROWS);
    batchesUsed += 1;
    if (!input.bypassBudget) {
      input.budget.remainingCleanupBatches -= 1;
    }
    rowsDeleted += deleted;
    if (deleted === 0) {
      break;
    }
  }

  const sizeAfter = input.readDatabaseSizeBytes();
  return {
    phase: input.phase,
    batchesUsed,
    rowsDeleted,
    sizeBefore,
    sizeAfter,
    budgetExhausted:
      input.budget.remainingCleanupBatches === 0 &&
      sizeAfter >= SOFT_LIMIT_BYTES,
    stillAboveSoftLimit: sizeAfter >= SOFT_LIMIT_BYTES,
  };
}

function shouldRunPostCleanup(input: {
  nowMs: number;
  lastPostCleanupAtMs: number;
}): boolean {
  return input.nowMs - input.lastPostCleanupAtMs >= POST_CLEANUP_DEBOUNCE_MS;
}

function extractCapacityErrorText(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage = extractCauseMessage(error.cause);
    return `${error.message} ${causeMessage}`.trim();
  }
  return String(error ?? "");
}

function extractCauseMessage(cause: unknown): string {
  if (!cause || typeof cause !== "object") {
    return "";
  }
  if ("message" in cause) {
    return String((cause as { message?: unknown }).message ?? "");
  }
  return "";
}
