// Adaptive throttle policy for route-catalog reconciliation signals.
//
// A daemon session that keeps reporting the same missing route set (its report
// fingerprint churns as it re-registers, but those profiles never get a fresh
// lease) would otherwise re-emit a reconciliation nudge — and the readiness
// invalidation that rides with it — every base window forever. That reheats
// the readiness broadcast storm on a stuck binding.
//
// Instead the interval backs off exponentially while the missing set is stable,
// and resets to the base window the instant the missing set changes so a
// genuinely new gap is still retried promptly. The policy is pure so it can be
// unit-tested without a Durable Object; the hub owns only the timing state.

export const ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MS = 30_000;
export const ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS = 240_000;
export const ROUTE_CATALOG_RECONCILIATION_SIGNAL_MAX_BACKOFF_LEVEL = 3;

export function resolveRouteCatalogReconciliationThrottleMs(
  backoffLevel: number
): number {
  const level = clampBackoffLevel(backoffLevel);
  return Math.min(
    ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MS * 2 ** level,
    ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS
  );
}

export function nextRouteCatalogReconciliationBackoffLevel(input: {
  missingProfileIdsKey: string;
  previousBackoffLevel: number | null;
  previousMissingProfileIdsKey: string | null;
}): number {
  if (
    input.previousMissingProfileIdsKey === null ||
    input.previousMissingProfileIdsKey !== input.missingProfileIdsKey
  ) {
    return 0;
  }
  return clampBackoffLevel((input.previousBackoffLevel ?? 0) + 1);
}

// The backoff state keys off string-equality of the missing set across
// reconciliation rounds, so the key must depend only on WHICH profiles are
// missing, not the order the upstream query returned them in. The D1 read
// currently sorts by agent_profile_id, but that ordering is an upstream
// coincidence this policy must not silently depend on — an unsorted key would
// reset the backoff (reheating the storm) the moment row order shifted. Sort
// so the key is order-invariant.
export function buildRouteCatalogReconciliationMissingKey(
  missingProfileIds: readonly string[]
): string {
  return [...missingProfileIds].sort().join("\0");
}

function clampBackoffLevel(backoffLevel: number): number {
  if (!Number.isFinite(backoffLevel) || backoffLevel <= 0) {
    return 0;
  }
  return Math.min(
    Math.trunc(backoffLevel),
    ROUTE_CATALOG_RECONCILIATION_SIGNAL_MAX_BACKOFF_LEVEL
  );
}
