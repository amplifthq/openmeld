import { describe, expect, it } from "vitest";
import {
  assertSameBindingFifo,
  buildIdempotencyKey,
  DATA_PLANE_DEFAULTS,
  hasRequiredObservabilityFields,
  shouldBypassDedupeForDeliveryRecoveryReason,
  shouldDedupeWithinWindow,
} from "../src/data-plane-contract";

describe("data-plane contract", () => {
  it("builds idempotency key with sourceEventId + targetProfileId", () => {
    const dedupeKey = buildIdempotencyKey({
      sourceEventId: "evt-42",
      targetProfileId: "agt_codex",
    });

    expect(dedupeKey).toBe("6:evt-42|9:agt_codex");
  });

  it("dedupes within the default 24h window", () => {
    const nowMs = Date.UTC(2026, 1, 25, 12, 0, 0);
    const firstSeenAtMs = nowMs - 60_000;
    expect(shouldDedupeWithinWindow({ firstSeenAtMs, nowMs })).toBe(true);
  });

  it("bypasses dedupe only for delivery recovery reasons that represent replay-safe recovery", () => {
    expect(
      shouldBypassDedupeForDeliveryRecoveryReason("connection_replaced")
    ).toBe(true);
    expect(shouldBypassDedupeForDeliveryRecoveryReason("route_lost")).toBe(
      true
    );
    expect(shouldBypassDedupeForDeliveryRecoveryReason(null)).toBe(false);
    expect(shouldBypassDedupeForDeliveryRecoveryReason(undefined)).toBe(false);
  });

  it("keeps same-binding dispatch in FIFO order", () => {
    const inOrder = [
      { bindingKey: "space-1|agent-a", sequence: 1 },
      { bindingKey: "space-2|agent-a", sequence: 1 },
      { bindingKey: "space-1|agent-a", sequence: 2 },
      { bindingKey: "space-2|agent-a", sequence: 2 },
    ];
    expect(assertSameBindingFifo(inOrder)).toBe(true);

    const outOfOrder = [
      { bindingKey: "space-1|agent-a", sequence: 2 },
      { bindingKey: "space-1|agent-a", sequence: 1 },
    ];
    expect(assertSameBindingFifo(outOfOrder)).toBe(false);
  });

  it("checks required observability fields", () => {
    const validEntry = {
      ts: "2026-02-25T12:00:00.000Z",
      level: "info",
      component: "openMeldDaemon",
      code: "task.completed",
      message: "completed",
      runId: "run-1",
      bindingKey: "space-1|agent-a",
      taskId: "task-1",
      eventId: "evt-1",
      errorType: "internal",
    };
    expect(hasRequiredObservabilityFields(validEntry)).toBe(true);

    const invalidEntry = {
      ...validEntry,
      taskId: undefined,
    };
    expect(hasRequiredObservabilityFields(invalidEntry)).toBe(false);
  });

  it("freezes default timeout/backoff/concurrency/queue constants", () => {
    expect(DATA_PLANE_DEFAULTS.timeoutMs).toBeNull();
    expect(DATA_PLANE_DEFAULTS.globalConcurrency).toBe(4);
    expect(DATA_PLANE_DEFAULTS.perBindingQueue).toBe(32);
    expect(DATA_PLANE_DEFAULTS.backoffMs).toEqual([
      1000, 2000, 5000, 10_000, 30_000,
    ]);
  });
});
