import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateChannelSync,
  fetchCliChannelManifest,
  isEnvFlagEnabled,
  PRODUCTION_CLI_MANIFEST_URL,
  probeChannelPlatformUrls,
  resolveChannelVersionComparison,
  resolveCliServiceVersionConsistencyErrors,
} from "./cli-channel-sync.mjs";

// Captured verbatim from `curl -s https://openmeld.ai/cli/manifest.json` on
// 2026-07-10, the exact moment of the half-release incident this gate
// closes (stable was still 0.2.20 while release/local-components.json had
// already been stamped to 0.2.21). Per repo policy, mocks must be built from
// a captured real response shape, not shaped after the implementation.
const PRODUCTION_MANIFEST_FIXTURE = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/cli-manifest.production-snapshot.json",
      import.meta.url
    ),
    "utf8"
  )
);
const ENOTFOUND_RE = /ENOTFOUND/u;
const SOCKET_HANG_UP_RE = /socket hang up/u;
const TIMEOUT_RE = /timeout/u;
const UNEXPECTED_STATUS_500_RE = /Unexpected status 500/u;
const EMPTY_PLATFORM_MAP_RE = /at least one platform is required/u;

function cloneManifestWithVersion(version) {
  const clone = JSON.parse(JSON.stringify(PRODUCTION_MANIFEST_FIXTURE));
  clone.channels.stable.version = version;
  clone.channels.stable.minRequiredCliVersion = version;
  for (const release of Object.values(clone.channels.stable.platforms)) {
    release.archiveFormat = "gzip";
    release.archiveUrl = `${release.url}.gz`;
    release.archiveSha256 = "a".repeat(64);
    release.archiveSizeBytes = 25_721_096;
  }
  return clone;
}

function compressedPlatforms() {
  return cloneManifestWithVersion("0.2.20").channels.stable.platforms;
}

test("derives the production CLI manifest URL from upload-cli-binary's exported constants", () => {
  assert.equal(
    PRODUCTION_CLI_MANIFEST_URL,
    "https://openmeld.ai/cli/manifest.json"
  );
});

test("isEnvFlagEnabled treats only 1/true (case-insensitive) as truthy", () => {
  assert.equal(isEnvFlagEnabled("1"), true);
  assert.equal(isEnvFlagEnabled("true"), true);
  assert.equal(isEnvFlagEnabled("TRUE"), true);
  assert.equal(isEnvFlagEnabled("0"), false);
  assert.equal(isEnvFlagEnabled("false"), false);
  assert.equal(isEnvFlagEnabled(undefined), false);
  assert.equal(isEnvFlagEnabled(""), false);
});

test("flags cli.packageVersion / service.bundleVersion mismatch as an error", () => {
  assert.deepEqual(
    resolveCliServiceVersionConsistencyErrors({
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.20" },
    }),
    [
      "release/local-components.json is internally inconsistent: cli.packageVersion (0.2.21) must equal service.bundleVersion (0.2.20) because the CLI binary is the OpenMeld Service runtime.",
    ]
  );
});

test("passes cli/service version consistency when they match", () => {
  assert.deepEqual(
    resolveCliServiceVersionConsistencyErrors({
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    }),
    []
  );
});

test("compares the channel version against the declared release version", () => {
  assert.equal(
    resolveChannelVersionComparison({
      channelVersion: "0.2.20",
      declaredVersion: "0.2.21",
    }).status,
    "behind"
  );
  assert.equal(
    resolveChannelVersionComparison({
      channelVersion: "0.2.21",
      declaredVersion: "0.2.21",
    }).status,
    "match"
  );
  assert.equal(
    resolveChannelVersionComparison({
      channelVersion: "0.2.22",
      declaredVersion: "0.2.21",
    }).status,
    "ahead"
  );
});

