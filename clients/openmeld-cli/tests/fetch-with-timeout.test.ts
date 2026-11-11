import { createOpenMeldApiClient, createSpaceApi } from "@openmeld/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSpaceRequestWithTimeout } from "../src/space/fetch-with-timeout";

describe("fetchSpaceRequestWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.OPENMELD_SPACE_REQUEST_TIMEOUT_MS = undefined;
  });

  it("throws network.timeout when request exceeds timeout budget", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      queueMicrotask(() => {
        controller.abort(new DOMException("timed out", "TimeoutError"));
      });
      return controller.signal;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        queueMicrotask(() => {
          reject(
            init?.signal?.reason ?? new DOMException("aborted", "AbortError")
          );
        });
      });
    });

    await expect(
      fetchSpaceRequestWithTimeout({
        url: "https://example.com/space",
        operation: "space.send",
        timeoutMs: 5,
      })
    ).rejects.toMatchObject({
      code: "network.timeout",
      message: "space.send request timed out after 1000ms",
    });
  });

  it("honors OPENMELD_SPACE_REQUEST_TIMEOUT_MS when timeoutMs is not provided", async () => {
    process.env.OPENMELD_SPACE_REQUEST_TIMEOUT_MS = "5";
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      queueMicrotask(() => {
        controller.abort(new DOMException("timed out", "TimeoutError"));
      });
      return controller.signal;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        queueMicrotask(() => {
          reject(
            init?.signal?.reason ?? new DOMException("aborted", "AbortError")
          );
        });
      });
    });

    await expect(
      fetchSpaceRequestWithTimeout({
        url: "https://example.com/history",
        operation: "space.history",
      })
    ).rejects.toMatchObject({
      code: "network.timeout",
      message: "space.history request timed out after 1000ms",
    });
  });

  it.each([
    [8_820_538, "space.files.upload.direct"],
    [24_000_000, "space.files.upload.part.1"],
  ] as const)("lets a slow %i-byte Space upload reach a server response after ten seconds", async (size, stage) => {
    vi.useFakeTimers();
    vi.stubEnv("OPENMELD_SPACE_REQUEST_TIMEOUT_MS", undefined);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const started = Promise.withResolvers<void>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        if (typeof init?.body === "string") {
          return Response.json({
            uploadId: String(url).split("/").at(-1),
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            partSizeBytes: 8 * 1024 * 1024,
            parts: [],
          });
        }
        started.resolve();
        return await new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
          // An authoritative rejection after transfer proves the client waited for
          // the server instead of aborting and retrying at its generic deadline.
          setTimeout(
            () => resolve(new Response(null, { status: 403 })),
            12_000
          );
        });
      });
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport: fetchSpaceRequestWithTimeout,
      })
    );
    const result = api
      .uploadFile({
        spaceId: "space-123",
        clientMutationId: "evidence-1",
        name: "evidence.zip",
        mimeType: "application/zip",
        origin: "artifact",
        bytes: new Blob([new ArrayBuffer(size)]),
      })
      .catch((error: unknown) => error);
    await started.promise;
    await vi.advanceTimersByTimeAsync(12_000);
    // Also settle the existing multipart backoff if the old timeout regresses.
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 403, operation: stage });
    expect(fetchMock).toHaveBeenCalledTimes(size > 10 * 1024 * 1024 ? 2 : 1);
  });

  it("keeps non-timeout errors unchanged", async () => {
    const networkError = new Error("socket closed");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);

    await expect(
      fetchSpaceRequestWithTimeout({
        url: "https://example.com/space",
        operation: "space.send",
        timeoutMs: 10_000,
      })
    ).rejects.toBe(networkError);
  });

  it("retries TLS socket errors once on a fresh fetch call", async () => {
    const tlsError = new Error("bad TLS record") as Error & { code: string };
    tlsError.code = "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC";
    const response = new Response("ok", { status: 200 });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(tlsError)
      .mockResolvedValueOnce(response);

    await expect(
      fetchSpaceRequestWithTimeout({
        url: "https://example.com/space",
        operation: "space.send",
        timeoutMs: 10_000,
      })
    ).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
