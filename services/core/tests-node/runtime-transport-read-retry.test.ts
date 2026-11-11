import type { RuntimeTransportAgentProfileWorkRecoveryReadResponse } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callRuntimeTransportRead,
  RuntimeTransportReadTimeoutError,
} from "../src/dispatch/infrastructure/runtime-transport/runtime-transport-read-retry";
import type { CoreBindings } from "../src/lib/bindings";
import type { RuntimeTransportHub } from "../src/runtime-transport/transport/do/runtime-transport-hub";

const inactiveMessage =
  "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.";
const recovered = { status: "not_pending" } as const;

function fixture(
  respond: (
    attempt: number
  ) => Promise<RuntimeTransportAgentProfileWorkRecoveryReadResponse>
) {
  let attempts = 0;
  const id = { toString: () => "hub-object-id" } as DurableObjectId;
  const get = vi.fn(() => {
    const attempt = ++attempts;
    const stub = {
      id,
      rpcReadAgentProfileWorkRecovery: () => respond(attempt),
    } satisfies Pick<DurableObjectStub<RuntimeTransportHub>, "id"> &
      Pick<RuntimeTransportHub, "rpcReadAgentProfileWorkRecovery">;
    return stub as unknown as DurableObjectStub<RuntimeTransportHub>;
  });
  const namespace = {
    get,
    idFromName: vi.fn(() => id),
  } satisfies Pick<
    DurableObjectNamespace<RuntimeTransportHub>,
    "get" | "idFromName"
  >;
  const env = {
    OPENMELD_RUNTIME_TRANSPORT: namespace,
  } as unknown as CoreBindings;
  const signals: AbortSignal[] = [];
  return {
    get,
    signals,
    run: (timeoutMs = 1000) =>
      callRuntimeTransportRead<RuntimeTransportAgentProfileWorkRecoveryReadResponse>(
        {
          env,
          ownerUserId: "owner-1",
          operation: "rpcReadAgentProfileWorkRecovery",
          requestId: "request-1",
          timeoutMs,
          execute: (stub, signal) => {
            signals.push(signal);
            return stub.rpcReadAgentProfileWorkRecovery({
              ownerUserId: "owner-1",
              targetProfileId: "profile-1",
            });
          },
        }
      ),
  };
}

describe("bounded Runtime Transport read retries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    "retryable flag",
    "inactive instance without flags",
  ])("recreates broken stubs with exponential backoff for %s", async (kind) => {
    const failure =
      kind === "retryable flag"
        ? Object.assign(new Error("private error content"), {
            retryable: true,
            remote: true,
          })
        : new Error(inactiveMessage);
    const transport = fixture((attempt) => {
      if (attempt < 3) {
        return Promise.reject(failure);
      }
      return Promise.resolve(recovered);
    });
    const result = transport.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(transport.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(transport.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(recovered);
    expect(transport.get).toHaveBeenCalledTimes(3);
    expect(
      new Set(transport.get.mock.results.map((entry) => entry.value)).size
    ).toBe(3);
    expect(console.warn).toHaveBeenNthCalledWith(
      1,
      "[core.runtime_transport.read_attempt_failed]",
      expect.objectContaining({
        requestId: "request-1",
        durableObjectId: "hub-object-id",
        operation: "rpcReadAgentProfileWorkRecovery",
        attempt: 1,
        retryable: kind === "retryable flag" ? true : null,
        overloaded: null,
        remote: kind === "retryable flag" ? true : null,
        decision: "retry",
        delayMs: 50,
      })
    );
    const firstLog = vi.mocked(console.warn).mock.calls[0]?.[1];
    const secondLog = vi.mocked(console.warn).mock.calls[1]?.[1];
    expect(firstLog.readId).toBe(secondLog.readId);
    expect(Object.keys(firstLog).sort()).toEqual([
      "attempt",
      "decision",
      "delayMs",
      "durableObjectId",
      "elapsedMs",
      "event",
      "inactiveInstance",
      "operation",
      "overloaded",
      "readId",
      "remote",
      "requestId",
      "retryable",
      "timeoutMs",
    ]);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "private error content"
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      message: inactiveMessage,
      flags: { retryable: true, overloaded: true },
      decision: "overloaded",
    },
    {
      message: inactiveMessage,
      flags: { retryable: false },
      decision: "non_retryable",
    },
    {
      message: "handler failed",
      flags: { remote: true },
      decision: "non_retryable",
    },
    { message: "unrecognized failure", flags: {}, decision: "non_retryable" },
  ])("preserves a $decision failure without another attempt: $message", async ({
    message,
    flags,
    decision,
  }) => {
    const failure = Object.assign(new Error(message), flags);
    const transport = fixture(() => Promise.reject(failure));
    const result = expect(transport.run()).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await result;
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ decision })
    );
  });

  it("stops after three attempts and preserves the last exception", async () => {
    const failures = [1, 2, 3].map(() =>
      Object.assign(new Error("transient"), { retryable: true })
    );
    const transport = fixture((attempt) =>
      Promise.reject(failures[attempt - 1])
    );
    const result = expect(transport.run()).rejects.toBe(failures[2]);
    await vi.runAllTimersAsync();
    await result;
    expect(transport.get).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ decision: "attempts_exhausted" })
    );
  });

  it("does not reset the deadline for a retry or accept its late response", async () => {
    const first =
      Promise.withResolvers<RuntimeTransportAgentProfileWorkRecoveryReadResponse>();
    const second =
      Promise.withResolvers<RuntimeTransportAgentProfileWorkRecoveryReadResponse>();
    const transport = fixture((attempt) =>
      attempt === 1 ? first.promise : second.promise
    );
    const result = expect(transport.run(1000)).rejects.toBeInstanceOf(
      RuntimeTransportReadTimeoutError
    );
    await vi.advanceTimersByTimeAsync(800);
    first.reject(Object.assign(new Error("transient"), { retryable: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(transport.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(150);
    await result;
    expect(transport.signals.every((signal) => signal.aborted)).toBe(true);
    second.resolve(recovered);
    await vi.runAllTimersAsync();
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a read that never returns without starting another attempt", async () => {
    const pending =
      Promise.withResolvers<RuntimeTransportAgentProfileWorkRecoveryReadResponse>();
    const transport = fixture(() => pending.promise);
    const result = expect(transport.run(1000)).rejects.toBeInstanceOf(
      RuntimeTransportReadTimeoutError
    );
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    pending.reject(new Error("late rejection"));
    await vi.runAllTimersAsync();
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("preserves the last failure when the remaining budget cannot fit backoff", async () => {
    const pending =
      Promise.withResolvers<RuntimeTransportAgentProfileWorkRecoveryReadResponse>();
    const failure = Object.assign(new Error("transient"), { retryable: true });
    const transport = fixture(() => pending.promise);
    const result = expect(transport.run(1000)).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(980);
    pending.reject(failure);
    await result;
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ decision: "budget_exhausted" })
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
