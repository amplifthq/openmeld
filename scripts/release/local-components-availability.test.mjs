import assert from "node:assert/strict";
import test from "node:test";
import { cliBinaryManifestSchema } from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";
import {
  buildLocalComponentsAvailabilityCatalog,
  describeLocalComponentsAvailabilityCatalog,
  readLocalComponentsAvailabilityCatalog,
} from "./local-components-availability.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const NETWORK_FAILURE_PATTERN = /network unavailable/u;
const HTTP_FAILURE_PATTERN = /HTTP 503/u;

const policy = {
  cli: {
    packageVersion: "0.3.232",
    commandContractVersion: "cli-v1",
    updatePolicy: "available",
    reason: "Fixture.",
  },
  service: {
    bundleVersion: "0.3.232",
    bundleHash: null,
    runtimeContractEpoch: "epoch-v1",
    serviceContractVersion: "service-v1",
    updatePolicy: "available",
    reason: "Fixture.",
  },
};
const release = {
  schemaVersion: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  components: {
    ...policy,
    skills: {
      bundleHash: null,
      skillContractVersion: "skills-v1",
      skillIds: [],
      updatePolicy: "ok",
      reason: "Fixture.",
    },
  },
};
function manifest(version, platform, componentPolicy) {
  const artifact = {
    url: "https://openmeld.ai/cli/download/fixture",
    sha256: "a".repeat(64),
    sizeBytes: 100,
  };
  if (platform.startsWith("windows-")) {
    artifact.windows = {
      mode: "internal-unsigned-preview",
      processHelper: { ...artifact },
    };
  }
  return {
    schemaVersion: 1,
    channels: {
      stable: {
        version,
        platforms: { [platform]: artifact },
        ...(componentPolicy ? { componentPolicy } : {}),
      },
    },
  };
}
const previewPolicy = {
  cli: { ...policy.cli, packageVersion: "0.3.231" },
  service: { ...policy.service, bundleVersion: "0.3.231" },
};
const stable = manifest("0.3.232", "darwin-arm64");
const preview = manifest("0.3.231", "windows-x64", previewPolicy);

test("catalogue preserves exact channel and platform availability", () => {
  const catalog = buildLocalComponentsAvailabilityCatalog({
    releaseManifest: release,
    stableManifest: stable,
    previewManifest: preview,
  });
  assert.deepEqual(
    catalog.entries.map((x) => [
      x.channel,
      x.platform,
      x.policy.cli.packageVersion,
    ]),
    [
      ["stable", "darwin-arm64", "0.3.232"],
      ["windows-preview", "windows-x64", "0.3.231"],
    ]
  );
  const descriptor = describeLocalComponentsAvailabilityCatalog(catalog);
  assert.match(descriptor.sha256, SHA256_PATTERN);
  assert.deepEqual(
    JSON.parse(JSON.parse(descriptor.define.split(":").slice(1).join(":"))),
    catalog
  );
});
test("legacy preview never borrows global stable policy", () => {
  const catalog = buildLocalComponentsAvailabilityCatalog({
    releaseManifest: release,
    stableManifest: stable,
    previewManifest: manifest("0.3.232", "windows-x64"),
  });
  assert.equal(catalog.entries.length, 1);
});
test("legacy stable mismatch remains unavailable", () => {
  assert.equal(
    buildLocalComponentsAvailabilityCatalog({
      releaseManifest: release,
      stableManifest: manifest("0.3.231", "darwin-arm64"),
    }).entries.length,
    0
  );
});
test("policy must match each selected artifact, including retained Service", () => {
  const retained = manifest("0.3.232", "darwin-arm64", {
    cli: { ...policy.cli },
    service: { ...policy.service, bundleVersion: "0.3.231" },
  });
  assert.equal(cliBinaryManifestSchema.safeParse(retained).success, false);
  retained.channels.stable.service = {
    version: "0.3.231",
    platforms: retained.channels.stable.platforms,
  };
  assert.equal(cliBinaryManifestSchema.safeParse(retained).success, true);
  retained.channels.stable.componentPolicy.cli.packageVersion = "0.3.230";
  assert.equal(cliBinaryManifestSchema.safeParse(retained).success, false);
});
test("optional404 is absence, malformed and network failures abort catalog compilation", async () => {
  const input = { releaseManifest: release, stableManifest: stable };
  assert.equal(
    (
      await readLocalComponentsAvailabilityCatalog({
        ...input,
        fetch: async () => new Response(null, { status: 404 }),
      })
    ).entries.length,
    1
  );
  await assert.rejects(
    readLocalComponentsAvailabilityCatalog({
      ...input,
      fetch: async () => new Response("{}", { status: 200 }),
    })
  );
  await assert.rejects(
    readLocalComponentsAvailabilityCatalog({
      ...input,
      fetch: () => Promise.reject(new Error("network unavailable")),
    }),
    NETWORK_FAILURE_PATTERN
  );
  await assert.rejects(
    readLocalComponentsAvailabilityCatalog({
      ...input,
      fetch: async () => new Response(null, { status: 503 }),
    }),
    HTTP_FAILURE_PATTERN
  );
});
test("uses the receiver stable snapshot without a second mutable stable read", async () => {
  const urls = [];
  await readLocalComponentsAvailabilityCatalog({
    releaseManifest: release,
    stableManifest: stable,
    fetch: (url) => {
      urls.push(url);
      return Promise.resolve(Response.json(preview));
    },
  });
  assert.deepEqual(urls, [
    "https://openmeld.ai/cli/manifest.json?channel=windows-preview",
  ]);
});
