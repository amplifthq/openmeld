import type { LocalComponentsStatus } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createServiceLocalComponentsObservation } from "../src/local-service/carrier/service-local-components-observation";

describe("Service-lifetime component inspection", () => {
  it("keeps one unfinished inspection through repeated reconnects and only notifies the current connection", async () => {
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
      expect(observation.read(callback)).toBeNull();
    }
    expect(inspect).toHaveBeenCalledOnce();
    complete(null);
    await pending;
    expect(
      callbacks
        .slice(0, -1)
        .every((callback) => callback.mock.calls.length === 0)
    ).toBe(true);
    expect(callbacks.at(-1)).toHaveBeenCalledOnce();
    observation.dispose();
  });

  it("does not let failed or disposed optional inspection interrupt the carrier", async () => {
    const failure = new Error("inspection unavailable");
    const onError = vi.fn();
    const inspect = vi.fn(() => Promise.reject(failure));
    const observation = createServiceLocalComponentsObservation({
      inspect,
      onError,
    });
    expect(observation.read(vi.fn())).toBeNull();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(observation.read(vi.fn())).toBeNull();
    expect(inspect).toHaveBeenCalledOnce();
    observation.dispose();
    expect(observation.read(vi.fn())).toBeNull();
  });
});
