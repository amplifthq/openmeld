import type { LocalComponentsStatus } from "@openmeld/schemas/types";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createServiceLocalComponentsObservation } from "../src/local-service/carrier/service-local-components-observation";

describe("Service-lifetime component inspection", () => {
  it("keeps one unfinished inspection through repeated reconnects and only notifies the current connection", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const missing = vi.fn();
    let complete: (value: LocalComponentsStatus | null) => void = () =>
      undefined;
    const pending = new Promise<LocalComponentsStatus | null>((resolve) => {
      complete = resolve;
    });
    const inspect = vi.fn(() => pending);
    const observation = createServiceLocalComponentsObservation({
      inspect,
      onError: vi.fn(),
    });
    const callbacks = Array.from({ length: 20 }, () => vi.fn());
    for (const callback of callbacks) {
      expect(observation.read(callback, missing)).toBeNull();
    }
    expect(missing.mock.calls[0]?.[0]).toMatchObject({
      reason: "first_inspection",
      observationAgeMs: null,
    });
    expect(missing.mock.lastCall?.[0]).toMatchObject({
      reason: "inspection_pending",
      inspectionAgeMs: 0,
    });
    expect(inspect).toHaveBeenCalledOnce();
    complete(null);
    await pending;
    expect(
      callbacks
        .slice(0, -1)
        .every((callback) => callback.mock.calls.length === 0)
    ).toBe(true);
    expect(callbacks.at(-1)).toHaveBeenCalledOnce();
    expect(observation.read(vi.fn(), missing)).toBeNull();
    expect(missing.mock.lastCall?.[0]).toMatchObject({
      reason: "empty_result",
    });
    vi.advanceTimersByTime(30_000);
    expect(observation.read(vi.fn(), missing)).toBeNull();
    expect(missing.mock.lastCall?.[0]).toMatchObject({
      reason: "observation_expired",
      observationAgeMs: 30_000,
    });
    observation.dispose();
  });

  it("does not let failed or disposed optional inspection interrupt the carrier", async () => {
    const failure = new Error("inspection unavailable");
    const onError = vi.fn();
    const missing = vi.fn();
    const inspect = vi.fn(() => Promise.reject(failure));
    const observation = createServiceLocalComponentsObservation({
      inspect,
      onError,
    });
    expect(observation.read(vi.fn())).toBeNull();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(observation.read(vi.fn(), missing)).toBeNull();
    expect(missing).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "inspection_failed" })
    );
    expect(inspect).toHaveBeenCalledOnce();
    observation.dispose();
    expect(observation.read(vi.fn())).toBeNull();
  });
});
