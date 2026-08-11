import { describe, expect, it } from "vitest";
import {
  buildRouteCatalogReconciliationMissingKey,
  nextRouteCatalogReconciliationBackoffLevel,
  ROUTE_CATALOG_RECONCILIATION_SIGNAL_MAX_BACKOFF_LEVEL,
  ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS,
  ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MS,
  resolveRouteCatalogReconciliationThrottleMs,
} from "../src/runtime-transport/application/runtime-transport-reconciliation-throttle";

describe("buildRouteCatalogReconciliationMissingKey", () => {
  it("is order-invariant: the same set in any order yields the same key", () => {
    const a = buildRouteCatalogReconciliationMissingKey([
      "agt-c",
      "agt-a",
      "agt-b",
    ]);
    const b = buildRouteCatalogReconciliationMissingKey([
      "agt-a",
      "agt-b",
      "agt-c",
    ]);
    expect(a).toBe(b);
  });

  it("distinguishes genuinely different sets", () => {
    const a = buildRouteCatalogReconciliationMissingKey(["agt-a", "agt-b"]);
    const b = buildRouteCatalogReconciliationMissingKey(["agt-a", "agt-c"]);
    expect(a).not.toBe(b);
  });

  it("does not mutate the caller's array", () => {
    const input = ["agt-c", "agt-a", "agt-b"];
    buildRouteCatalogReconciliationMissingKey(input);
    expect(input).toEqual(["agt-c", "agt-a", "agt-b"]);
  });

  it("keeps the backoff stepping up when the same set arrives in a different order", () => {
    // Simulate two reconciliation rounds where the upstream query returned the
    // same missing profiles in a shuffled order. The backoff must NOT reset.
    const round1Key = buildRouteCatalogReconciliationMissingKey([
      "agt-a",
      "agt-b",
      "agt-c",
    ]);
    const round2Key = buildRouteCatalogReconciliationMissingKey([
      "agt-c",
      "agt-b",
      "agt-a",
    ]);
    expect(round2Key).toBe(round1Key);
    const level = nextRouteCatalogReconciliationBackoffLevel({
      missingProfileIdsKey: round2Key,
      previousBackoffLevel: 1,
      previousMissingProfileIdsKey: round1Key,
    });
    expect(level).toBe(2);
  });
});

describe("resolveRouteCatalogReconciliationThrottleMs", () => {
  it("returns the base window at backoff level 0", () => {
    expect(resolveRouteCatalogReconciliationThrottleMs(0)).toBe(
      ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MS
    );
  });

  it("doubles the window per backoff level", () => {
    expect(resolveRouteCatalogReconciliationThrottleMs(1)).toBe(60_000);
    expect(resolveRouteCatalogReconciliationThrottleMs(2)).toBe(120_000);
    expect(resolveRouteCatalogReconciliationThrottleMs(3)).toBe(240_000);
  });

  it("caps at the max window and never grows past it", () => {
    expect(resolveRouteCatalogReconciliationThrottleMs(3)).toBe(
      ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS
    );
    expect(resolveRouteCatalogReconciliationThrottleMs(4)).toBe(
      ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS
    );
    expect(resolveRouteCatalogReconciliationThrottleMs(99)).toBe(
      ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS
    );
  });

  it("treats invalid levels as the base window (fail toward retrying sooner)", () => {
    expect(resolveRouteCatalogReconciliationThrottleMs(-1)).toBe(
      ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MS
    );
    expect(resolveRouteCatalogReconciliationThrottleMs(Number.NaN)).toBe(
      ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MS
    );
  });
});

describe("nextRouteCatalogReconciliationBackoffLevel", () => {
  it("starts at 0 when there is no prior signal", () => {
    expect(
      nextRouteCatalogReconciliationBackoffLevel({
        missingProfileIdsKey: "agt-a\0agt-b",
        previousBackoffLevel: null,
        previousMissingProfileIdsKey: null,
      })
    ).toBe(0);
  });

  it("steps up while the same missing set keeps re-firing", () => {
    expect(
      nextRouteCatalogReconciliationBackoffLevel({
        missingProfileIdsKey: "agt-a",
        previousBackoffLevel: 0,
        previousMissingProfileIdsKey: "agt-a",
      })
    ).toBe(1);
    expect(
      nextRouteCatalogReconciliationBackoffLevel({
        missingProfileIdsKey: "agt-a",
        previousBackoffLevel: 1,
        previousMissingProfileIdsKey: "agt-a",
      })
    ).toBe(2);
  });

  it("resets to 0 the instant the missing set changes", () => {
    expect(
      nextRouteCatalogReconciliationBackoffLevel({
        missingProfileIdsKey: "agt-a\0agt-c",
        previousBackoffLevel: 3,
        previousMissingProfileIdsKey: "agt-a",
      })
    ).toBe(0);
  });

  it("caps the backoff level so the window never runs away", () => {
    expect(
      nextRouteCatalogReconciliationBackoffLevel({
        missingProfileIdsKey: "agt-a",
        previousBackoffLevel:
          ROUTE_CATALOG_RECONCILIATION_SIGNAL_MAX_BACKOFF_LEVEL,
        previousMissingProfileIdsKey: "agt-a",
      })
    ).toBe(ROUTE_CATALOG_RECONCILIATION_SIGNAL_MAX_BACKOFF_LEVEL);
  });
});
