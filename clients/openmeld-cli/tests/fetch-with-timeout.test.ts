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
