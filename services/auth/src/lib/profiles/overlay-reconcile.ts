import type { ProfileSpaceHistoryRecord } from "@openmeld/auth/server";
import type { AuthBindings } from "../bindings";

// Bound per sweep. The reconcile is a best-effort safety net layered on top of
// the write-time overlay projection path, not the primary interactive path, so
// a recent-active window is enough to self-heal pins/joins that degraded during
// a transient Auth→Core window. The historical long tail is covered by the
// one-shot operational backfill. Kept small to stay well under the Workers
// subrequest budget for a single scheduled invocation.
const OVERLAY_RECONCILE_DEFAULT_LIMIT = 300;

type CoreOverlayWorker = NonNullable<AuthBindings["OPENMELD_CORE_WORKER"]>;

export type SpaceIndexOverlayReconcileSummary = {
  scanned: number;
  emitted: number;
  skipped: number;
};

export type SpaceIndexOverlayProjectionResult = {
  repairAttempted: boolean;
  status: "applied" | "degraded" | "pending";
  updated: boolean;
};

// Single source of truth for the Auth→Core overlay projection payload, shared
// by the per-write onHistoryWritten hook (service.ts) and the periodic
// reconcile below so the two paths can never drift.
export function toSpaceIndexOverlayProjectionInput(
  record: ProfileSpaceHistoryRecord
) {
  return {
    active: record.status === "active",
    gatewayHost: record.gatewayHost,
    lastJoinedAtMs: record.lastJoinedAt?.getTime() ?? null,
    lastSeenTs: record.lastSeenTs ?? null,
    pinnedAtMs: record.pinnedAt?.getTime() ?? null,
    profileId: record.profileId,
    spaceId: record.spaceId,
    updatedAtMs: record.updatedAt?.getTime() ?? null,
  };
}

export async function projectSpaceIndexMembershipOverlay(input: {
  coreWorker: CoreOverlayWorker | undefined;
  record: ProfileSpaceHistoryRecord;
}): Promise<SpaceIndexOverlayProjectionResult> {
  if (!input.coreWorker) {
    return { repairAttempted: false, status: "degraded", updated: false };
  }

  try {
    const result = await input.coreWorker.projectSpaceIndexMembershipOverlay(
      toSpaceIndexOverlayProjectionInput(input.record)
    );
    return normalizeSpaceIndexOverlayProjectionResult(result);
  } catch {
    return { repairAttempted: false, status: "degraded", updated: false };
  }
}

function normalizeSpaceIndexOverlayProjectionResult(
  result: unknown
): SpaceIndexOverlayProjectionResult {
  const candidate = result as {
    repairAttempted?: unknown;
    status?: unknown;
    updated?: unknown;
  };
  if (
    candidate.status === "applied" ||
    candidate.status === "degraded" ||
    candidate.status === "pending"
  ) {
    return {
      repairAttempted: candidate.repairAttempted === true,
      status: candidate.status,
      updated: candidate.updated === true,
    };
  }

  // Deployment skew bridge: older Core workers returned only { updated }.
  // Preserve the meaning without claiming a repair was attempted.
  if (typeof candidate.updated === "boolean") {
    return {
      repairAttempted: false,
      status: candidate.updated ? "applied" : "pending",
      updated: candidate.updated,
    };
  }

  return { repairAttempted: false, status: "degraded", updated: false };
}

// Pure and testable: re-announces each history row's overlay to Core. Mirrors
// the per-write onHistoryWritten hook, but driven periodically so a dropped or
// failed announcement (a broken Auth→Core binding window, projection lag, a
// transient RPC error) self-heals on the next sweep instead of staying stale
// permanently (physical-db-split.md D7). The Space Index stays a rebuildable
// projection of its source — see data-and-observability.md.
export async function reconcileSpaceIndexMembershipOverlays(input: {
  coreWorker: CoreOverlayWorker | undefined;
  rows: readonly ProfileSpaceHistoryRecord[];
}): Promise<SpaceIndexOverlayReconcileSummary> {
  const { coreWorker, rows } = input;
  if (!coreWorker) {
    return { scanned: rows.length, emitted: 0, skipped: rows.length };
  }

  const results = await Promise.all(
    rows.map((record) =>
      projectSpaceIndexMembershipOverlay({
        coreWorker,
        record,
      })
    )
  );
  const emitted = results.filter(
    (result) => result.status === "applied" || result.status === "pending"
  ).length;
  return {
    scanned: rows.length,
    emitted,
    skipped: rows.length - emitted,
  };
}

// I/O wrapper for the scheduled handler: lists the bounded active-history set
// from the Profile-owned source table and reconciles it onto the Core overlay.
// Best-effort and idempotent; never throws into the cron. The Profile-domain
// server barrel is loaded dynamically so the pure helpers above stay importable
// in unit tests without pulling the worker-only auth runtime.
export async function runSpaceIndexMembershipOverlayReconcile(
  env: AuthBindings,
  options?: { limit?: number }
): Promise<SpaceIndexOverlayReconcileSummary> {
  const limit = options?.limit ?? OVERLAY_RECONCILE_DEFAULT_LIMIT;

  if (!env.OPENMELD_CORE_WORKER) {
    // Expose the missing binding as evidence rather than silently doing
    // nothing (data-and-observability.md: do not hide projection staleness).
    console.warn({
      event: "auth.space_index_overlay.reconcile_skipped_no_core_binding",
    });
    return { scanned: 0, emitted: 0, skipped: 0 };
  }

  const { createD1Db, listActiveProfileSpaceHistoryForOverlayReconcile } =
    await import("@openmeld/auth/server");
  const db = createD1Db(env.OPENMELD_DB);
  const rows = await listActiveProfileSpaceHistoryForOverlayReconcile(
    db,
    limit
  );
  const summary = await reconcileSpaceIndexMembershipOverlays({
    coreWorker: env.OPENMELD_CORE_WORKER,
    rows,
  });
  console.info({
    event: "auth.space_index_overlay.reconcile_completed",
    emitted: summary.emitted,
    scanned: summary.scanned,
    skipped: summary.skipped,
  });
  return summary;
}
