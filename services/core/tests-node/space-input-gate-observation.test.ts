import { afterEach, expect, it, vi } from "vitest";
import { SpaceInputGateObservation } from "../src/space/transport/do/space-input-gate-observation";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("records the pending operations before reset and distinguishes pool cleanup from message delivery", async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const gate = new SpaceInputGateObservation(
    "object",
    "post_idempotent_signal",
    "parent"
  );
  gate.watchMessage("client", "request");
  gate.stored("unrelated-signal", "different-client");
  const deliver = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const failure = new Error("cleanup failed");
  const observed = gate.observe(async () => {
    await gate.during("live_delivery", () => deliver.promise);
    gate.cleaningUp();
    return await cleanup.promise;
  });
  const rejected = expect(observed).rejects.toBe(failure);
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(warn).toHaveBeenCalledWith(
      "[core.space.input_gate]",
      expect.objectContaining({
        gateId: gate.id,
        parentGateId: "parent",
        durableObjectId: "object",
        requestId: "request",
        operation: "post_idempotent_signal",
        phase: "callback",
        status: "pending",
        pendingStages: { live_delivery: 1 },
        persistedSignalId: undefined,
      })
    );
    gate.stored("committed-signal", "client");
    deliver.resolve();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(warn).toHaveBeenLastCalledWith(
      "[core.space.input_gate]",
      expect.objectContaining({
        gateId: gate.id,
        phase: "postgres_cleanup",
        status: "pending",
        pendingStages: {},
        persistedSignalId: "committed-signal",
      })
    );
  } finally {
    deliver.resolve();
    cleanup.reject(failure);
    await rejected;
  }
  expect(gate.active).toBe(false);
  expect(warn).toHaveBeenLastCalledWith(
    "[core.space.input_gate]",
    expect.objectContaining({
      gateId: gate.id,
      status: "failed",
    })
  );
});

it("leaves a fast gate quiet after its callback has returned", async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const gate = new SpaceInputGateObservation("object", "constructor");
  await expect(gate.observe(() => Promise.resolve(42))).resolves.toBe(42);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(warn).not.toHaveBeenCalled();
});
