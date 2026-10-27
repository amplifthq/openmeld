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

  it("includes reading the response body in the lookup deadline", async () => {
    let finish: (() => void) | undefined;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          finish = () => {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          };
        },
      })
    );
    const fetch = vi.fn().mockResolvedValue(response);
    const { env, namespace } = createEnv(fetch);
    const failure = expect(
      callRuntimeTransportApi({
        env,
        ownerUserId: "owner",
        path: "/lookup-owner-service",
        body: {},
      })
    ).rejects.toBeInstanceOf(RuntimeTransportReadTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await failure;
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(namespace.get).toHaveBeenCalledTimes(1);
    finish?.();
  });
});
