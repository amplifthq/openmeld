import type { RuntimeTransportLease } from "@openmeld/schemas/types";

export const MIN_HEARTBEAT_INTERVAL_MS = 5000;
export const MAX_HEARTBEAT_INTERVAL_MS = 60_000;
export const ADAPTIVE_HEARTBEAT_GROWTH_FACTOR = 1.35;
export const ADAPTIVE_HEARTBEAT_JITTER_RATIO = 0.1;
export const CATALOG_SYNC_INTERVAL_MULTIPLIER = 3;
export const MIN_CATALOG_SYNC_INTERVAL_MS = 15_000;
export const MAX_CATALOG_SYNC_INTERVAL_MS = 45_000;

export function applyAcceptedLeases(input: {
  acceptedLeases: RuntimeTransportLease[];
  leasesByProfileId: Map<string, number>;
}): void {
  input.leasesByProfileId.clear();
  for (const lease of input.acceptedLeases) {
    input.leasesByProfileId.set(lease.profileId, lease.leaseEpoch);
  }
}

export function pruneStaleLeases(input: {
  leasesByProfileId: Map<string, number>;
  staleLeases: RuntimeTransportLease[];
}): void {
  for (const staleLease of input.staleLeases) {
    const current = input.leasesByProfileId.get(staleLease.profileId);
    if (current === staleLease.leaseEpoch) {
      input.leasesByProfileId.delete(staleLease.profileId);
    }
  }
}

export function resolveAdaptiveHeartbeatIntervalMs(input: {
  currentIntervalMs: number;
  growthFactor?: number;
  hasDispatchActivity: boolean;
}): number {
  if (input.hasDispatchActivity) {
    return MIN_HEARTBEAT_INTERVAL_MS;
  }
  const growthFactor =
    typeof input.growthFactor === "number" &&
    Number.isFinite(input.growthFactor)
      ? input.growthFactor
      : ADAPTIVE_HEARTBEAT_GROWTH_FACTOR;
  const nextIntervalMs = input.currentIntervalMs * growthFactor;
  return clampInteger(
    nextIntervalMs,
    MIN_HEARTBEAT_INTERVAL_MS,
    MAX_HEARTBEAT_INTERVAL_MS
  );
}

export function applyIntervalJitterMs(input: {
  baseIntervalMs: number;
  jitterRatio?: number;
  maxIntervalMs: number;
  minIntervalMs: number;
  randomValue?: number;
}): number {
  const jitterRatio =
    typeof input.jitterRatio === "number" && Number.isFinite(input.jitterRatio)
      ? Math.max(0, input.jitterRatio)
      : 0;
  const randomUnit =
    typeof input.randomValue === "number" && Number.isFinite(input.randomValue)
      ? Math.min(1, Math.max(0, input.randomValue))
      : Math.random();
  const jitterMultiplier = 1 + (randomUnit * 2 - 1) * jitterRatio;
  return clampInteger(
    input.baseIntervalMs * jitterMultiplier,
    input.minIntervalMs,
    input.maxIntervalMs
  );
}

export function resolveCatalogSyncIntervalMs(input: {
  heartbeatIntervalMs: number;
}): number {
  return clampInteger(
    input.heartbeatIntervalMs * CATALOG_SYNC_INTERVAL_MULTIPLIER,
    MIN_CATALOG_SYNC_INTERVAL_MS,
    MAX_CATALOG_SYNC_INTERVAL_MS
  );
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}