test("fetchCliChannelManifest parses the real captured production manifest shape", async () => {
  const stubFetch = (url) => {
    assert.equal(url, PRODUCTION_CLI_MANIFEST_URL);
    return Promise.resolve({
      json: () => Promise.resolve(PRODUCTION_MANIFEST_FIXTURE),
      ok: true,
      status: 200,
    });
  };
  const manifest = await fetchCliChannelManifest({ fetch: stubFetch });
  assert.deepEqual(manifest, PRODUCTION_MANIFEST_FIXTURE);
});

test("fetchCliChannelManifest throws on a non-ok HTTP status", async () => {
  const stubFetch = () =>
    Promise.resolve({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
  await assert.rejects(
    fetchCliChannelManifest({ fetch: stubFetch }),
    UNEXPECTED_STATUS_500_RE
  );
});

test("fetchCliChannelManifest surfaces network failures", async () => {
  const stubFetch = () =>
    Promise.reject(new Error("getaddrinfo ENOTFOUND openmeld.ai"));
  await assert.rejects(
    fetchCliChannelManifest({ fetch: stubFetch }),
    ENOTFOUND_RE
  );
});

test("probeChannelPlatformUrls reports a 200 HEAD response as reachable", async () => {
  const stubFetch = (_url, init) => {
    assert.equal(init.method, "HEAD");
    return Promise.resolve({ ok: true, status: 200 });
  };
  const results = await probeChannelPlatformUrls({
    fetch: stubFetch,
    platforms: compressedPlatforms(),
  });
  assert.deepEqual(results, [
    {
      artifactKind: "binary",
      ok: true,
      platform: "darwin-arm64",
      status: 200,
      url: "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.2.20",
    },
    {
      artifactKind: "archive",
      ok: true,
      platform: "darwin-arm64",
      status: 200,
      url: "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.2.20.gz",
    },
  ]);
});

test("probeChannelPlatformUrls checks every declared delta before release", async () => {
  const platforms = compressedPlatforms();
  platforms["darwin-arm64"].deltas = [
    {
      fromSha256: "b".repeat(64),
      fromSizeBytes: 72_000_000,
      fromVersion: "0.2.19",
      patchCompression: "gzip",
      patchFormat: "block-ranges-v1",
      patchPayloadSizeBytes: 4_000_000,
      patchSha256: "c".repeat(64),
      patchSizeBytes: 990_000,
      patchUrl:
        "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.2.20-delta-from-0.2.19.gz",
    },
  ];
  const results = await probeChannelPlatformUrls({
    fetch: () => Promise.resolve({ ok: true, status: 200 }),
    platforms,
  });

  assert.equal(results.length, 3);
  assert.deepEqual(results[2], {
    artifactKind: "delta",
    ok: true,
    platform: "darwin-arm64",
    status: 200,
    url: platforms["darwin-arm64"].deltas[0].patchUrl,
  });
});

test("probeChannelPlatformUrls reports a 404 HEAD response as unreachable", async () => {
  const stubFetch = () => Promise.resolve({ ok: false, status: 404 });
  const results = await probeChannelPlatformUrls({
    fetch: stubFetch,
    platforms: compressedPlatforms(),
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 404);
});

test("probeChannelPlatformUrls captures a per-platform network error", async () => {
  const stubFetch = () => Promise.reject(new Error("socket hang up"));
  const results = await probeChannelPlatformUrls({
    fetch: stubFetch,
    platforms: compressedPlatforms(),
  });
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, null);
  assert.match(results[0].error, SOCKET_HANG_UP_RE);
});

test("probeChannelPlatformUrls fails closed when the gzip manifest record is missing", async () => {
  const results = await probeChannelPlatformUrls({
    fetch: () => Promise.resolve({ ok: true, status: 200 }),
    platforms: PRODUCTION_MANIFEST_FIXTURE.channels.stable.platforms,
  });
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[1], {
    artifactKind: "archive",
    error: "the gzip archive manifest record is incomplete",
    ok: false,
    platform: "darwin-arm64",
    status: null,
    url: null,
  });
});

test("evaluateChannelSync blocks when the channel is behind the declared version (the 2026-07-10 incident shape)", async () => {
  const stubFetch = () =>
    Promise.resolve({
      json: () => Promise.resolve(PRODUCTION_MANIFEST_FIXTURE),
      ok: true,
      status: 200,
    });
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    },
  });
  assert.deepEqual(result.consistencyErrors, []);
  assert.equal(result.outcome.kind, "behind");
  assert.equal(result.outcome.channelVersion, "0.2.20");
  assert.equal(result.outcome.declaredVersion, "0.2.21");
});

