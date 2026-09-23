import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { CORE_RECEIVER_INCIDENT as incident } from "./core-receiver-reconciliation.mjs";
import { verifyCurrentCliProjectionAlignment } from "./deploy-core-current-cli-projection.mjs";
import { inspectNpmCliArtifact } from "./npm-cli-artifact.mjs";
import { verifyStableNpmIdentity } from "./stable-npm-identity.mjs";

const INVALID = /identity|integrity|metadata|unreadable|Unexpected|alignment/u;
const NON_PORTABLE = /non-portable/u;
const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function fixture(version = "0.3.217") {
  const directory = mkdtempSync(
    path.join(tmpdir(), "openmeld-historical-npm-")
  );
  mkdirSync(path.join(directory, "package"));
  const manifest = readFixture("npm-0.3.217-historical-manifest.json").manifest;
  manifest.version = version;
  writeFileSync(
    path.join(directory, "package/package.json"),
    JSON.stringify(manifest)
  );
  const file = path.join(directory, "openmeld.tgz");
  execFileSync("tar", ["-czf", file, "-C", directory, "package"]);
  const archive = readFileSync(file);
  const metadata = {
    ...manifest,
    gitHead: incident.stableSourceSha,
    dist: {
      tarball: "https://registry.npmjs.org/openmeld/-/openmeld-0.3.217.tgz",
      integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    },
  };
  const channel = readFixture("cli-channel-0.3.217.json");
  const binary = Buffer.from(
    "Captured channel shape with isolated fixture artifact bytes."
  );
  const compressed = gzipSync(binary);
  for (const artifacts of [
    channel.channels.stable.platforms,
    channel.channels.stable.service?.platforms,
  ]) {
    if (!artifacts) {
      continue;
    }
    Object.assign(artifacts["darwin-arm64"], {
      sha256: createHash("sha256").update(binary).digest("hex"),
      sizeBytes: binary.length,
      archiveSha256: createHash("sha256").update(compressed).digest("hex"),
      archiveSizeBytes: compressed.length,
    });
  }
  const captured = readFixture("core-receiver-35752925516.json");
  const options = {};
  const request = (url, init) => {
    if (String(url).endsWith("/openmeld/0.3.217")) {
      return new Response(
        options.malformed ? "invalid" : JSON.stringify(metadata),
        { status: options.registryStatus ?? 200 }
      );
    }
    if (String(url).endsWith(".tgz")) {
      return new Response(options.corrupt ? Buffer.from("corrupt") : archive, {
        status: options.archiveStatus ?? 200,
      });
    }
    if (String(url).endsWith("manifest.json")) {
      return Response.json(channel);
    }
    if (init?.method === "HEAD") {
      return new Response(null, {
        headers: { "content-length": String(binary.length) },
      });
    }
    if (String(url).endsWith(".gz")) {
      return new Response(compressed);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return {
    file,
    metadata,
    options,
    channel,
    captured,
    request,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    alignment: () =>
      verifyCurrentCliProjectionAlignment({
        channelVersion: "0.3.217",
        tagName: "v0.3.217",
        tagCommitSha: incident.stableSourceSha,
        expectedCoreTag: incident.projectionTag,
        releaseManifest: {
          components: {
            cli: { packageVersion: "0.3.217" },
            service: { bundleVersion: "0.3.217" },
          },
        },
        adapters: {
          fetch: request,
          runCommand: ({ args }) => {
            if (args.includes("deployments")) {
              return {
                status: 0,
                stdout: JSON.stringify(captured.deployments),
              };
            }
            if (args.includes("versions")) {
              return { status: 0, stdout: JSON.stringify([captured.version]) };
            }
            throw new Error("Unexpected non-read-only command");
          },
        },
      }),
  };
}

test("historical catalog dependency permits receiver identity alignment but remains forbidden for publication", async () => {
  const f = fixture();
  try {
    const result = await f.alignment();
    assert.equal(result.binary.action, "SKIP");
    assert.equal(result.core.action, "SKIP");
    assert.match(result.npm.portabilityIssue, NON_PORTABLE);
    // Identical bytes remain rejected by the candidate/publication artifact inspector.
    await assert.rejects(inspectNpmCliArtifact(f.file), NON_PORTABLE);
    const candidate = fixture("0.3.218");
    try {
      await assert.rejects(
        inspectNpmCliArtifact(candidate.file, { version: "0.3.218" }),
        NON_PORTABLE
      );
    } finally {
      candidate.cleanup();
    }
    for (const change of [
      () => {
        f.captured.version.annotations["workers/tag"] = "wrong";
      },
      () => {
        f.channel.channels.stable.version = "0.3.216";
      },
    ]) {
      change();
      await assert.rejects(f.alignment(), INVALID);
      f.captured.version.annotations["workers/tag"] = incident.projectionTag;
    }
  } finally {
    f.cleanup();
  }
});

test("unreadable registry and wrong source or archive integrity cannot certify a historical package", async () => {
  for (const change of [
    (f) => {
      f.options.registryStatus = 404;
    },
    (f) => {
      f.options.registryStatus = 503;
    },
    (f) => {
      f.options.archiveStatus = 404;
    },
    (f) => {
      f.options.malformed = true;
    },
    (f) => {
      f.options.corrupt = true;
    },
    (f) => {
      f.metadata.gitHead = "a".repeat(40);
    },
    (f) => {
      f.metadata.dist.integrity = `sha512-${"A".repeat(86)}==`;
    },
  ]) {
    const f = fixture();
    try {
      change(f);
      await assert.rejects(
        verifyStableNpmIdentity({
          version: "0.3.217",
          sourceSha: incident.stableSourceSha,
          fetch: f.request,
        })
      );
    } finally {
      f.cleanup();
    }
  }
});
