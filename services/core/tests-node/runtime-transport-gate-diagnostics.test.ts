import { afterEach, describe, expect, it, vi } from "vitest";
import { observeRuntimeTransportGate } from "../src/runtime-transport/infrastructure/runtime-transport-gate-diagnostics";

afterEach(() => vi.restoreAllMocks());

describe("Runtime Transport gate diagnostics", () => {
  it("records a pending stage before it settles and correlates its completion", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let nowMs = 10;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    const pending = Promise.withResolvers<string>();
    const context = {
      bootId: "boot-1",
      durableObjectId: "hub-1",
      gateKind: "constructor" as const,
    };

    const result = observeRuntimeTransportGate(context, async (runStage) => {
      await runStage("reasoning_preference_read", () => pending.promise);
      return "ready";
    });

    // If the platform resets the object here, these are the only records
    // available to identify the unfinished wait.
    expect(
      info.mock.calls.map(([, entry]) => [entry.stage, entry.status])
    ).toEqual([
      ["gate", "started"],
      ["reasoning_preference_read", "started"],
    ]);
    nowMs = 35;
    pending.resolve("preferences");
    await expect(result).resolves.toBe("ready");
    expect(
      info.mock.calls.map(([, entry]) => [entry.stage, entry.status])
    ).toEqual([
      ["gate", "started"],
      ["reasoning_preference_read", "started"],
      ["reasoning_preference_read", "completed"],
      ["gate", "completed"],
    ]);
    const gateId = info.mock.calls[0]?.[1].gateId;
    expect(gateId).toEqual(expect.any(String));
    for (const [, entry] of info.mock.calls) {
      expect(entry).toMatchObject({
        ...context,
        event: "runtime_transport_gate_phase",
        gateId,
      });
    }
    expect(info.mock.calls[2]?.[1]).toMatchObject({
      elapsedMs: 25,
      durationMs: 25,
    });

    await observeRuntimeTransportGate(
      { ...context, gateKind: "register" },
      async () => undefined
    );
    expect(info.mock.calls[4]?.[1]).toMatchObject({
      bootId: "boot-1",
      gateKind: "register",
    });
    expect(info.mock.calls[4]?.[1].gateId).not.toBe(gateId);
  });

  it("preserves the original rejection and logs only bounded failure metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error("private request and response contents");

    await expect(
      observeRuntimeTransportGate(
        { bootId: "boot-2", durableObjectId: "hub-2", gateKind: "register" },
        (runStage) =>
          runStage("runtime_records_persist", () => Promise.reject(failure))
      )
    ).rejects.toBe(failure);

    expect(
      warn.mock.calls.map(([, entry]) => [entry.stage, entry.status])
    ).toEqual([
      ["runtime_records_persist", "failed"],
      ["gate", "failed"],
    ]);
    expect(
      info.mock.calls.every(([, entry]) => entry.status === "started")
    ).toBe(true);
    for (const [, entry] of warn.mock.calls) {
      expect(Object.keys(entry).sort()).toEqual([
        "bootId",
        "durableObjectId",
        "durationMs",
        "elapsedMs",
        "event",
        "gateId",
        "gateKind",
        "stage",
        "status",
      ]);
      expect(entry.gateId).toBe(info.mock.calls[0]?.[1].gateId);
    }
    expect(
      JSON.stringify([...info.mock.calls, ...warn.mock.calls])
    ).not.toContain(failure.message);
  });
});