test("evaluateChannelSync passes when the channel matches and every platform binary is reachable", async () => {
  const alignedManifest = cloneManifestWithVersion("0.2.21");
  const stubFetch = (_url, init) => {
    if (init?.method === "HEAD") {
      return Promise.resolve({ ok: true, status: 200 });
    }
    return Promise.resolve({
      json: () => Promise.resolve(alignedManifest),
      ok: true,
      status: 200,
    });
  };
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    },
  });
  assert.equal(result.outcome.kind, "match");
  assert.deepEqual(
    result.outcome.platformProbe.map((probe) => probe.ok),
    [true, true]
  );
});

test("evaluateChannelSync blocks when the channel matches but the binary artifact 404s", async () => {
  const alignedManifest = cloneManifestWithVersion("0.2.21");
  const stubFetch = (_url, init) => {
    if (init?.method === "HEAD") {
      return Promise.resolve({ ok: false, status: 404 });
    }
    return Promise.resolve({
      json: () => Promise.resolve(alignedManifest),
      ok: true,
      status: 200,
    });
  };
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    },
  });
  assert.equal(result.outcome.kind, "match");
  assert.deepEqual(
    result.outcome.platformProbe.map((probe) => probe.ok),
    [false, false]
  );
});

test("evaluateChannelSync warns without blocking when the channel is ahead of the declared version", async () => {
  const aheadManifest = cloneManifestWithVersion("0.2.22");
  const stubFetch = () =>
    Promise.resolve({
      json: () => Promise.resolve(aheadManifest),
      ok: true,
      status: 200,
    });
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    },
  });
  assert.equal(result.outcome.kind, "ahead");
  assert.equal(result.outcome.channelVersion, "0.2.22");
});

test("evaluateChannelSync fails closed when the manifest fetch fails", async () => {
  const stubFetch = () => Promise.reject(new Error("timeout"));
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    },
  });
  assert.equal(result.outcome.kind, "fetch-failed");
  assert.match(result.outcome.error.message, TIMEOUT_RE);
});

test("evaluateChannelSync reports a malformed manifest when channels.stable.version is missing", async () => {
  const stubFetch = () =>
    Promise.resolve({
      json: () => Promise.resolve({ channels: {}, schemaVersion: 1 }),
      ok: true,
      status: 200,
    });
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    },
  });
  assert.equal(result.outcome.kind, "malformed-manifest");
});

test("evaluateChannelSync rejects a matching manifest with no platform artifacts", async () => {
  const stubFetch = () =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          channels: { stable: { platforms: {}, version: "0.2.21" } },
          schemaVersion: 1,
        }),
      ok: true,
      status: 200,
    });
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.21" },
    },
  });

  assert.equal(result.outcome.kind, "malformed-manifest");
  assert.match(result.outcome.error.message, EMPTY_PLATFORM_MAP_RE);
});

test("evaluateChannelSync still reports cli/service inconsistency alongside a channel outcome", async () => {
  const stubFetch = () =>
    Promise.resolve({
      json: () => Promise.resolve(PRODUCTION_MANIFEST_FIXTURE),
      ok: true,
      status: 200,
    });
  const result = await evaluateChannelSync({
    fetch: stubFetch,
    manifestComponents: {
      cli: { packageVersion: "0.2.21" },
      service: { bundleVersion: "0.2.20" },
    },
  });
  assert.equal(result.consistencyErrors.length, 1);
});
