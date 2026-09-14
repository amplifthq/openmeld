import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliBinaryReleaseInfo } from "../src/config/version-state";
import { downloadCliBinaryUpdateArtifact } from "../src/runtime/cli-binary-update-artifact";

const DOWNLOAD_URL = "https://downloads.openmeld.test/openmeld";
const DELTA_DOWNLOAD_URL = `${DOWNLOAD_URL}.delta`;

describe("CLI binary artifact download recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a progressing download alive for more than sixty seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T00:00:00.000Z"));
    const first = Buffer.from("slow ");
    const second = Buffer.from("but complete");
    const artifact = Buffer.concat([first, second]);
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        { afterMs: 45_000, bytes: first },
        { afterMs: 45_000, bytes: second },
      ])
    );

    const result = downloadCliBinaryUpdateArtifact({
      downloadPolicy: {
        maxAttempts: 3,
        retryDelaysMs: [0, 0],
        stallTimeoutMs: 60_000,
        totalBudgetMs: 5 * 60_000,
      },
      fetchImpl,
      onDeltaFallback: vi.fn(),
      plan: buildRawPlan(artifact),
      release: buildRelease(artifact),
    });

    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(45_000);

    await expect(result).resolves.toEqual(artifact);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("discards an interrupted partial body and succeeds on a bounded retry", async () => {
    const artifact = Buffer.from("complete artifact");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Buffer.from("partial"));
              controller.error(
                new TypeError("terminated", {
                  cause: Object.assign(new Error("socket closed"), {
                    code: "UND_ERR_SOCKET",
                  }),
                })
              );
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(artifact, { status: 200 }));

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback: vi.fn(),
        plan: buildRawPlan(artifact),
        release: buildRelease(artifact),
      })
    ).resolves.toEqual(artifact);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts and cancels a stalled attempt without waiting for cleanup before retrying", async () => {
    vi.useFakeTimers();
    const artifact = Buffer.from("complete artifact");
    let cancelCalls = 0;
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      if (init?.signal) {
        signals.push(init.signal);
      }
      if (signals.length === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancelCalls += 1;
                return new Promise<void>(() => undefined);
              },
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(artifact, { status: 200 }));
    });

    const result = downloadCliBinaryUpdateArtifact({
      downloadPolicy: {
        maxAttempts: 2,
        retryDelaysMs: [0],
        stallTimeoutMs: 100,
        totalBudgetMs: 1000,
      },
      fetchImpl,
      onDeltaFallback: vi.fn(),
      plan: buildRawPlan(artifact),
      release: buildRelease(artifact),
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toEqual(artifact);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cancelCalls).toBe(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a retryable service response but not an authentication response", async () => {
    const artifact = Buffer.from("eventual artifact");
    let serviceBodyCancelCalls = 0;
    const retryingFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              serviceBodyCancelCalls += 1;
              return new Promise<void>(() => undefined);
            },
          }),
          { status: 503 }
        )
      )
      .mockResolvedValueOnce(new Response(artifact, { status: 200 }));

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl: retryingFetch,
        onDeltaFallback: vi.fn(),
        plan: buildRawPlan(artifact),
        release: buildRelease(artifact),
      })
    ).resolves.toEqual(artifact);
    expect(retryingFetch).toHaveBeenCalledTimes(2);
    expect(serviceBodyCancelCalls).toBe(1);

    const blockedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 }));
    const onDeltaFallback = vi.fn();
    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl: blockedFetch,
        onDeltaFallback,
        plan: buildDeltaPlan(artifact),
        release: buildRelease(artifact),
      })
    ).rejects.toMatchObject({
      code: "openmeld.tools.update.download_failed",
    });
    expect(blockedFetch).toHaveBeenCalledOnce();
    expect(onDeltaFallback).not.toHaveBeenCalled();
  });

  it("does not retry a TLS certificate failure", async () => {
    const artifact = Buffer.from("artifact");
    const tlsError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("certificate expired"), {
        code: "CERT_HAS_EXPIRED",
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(tlsError);

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback: vi.fn(),
        plan: buildRawPlan(artifact),
        release: buildRelease(artifact),
      })
    ).rejects.toMatchObject({
      code: "openmeld.tools.update.download_failed",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not retry an issuer certificate verification failure", async () => {
    const artifact = Buffer.from("artifact");
    const tlsError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket closed"), {
        code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(tlsError);
    const onDeltaFallback = vi.fn();

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback,
        plan: buildDeltaPlan(artifact),
        release: buildRelease(artifact),
      })
    ).rejects.toMatchObject({
      code: "openmeld.tools.update.download_failed",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onDeltaFallback).not.toHaveBeenCalled();
  });

  it("reserves one global attempt for the complete archive after delta retries", async () => {
    const artifact = Buffer.from("complete artifact");
    const deltaPlan = buildDeltaPlan(artifact);
    const fetchImpl = vi.fn<typeof fetch>((url) =>
      Promise.resolve(
        String(url) === DELTA_DOWNLOAD_URL
          ? new Response(null, { status: 503 })
          : new Response(artifact, { status: 200 })
      )
    );
    const onDeltaFallback = vi.fn();

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback,
        plan: deltaPlan,
        release: buildRelease(artifact),
      })
    ).resolves.toEqual(artifact);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      DELTA_DOWNLOAD_URL,
      DELTA_DOWNLOAD_URL,
      DOWNLOAD_URL,
    ]);
    expect(onDeltaFallback).toHaveBeenCalledOnce();
  });

  it("reserves a one-attempt policy for the complete archive", async () => {
    const artifact = Buffer.from("complete artifact");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(artifact, { status: 200 }));
    const onDeltaFallback = vi.fn();

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 1,
          retryDelaysMs: [],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback,
        plan: buildDeltaPlan(artifact),
        release: buildRelease(artifact),
      })
    ).resolves.toEqual(artifact);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      DOWNLOAD_URL,
      expect.objectContaining({ method: "GET" })
    );
    expect(onDeltaFallback).not.toHaveBeenCalled();
  });

  it("does not retry a corrupt delta before falling back to the complete archive", async () => {
    const artifact = Buffer.from("complete artifact");
    const corruptDelta = Buffer.alloc(artifact.byteLength);
    const fetchImpl = vi.fn<typeof fetch>((url) =>
      Promise.resolve(
        new Response(
          String(url) === DELTA_DOWNLOAD_URL ? corruptDelta : artifact,
          { status: 200 }
        )
      )
    );
    const onDeltaFallback = vi.fn();

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback,
        plan: buildDeltaPlan(artifact),
        release: buildRelease(artifact),
      })
    ).resolves.toEqual(artifact);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      DELTA_DOWNLOAD_URL,
      DOWNLOAD_URL,
    ]);
    expect(onDeltaFallback).toHaveBeenCalledOnce();
  });

  it("does not retry a non-network fetch programming error", async () => {
    const artifact = Buffer.from("artifact");
    const fetchError = new TypeError("Invalid URL", {
      cause: Object.assign(new Error("unsupported URL"), {
        code: "ERR_INVALID_URL",
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(fetchError);

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback: vi.fn(),
        plan: buildRawPlan(artifact),
        release: buildRelease(artifact),
      })
    ).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("stops the whole retry sequence at the total budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T00:00:00.000Z"));
    const artifact = Buffer.from("never arrives");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Intentionally never produces bytes or closes.
            },
          }),
          { status: 200 }
        )
    );

    const result = downloadCliBinaryUpdateArtifact({
      downloadPolicy: {
        maxAttempts: 3,
        retryDelaysMs: [0, 0],
        stallTimeoutMs: 60_000,
        totalBudgetMs: 90_000,
      },
      fetchImpl,
      onDeltaFallback: vi.fn(),
      plan: buildRawPlan(artifact),
      release: buildRelease(artifact),
    });
    const rejection = expect(result).rejects.toMatchObject({
      code: "openmeld.tools.update.download_timed_out",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry bytes that fail the declared checksum", async () => {
    const expected = Buffer.from("expected");
    const tampered = Buffer.from("tampered");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(tampered, { status: 200 }));

    await expect(
      downloadCliBinaryUpdateArtifact({
        downloadPolicy: {
          maxAttempts: 3,
          retryDelaysMs: [0, 0],
          stallTimeoutMs: 1000,
          totalBudgetMs: 5000,
        },
        fetchImpl,
        onDeltaFallback: vi.fn(),
        plan: {
          ...buildRawPlan(expected),
          downloadSizeBytes: tampered.byteLength,
        },
        release: {
          ...buildRelease(expected),
          sizeBytes: tampered.byteLength,
        },
      })
    ).rejects.toMatchObject({
      code: "openmeld.tools.update.integrity_check_failed",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

function buildRelease(bytes: Buffer): CliBinaryReleaseInfo {
  return {
    minRequiredCliVersion: "0.1.0",
    platform: `${process.platform}-${process.arch}`,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
    url: DOWNLOAD_URL,
    version: "9.9.9",
  };
}

function buildRawPlan(bytes: Buffer) {
  return {
    downloadSha256: sha256(bytes),
    downloadSizeBytes: bytes.byteLength,
    downloadUrl: DOWNLOAD_URL,
    transport: "raw" as const,
  };
}

function buildDeltaPlan(bytes: Buffer) {
  const baseBytes = Buffer.from("base artifact");
  return {
    baseBytes,
    delta: {
      fromSha256: sha256(baseBytes),
      fromSizeBytes: baseBytes.byteLength,
      fromVersion: "1.0.0",
      patchCompression: "gzip" as const,
      patchFormat: "block-ranges-v1" as const,
      patchPayloadSizeBytes: bytes.byteLength,
      patchSha256: sha256(bytes),
      patchSizeBytes: bytes.byteLength,
      patchUrl: DELTA_DOWNLOAD_URL,
    },
    downloadSizeBytes: bytes.byteLength,
    transport: "delta" as const,
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function streamResponse(
  chunks: { afterMs: number; bytes: Buffer }[]
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const remaining = [...chunks];
        const enqueueNext = (): void => {
          const next = remaining.shift();
          if (!next) {
            controller.close();
            return;
          }
          setTimeout(() => {
            controller.enqueue(next.bytes);
            enqueueNext();
          }, next.afterMs);
        };
        enqueueNext();
      },
    }),
    { status: 200 }
  );
}
