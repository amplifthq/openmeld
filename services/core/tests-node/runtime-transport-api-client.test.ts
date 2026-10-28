import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callRuntimeTransportApi,
  type RuntimeTransportApiPath,
} from "../src/dispatch/infrastructure/runtime-transport/runtime-transport-api-client";
import { RuntimeTransportReadTimeoutError } from "../src/dispatch/infrastructure/runtime-transport/runtime-transport-read-retry";
import type { CoreBindings } from "../src/lib/bindings";

function createEnv(...fetches: ReturnType<typeof vi.fn>[]) {
  const shardId: DurableObjectId = {
    name: "owner",
    equals: (other) => other.toString() === "owner-shard",
    toString: () => "owner-shard",
  };
  const namespace = {
    idFromName: vi.fn(() => shardId),
    get: vi.fn(),
  };
  for (const fetch of fetches) {
    namespace.get.mockReturnValueOnce({ id: shardId, fetch });
  }
  return {
    env: { OPENMELD_RUNTIME_TRANSPORT: namespace } as unknown as CoreBindings,
    namespace,
  };
}

describe("Runtime Transport HTTP retry boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    { path: "/lookup-route", failurePhase: "fetch" },
    { path: "/lookup-routes-batch", failurePhase: "fetch" },
    { path: "/lookup-owner-service", failurePhase: "fetch" },
    { path: "/lookup-owner-service", failurePhase: "body" },
  ] as const)("retries $path on a fresh stub after a retryable $failurePhase exception", async ({
    path,
    failurePhase,
  }) => {
    const error = Object.assign(new Error("Transient Durable Object failure"), {
      retryable: true,
    });
    const first =
      failurePhase === "fetch"
        ? vi.fn().mockRejectedValue(error)
        : vi.fn().mockResolvedValue(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(error);
                },
              })
            )
          );
    const response =
      path === "/lookup-routes-batch"
        ? { routes: {} }
        : { online: false, reasonCode: "daemon.session.not_found" };
    const second = vi.fn().mockResolvedValue(Response.json(response));
    const { env, namespace } = createEnv(first, second);
    const body: Record<string, unknown> = { v: 1, ownerUserId: "owner" };
    if (path === "/lookup-route") {
      body.profileId = "profile";
    }
    if (path === "/lookup-routes-batch") {
      body.profileIds = ["profile"];
    }
    const result = callRuntimeTransportApi({
      env,
      ownerUserId: "owner",
      path,
      requestId: "request-lookup",
      body,
    });

    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(response);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(namespace.get).toHaveBeenCalledTimes(2);
    expect(second.mock.calls[0]?.[0]).toBe(first.mock.calls[0]?.[0]);
    expect(second.mock.calls[0]?.[1].body).toBe(first.mock.calls[0]?.[1].body);
    expect(console.warn).toHaveBeenCalledWith(
      "[core.runtime_transport.read_attempt_failed]",
      expect.objectContaining({
        operation: path,
        requestId: "request-lookup",
        decision: "retry",
      })
    );
  });

  it.each<RuntimeTransportApiPath>([
    "/deliver-dispatch",
    "/runtime-coordinator/interaction/respond",
    "/computer-power",
  ])("does not replay %s even when the platform marks the failure retryable", async (path) => {
    const fetch = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Outcome uncertain"), { retryable: true })
      );
    const { env, namespace } = createEnv(fetch);

    await expect(
      callRuntimeTransportApi({
        env,
        ownerUserId: "owner",
        path,
        body: { operation: "read" },
      })
    ).resolves.toBeNull();
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(namespace.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      status: 404,
      body: { online: false, reasonCode: "daemon.session.not_found" },
    },
    {
      status: 503,
      body: { online: false, reasonCode: "core.transport_restarting" },
    },
  ])("preserves a structured HTTP $status response without retrying it", async ({
    status,
    body,
  }) => {
    const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
    const { env, namespace } = createEnv(fetch);
    await expect(
      callRuntimeTransportApi({
        env,
        ownerUserId: "owner",
        path: "/lookup-route",
        body: {},
      })
    ).resolves.toEqual(body);
    expect(namespace.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    200, 404,
  ])("keeps malformed JSON HTTP %s handling without retrying", async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("not JSON", { status }));
    const { env, namespace } = createEnv(fetch);
    await expect(
      callRuntimeTransportApi({
        env,
        ownerUserId: "owner",
        path: "/lookup-route",
        body: {},
      })
    ).resolves.toEqual(
      status === 404
        ? { online: false, reasonCode: "daemon.session.not_found" }
        : null
    );
    expect(namespace.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    "fetch",
    "body",
  ])("propagates the final lookup %s exception instead of forging an offline result", async (phase) => {
    const failure = Object.assign(new Error("Object overloaded"), {
      overloaded: true,
      retryable: true,
    });
    const fetch =
      phase === "fetch"
        ? vi.fn().mockRejectedValue(failure)
        : vi.fn().mockResolvedValue(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(failure);
                },
              })
            )
          );
    const { env, namespace } = createEnv(fetch);
    await expect(
      callRuntimeTransportApi({
        env,
        ownerUserId: "owner",
        path: "/lookup-owner-service",
        body: {},
      })
    ).rejects.toBe(failure);
    expect(namespace.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    "fetch",
    "body",
    "fetch resolved after its deadline",
  ])("abandons a stalled %s attempt and ignores its late result while a fresh attempt recovers", async (phase) => {
    const pending = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    let finishBody: (() => void) | undefined;
    const lateResponse = {
      online: false,
      reasonCode: "daemon.session.not_found",
    };
    const first =
      phase !== "body"
        ? vi.fn().mockReturnValue(pending.promise)
        : vi.fn().mockResolvedValue(
            new Response(
              new ReadableStream({
                start(controller) {
                  finishBody = () => {
                    controller.enqueue(
                      new TextEncoder().encode(JSON.stringify(lateResponse))
                    );
                    controller.close();
                  };
                },
              })
            )
          );
    const second = vi.fn().mockReturnValue(secondResponse.promise);
    const { env, namespace } = createEnv(first, second);
    const startedAt = Date.now();
    const result = callRuntimeTransportApi({
      env,
      ownerUserId: "owner",
      path: "/lookup-owner-service",
      requestId: "stalled-owner-lookup",
      body: { v: 1, ownerUserId: "owner" },
    });
    const settled = vi.fn();
    result.then(settled, () => undefined);

    await vi.advanceTimersByTimeAsync(2499);
    expect(namespace.get).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0]?.[1].signal.aborted).toBe(false);
    if (phase === "fetch resolved after its deadline") {
      // A result can arrive after the deadline before the timer is serviced.
      vi.setSystemTime(startedAt + 2501);
      pending.resolve(Response.json(lateResponse));
      await vi.advanceTimersByTimeAsync(0);
    } else {
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(first.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      "[core.runtime_transport.read_attempt_failed]",
      expect.objectContaining({
        operation: "/lookup-owner-service",
        requestId: "stalled-owner-lookup",
        attemptTimedOut: true,
        attemptTimeoutMs: 2500,
        retryable: null,
        overloaded: null,
        decision: "retry",
      })
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(namespace.get).toHaveBeenCalledTimes(2);
    expect(second.mock.calls[0]?.[1].signal).not.toBe(
      first.mock.calls[0]?.[1].signal
    );
    expect(second.mock.calls[0]?.[1].signal.aborted).toBe(false);

    pending.resolve(Response.json(lateResponse));
    finishBody?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    const recoveredResponse = {
      online: false,
      reasonCode: "core.transport_restarting",
    };
    secondResponse.resolve(Response.json(recoveredResponse, { status: 503 }));
    await expect(result).resolves.toEqual(recoveredResponse);
    expect(second.mock.calls[0]?.[1].body).toBe(first.mock.calls[0]?.[1].body);
    expect(namespace.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      path: "/lookup-owner-service",
      timeoutMs: 5000,
      readTimeoutMs: undefined,
    },
    {
      path: "/lookup-routes-batch",
      timeoutMs: 38_000,
      readTimeoutMs: undefined,
    },
    { path: "/lookup-routes-batch", timeoutMs: 5000, readTimeoutMs: 5000 },
    { path: "/lookup-routes-batch", timeoutMs: 38_000, readTimeoutMs: 60_000 },
  ] as const)("keeps the shared $timeoutMs ms budget for $path bodies with caller cap $readTimeoutMs", async ({
    path,
    timeoutMs,
    readTimeoutMs,
  }) => {
    const finishBodies: (() => void)[] = [];
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              finishBodies.push(() => {
                controller.enqueue(new TextEncoder().encode("{}"));
                controller.close();
              });
            },
          })
        )
      )
    );
    const { env, namespace } = createEnv(fetch, fetch);
    const failure = expect(
      callRuntimeTransportApi({
        env,
        ownerUserId: "owner",
        path,
        readTimeoutMs,
        body: {
          v: 1,
          ownerUserId: "owner",
          ...(path === "/lookup-routes-batch"
            ? { profileIds: ["profile"] }
            : {}),
        },
      })
    ).rejects.toBeInstanceOf(RuntimeTransportReadTimeoutError);
    await vi.advanceTimersByTimeAsync(timeoutMs / 2 + 50);
    expect(namespace.get).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(fetch.mock.calls[1]?.[1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(timeoutMs / 2 - 50);
    await failure;
    expect(fetch.mock.calls.every(([, init]) => init.signal.aborted)).toBe(
      true
    );
    expect(console.warn).toHaveBeenLastCalledWith(
      "[core.runtime_transport.read_attempt_failed]",
      expect.objectContaining({ decision: "budget_exhausted", timeoutMs })
    );
    for (const finish of finishBodies) {
      finish();
    }
    await vi.runAllTimersAsync();
    expect(namespace.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
