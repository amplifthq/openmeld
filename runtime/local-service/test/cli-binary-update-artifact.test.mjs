import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import { downloadCliBinaryUpdateArtifact } from "../dist/cli-binary-update-artifact.js";

const DOWNLOAD_URL = "https://downloads.openmeld.test/openmeld";
const DELTA_DOWNLOAD_URL = `${DOWNLOAD_URL}.delta`;

afterEach(() => mock.timers.reset());

test("retries an interrupted partial artifact from the beginning", async () => {
  const artifact = Buffer.from("complete artifact");
  let requests = 0;

  const result = await downloadCliBinaryUpdateArtifact({
    downloadPolicy: testPolicy(),
    fetchImpl: () => {
      requests += 1;
      if (requests === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream({
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
        );
      }
      return Promise.resolve(new Response(artifact, { status: 200 }));
    },
    onDeltaFallback() {
      // This full-artifact test must not use delta fallback.
    },
    plan: buildRawPlan(artifact),
    release: buildRelease(artifact),
  });

  assert.deepEqual(result, artifact);
  assert.equal(requests, 2);
});

test("honors Retry-After before retrying the same artifact", async () => {
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const artifact = Buffer.from("eventual artifact");
  let requests = 0;
  const result = downloadCliBinaryUpdateArtifact({
    downloadPolicy: testPolicy(),
    fetchImpl: () => {
      requests += 1;
      return Promise.resolve(
        requests === 1
          ? new Response(null, {
              headers: { "retry-after": "2" },
              status: 503,
            })
          : new Response(artifact, { status: 200 })
      );
    },
    onDeltaFallback() {
      // This full-artifact test must not use delta fallback.
    },
    plan: buildRawPlan(artifact),
    release: buildRelease(artifact),
  });
  await settlePromises();

  mock.timers.tick(1999);
  await settlePromises();
  assert.equal(requests, 1);
  mock.timers.tick(1);
  await assert.doesNotReject(result);
  assert.equal(requests, 2);
});

test("honors HTTP-date Retry-After before delta-to-full fallback", async () => {
  const now = Date.parse("2026-09-16T00:00:00.000Z");
  mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const artifact = Buffer.from("complete artifact");
  const requestedUrls = [];
  const result = downloadCliBinaryUpdateArtifact({
    downloadPolicy: { ...testPolicy(), maxAttempts: 2 },
    fetchImpl: (url) => {
      requestedUrls.push(String(url));
      return Promise.resolve(
        String(url) === DELTA_DOWNLOAD_URL
          ? new Response(null, {
              headers: {
                "retry-after": new Date(now + 2000).toUTCString(),
              },
              status: 503,
            })
          : new Response(artifact, { status: 200 })
      );
    },
    onDeltaFallback() {
      // Expected when the optional delta is unavailable.
    },
    plan: buildDeltaPlan(artifact),
    release: buildRelease(artifact),
  });
  await settlePromises();

  mock.timers.tick(1999);
  await settlePromises();
  assert.deepEqual(requestedUrls, [DELTA_DOWNLOAD_URL]);
  mock.timers.tick(1);
  assert.deepEqual(await result, artifact);
  assert.deepEqual(requestedUrls, [DELTA_DOWNLOAD_URL, DOWNLOAD_URL]);
});

test("rejects Retry-After that would exceed the total recovery budget", async () => {
  const artifact = Buffer.from("never retried");
  let requests = 0;

  await assert.rejects(
    downloadCliBinaryUpdateArtifact({
      downloadPolicy: { ...testPolicy(), totalBudgetMs: 5000 },
      fetchImpl: () => {
        requests += 1;
        return Promise.resolve(
          new Response(null, {
            headers: { "retry-after": "10" },
            status: 503,
          })
        );
      },
      onDeltaFallback() {
        // This full-artifact test must not use delta fallback.
      },
      plan: buildRawPlan(artifact),
      release: buildRelease(artifact),
    }),
    { code: "openmeld.tools.update.download_timed_out" }
  );
  assert.equal(requests, 1);
});

function testPolicy() {
  return {
    maxAttempts: 3,
    retryDelaysMs: [0, 0],
    stallTimeoutMs: 1000,
    totalBudgetMs: 5000,
  };
}

function buildRelease(bytes) {
  return {
    minRequiredCliVersion: "0.1.0",
    platform: `${process.platform}-${process.arch}`,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
    url: DOWNLOAD_URL,
    version: "9.9.9",
  };
}

function buildRawPlan(bytes) {
  return {
    downloadSha256: sha256(bytes),
    downloadSizeBytes: bytes.byteLength,
    downloadUrl: DOWNLOAD_URL,
    transport: "raw",
  };
}

function buildDeltaPlan(bytes) {
  const baseBytes = Buffer.from("base artifact");
  return {
    baseBytes,
    delta: {
      fromSha256: sha256(baseBytes),
      fromSizeBytes: baseBytes.byteLength,
      fromVersion: "1.0.0",
      patchCompression: "gzip",
      patchFormat: "block-ranges-v1",
      patchPayloadSizeBytes: bytes.byteLength,
      patchSha256: sha256(bytes),
      patchSizeBytes: bytes.byteLength,
      patchUrl: DELTA_DOWNLOAD_URL,
    },
    downloadSizeBytes: bytes.byteLength,
    transport: "delta",
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function settlePromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();
}
