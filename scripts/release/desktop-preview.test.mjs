import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const schemaOutputs = ["desktop-client.js", "desktop-release.js"];
if (
  schemaOutputs.some(
    (name) =>
      !existsSync(
        fileURLToPath(
          new URL(`../../packages/schemas/dist/${name}`, import.meta.url)
        )
      )
  )
) {
  const pnpmArgs = ["--filter", "@openmeld/schemas", "build"];
  const packageManager = process.env.npm_execpath;
  const result = packageManager
    ? spawnSync(process.execPath, [packageManager, ...pnpmArgs], {
        stdio: "inherit",
      })
    : spawnSync("pnpm", pnpmArgs, {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
  if (result.status !== 0) {
    throw new Error("Desktop release tests require built schemas");
  }
}

const legacyPublicationDisabled =
  /Legacy unsigned Desktop publication is disabled/u;
const MISSING_RELEASE_CREDENTIALS = /openmeld-release\/prd/u;
const REJECTED_RELEASE_CREDENTIALS = /HTTP 401.*No Desktop object was written/u;
const INTERRUPTED_PUBLIC_DOWNLOAD =
  /connection terminated.*No pointer write was attempted.*same reviewed candidate/u;
const POINTER_NOT_STARTED = /pointer write has not started/u;
const UNTRUSTED_DESKTOP_REDIRECT = /Untrusted Desktop download redirect/u;
const DESKTOP_HASH_MISMATCH = /size\/hash mismatch/u;

test("legacy unsigned upload refuses publication before reading artifacts", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./desktop-preview.mjs", import.meta.url)),
      "upload",
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, legacyPublicationDisabled);
});

const {
  assertDesktopPromotionVersion,
  buildDesktopCandidateMetadata,
  buildDesktopPreviewMetadata,
  buildWranglerObjectPutArgs,
  DEFAULT_DOWNLOAD_PAGE_URL,
  DEFAULT_DOWNLOAD_URL,
  inspectDesktopCandidateCommand,
  resolveDesktopArtifactName,
  resolveDesktopReleaseCommand,
  readDesktopReleaseStatus,
  uploadDesktopCandidate,
  reuseDesktopCandidate,
  verifyDesktopPublicArtifact,
} = await import("./desktop-preview.mjs");

test("native candidate inspection preserves both streams and nonzero failure details", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "desktop-inspect-"));
  const script = path.join(directory, "native-tool.mjs");
  try {
    for (const [stdout, stderr, status] of [
      ["signature", "identity", 0],
      ["ticket validation failed", "", 66],
      ["validation detail", "tool diagnostic", 65],
    ]) {
      writeFileSync(
        script,
        `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${status});`
      );
      const args = [script];
      if (status === 0) {
        assert.equal(
          inspectDesktopCandidateCommand(process.execPath, args),
          stdout + stderr
        );
        continue;
      }
      assert.throws(
        () => inspectDesktopCandidateCommand(process.execPath, args),
        (error) => {
          assert.ok(error.message.includes(process.execPath));
          assert.ok(error.message.includes(script));
          assert.ok(error.message.includes(`Exit status: ${status}`));
          assert.ok(error.message.includes(`stdout:\n${stdout}`));
          if (stderr) {
            assert.ok(error.message.includes(`stderr:\n${stderr}`));
          }
          return true;
        }
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native candidate inspection reports a failed process launch", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "desktop-inspect-"));
  const command = path.join(directory, "missing-native-tool");
  try {
    assert.throws(
      () => inspectDesktopCandidateCommand(command, ["validate"]),
      (error) => {
        assert.ok(error.message.includes(command));
        assert.ok(error.message.includes("validate"));
        assert.ok(error.message.includes("ENOENT"));
        assert.equal(error.cause.code, "ENOENT");
        return true;
      }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("candidate upload retries verify complete immutable publication without overwriting it", async () => {
  const manifest = buildDesktopCandidateMetadata({
    version: "0.1.28",
    releaseSha: "b".repeat(40),
    sha256: "a".repeat(64),
    sizeBytes: 123,
    zip: {
      sha256: "c".repeat(64),
      sha512: Buffer.alloc(64).toString("base64"),
      sizeBytes: 456,
    },
  }).manifest;
  const verified = [];
  const verifyArtifact = (artifact) => {
    verified.push(artifact);
  };
  assert.equal(
    await reuseDesktopCandidate({
      manifest,
      readObject: () => null,
      verifyArtifact,
    }),
    false
  );
  assert.equal(verified.length, 0);
  assert.equal(
    await reuseDesktopCandidate({
      manifest,
      readObject: () => manifest,
      verifyArtifact,
    }),
    true
  );
  assert.deepEqual(
    verified.map(({ sha256, size }) => ({ sha256, size })),
    [
      { sha256: manifest.sha256, size: 123 },
      { sha256: manifest.zip.sha256, size: 456 },
    ]
  );
  verified.length = 0;
  await assert.rejects(
    reuseDesktopCandidate({
      manifest,
      readObject: () => ({ ...manifest, releaseSha: "d".repeat(40) }),
      verifyArtifact,
    })
  );
  assert.equal(verified.length, 0);
  await assert.rejects(
    reuseDesktopCandidate({
      manifest,
      readObject: () => manifest,
      verifyArtifact: () => {
        throw new Error("public download hash mismatch");
      },
    })
  );
  await assert.rejects(
    reuseDesktopCandidate({
      manifest,
      readObject: () => {
        throw new Error("R2 unavailable");
      },
      verifyArtifact,
    })
  );
});

test("Desktop status keeps absent and unreadable promoted pointers distinct", async () => {
  const candidateId = "a".repeat(64);
  const results = await readDesktopReleaseStatus({
    readObject: (key) => {
      if (key === "desktop/promoted.json") {
        return {
          schemaVersion: 1,
          candidate: candidateId,
          promotedAt: "2026-09-23T00:00:00.000Z",
        };
      }
      if (key === `desktop/candidates/${candidateId}/manifest.json`) {
        return {
          schemaVersion: 1,
          target: "production",
          platform: "macos-arm64",
          version: "0.1.9",
          releaseSha: "b".repeat(40),
          sha256: candidateId,
          sizeBytes: 42,
          zip: {
            sha256: "c".repeat(64),
            sha512: `${"A".repeat(86)}==`,
            sizeBytes: 42,
          },
        };
      }
      if (key === "desktop/promoted-windows-x64.json") {
        return null;
      }
      throw new Error("R2 read failed");
    },
  });
  assert.deepEqual(results, [
    {
      platform: "macos-arm64",
      state: "promoted",
      version: "0.1.9",
      sourceSha: "b".repeat(40),
      candidate: candidateId,
    },
    { platform: "windows-x64", state: "unpublished" },
    { platform: "windows-arm64", state: "unknown", reason: "R2 read failed" },
  ]);
});
const { checkDesktopPublisher, DEFAULT_R2_BUCKET_NAME } = await import(
  "./desktop-publisher.mjs"
);

test("Desktop publisher checks the named production token and exact bucket before touching an installer", async () => {
  const accountId = "a".repeat(32);
  const calls = [];
  const env = {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: "wrong-inherited-token",
    CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN: "release-token",
  };
  const publisherEnv = await checkDesktopPublisher({
    env,
    fetchBucket: (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization });
      return {
        ok: true,
        json: () => ({
          success: true,
          result: { name: DEFAULT_R2_BUCKET_NAME },
        }),
      };
    },
    write: () => undefined,
  });
  assert.deepEqual(calls, [
    {
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${DEFAULT_R2_BUCKET_NAME}`,
      authorization: "Bearer release-token",
    },
  ]);
  assert.equal(publisherEnv.CLOUDFLARE_API_TOKEN, "release-token");
  await assert.rejects(
    uploadDesktopCandidate({ env: {} }),
    MISSING_RELEASE_CREDENTIALS
  );
  await assert.rejects(
    checkDesktopPublisher({
      env,
      fetchBucket: () => ({ ok: false, status: 401 }),
    }),
    REJECTED_RELEASE_CREDENTIALS
  );
});

test("production Desktop packaging refuses a missing publisher credential before build or signing", () => {
  const env = { ...process.env };
  env.CLOUDFLARE_ACCOUNT_ID = undefined;
  env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN = undefined;
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../desktop/package-mode.mjs", import.meta.url)),
      "production-preview",
    ],
    { encoding: "utf8", env }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, MISSING_RELEASE_CREDENTIALS);
  assert.ok(!result.stdout.includes("electron-builder"));

  const root = mkdtempSync(path.join(tmpdir(), "openmeld-desktop-entry-"));
  try {
    cpSync(
      fileURLToPath(new URL("../", import.meta.url)),
      path.join(root, "scripts"),
      {
        recursive: true,
      }
    );
    const coldResult = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts/desktop/package-mode.mjs"),
        "production-preview",
      ],
      { cwd: root, encoding: "utf8", env }
    );
    assert.equal(coldResult.status, 1);
    assert.match(coldResult.stderr, MISSING_RELEASE_CREDENTIALS);
    const publisherCheck = spawnSync(
      process.execPath,
      [path.join(root, "scripts/release/desktop-publisher.mjs")],
      { cwd: root, encoding: "utf8", env }
    );
    assert.equal(publisherCheck.status, 1);
    assert.match(publisherCheck.stderr, MISSING_RELEASE_CREDENTIALS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an interrupted public download reports the failed URL before pointer publication", async () => {
  const pathname = "/desktop/download?candidate=reviewed";
  const lines = [];
  await assert.rejects(
    verifyDesktopPublicArtifact({
      pathname,
      sha256: "a".repeat(64),
      size: 155_004_884,
      fetchArtifact: () => {
        throw new Error("connection terminated");
      },
      write: (line) => lines.push(line),
    }),
    INTERRUPTED_PUBLIC_DOWNLOAD
  );
  assert.match(lines.join(""), POINTER_NOT_STARTED);
});

test("Desktop public verification follows the production CDN redirect and checks the complete bytes", async () => {
  const destination =
    "https://downloads.openmeld.ai/desktop/candidates/reviewed/desktop.dmg";
  const requests = [];
  await verifyDesktopPublicArtifact({
    pathname: "/desktop/download?candidate=reviewed",
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    size: 5,
    fetchArtifact: (url, options) => {
      requests.push(String(url));
      assert.equal(options.redirect, "manual");
      // Production returns HTTP 307 with Location on the download CDN.
      return requests.length === 1
        ? Response.redirect(destination, 307)
        : new Response("hello");
    },
    write: () => undefined,
  });
  assert.deepEqual(requests, [
    "https://openmeld.ai/desktop/download?candidate=reviewed",
    destination,
  ]);
});

test("Desktop public verification rejects untrusted redirects before fetching them", async () => {
  for (const destination of [
    "https://example.com/desktop/file.dmg",
    "http://downloads.openmeld.ai/desktop/file.dmg",
    "https://downloads.openmeld.ai/account",
  ]) {
    let requests = 0;
    await assert.rejects(
      verifyDesktopPublicArtifact({
        pathname: "/desktop/download?candidate=reviewed",
        sha256: "a".repeat(64),
        size: 5,
        fetchArtifact: () => {
          requests += 1;
          return Response.redirect(destination, 307);
        },
        write: () => undefined,
      }),
      UNTRUSTED_DESKTOP_REDIRECT
    );
    assert.equal(requests, 1);
  }
});

test("Desktop public verification still rejects altered bytes after a trusted redirect", async () => {
  let requests = 0;
  await assert.rejects(
    verifyDesktopPublicArtifact({
      pathname: "/desktop/download?candidate=reviewed",
      sha256:
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      size: 5,
      fetchArtifact: () =>
        ++requests === 1
          ? Response.redirect(
              "https://downloads.openmeld.ai/desktop/file.dmg",
              307
            )
          : new Response("world"),
      write: () => undefined,
    }),
    DESKTOP_HASH_MISMATCH
  );
});

test("Desktop promotion requires an increasing stable app version", () => {
  assert.doesNotThrow(() => assertDesktopPromotionVersion("0.1.1", null));
  assert.doesNotThrow(() => assertDesktopPromotionVersion("0.1.2", "0.1.1"));
  for (const version of ["0.1.1", "0.1.0", "0.1.2-preview.0", "../0.1.2"]) {
    assert.throws(() => assertDesktopPromotionVersion(version, "0.1.1"));
  }
});

test("candidate publication selects only hash-scoped keys and rejects path injection", () => {
  const input = {
    version: "0.1.0-preview.0",
    releaseSha: "b".repeat(40),
    sha256: "a".repeat(64),
    sizeBytes: 42,
  };
  const result = buildDesktopCandidateMetadata(input);
  assert.equal(
    result.manifestKey,
    `desktop/candidates/${input.sha256}/manifest.json`
  );
  assert.equal(
    result.objectKey,
    `desktop/candidates/${input.sha256}/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64.dmg`
  );
  assert.equal(
    result.downloadPath,
    `/desktop/download?candidate=${input.sha256}`
  );
  for (const invalid of [
    { version: "../update.json" },
    { objectKey: "desktop/update.json" },
    { sha256: "../private" },
    { target: "disposable" },
    { sizeBytes: 0 },
  ]) {
    assert.throws(() =>
      buildDesktopCandidateMetadata({ ...input, ...invalid })
    );
  }
});

test("Windows publication keeps the exact pnpm JS and literal argv, never a cmd shell", () => {
  const args = [
    "exec",
    "wrangler",
    "--file",
    "C:\\build with spaces\\中文 & %PATH%\\candidate.exe",
  ];
  const entry = "C:\\tools\\pnpm\\bin\\pnpm.cjs";
  assert.deepEqual(
    resolveDesktopReleaseCommand("pnpm", args, {
      platform: "win32",
      env: { npm_execpath: entry },
      execPath: "C:\\Node\\node.exe",
    }),
    { command: "C:\\Node\\node.exe", args: [entry, ...args] }
  );
  for (const npm_execpath of [undefined, "pnpm.cjs", "C:\\tools\\pnpm.cmd"]) {
    assert.throws(() =>
      resolveDesktopReleaseCommand("pnpm", args, {
        platform: "win32",
        env: { npm_execpath },
      })
    );
  }
  assert.deepEqual(
    resolveDesktopReleaseCommand("git", ["status"], { platform: "win32" }),
    { command: "git", args: ["status"] }
  );
});

test("Windows candidate metadata uses a platform-scoped installer and no fictional ZIP", () => {
  for (const platform of ["windows-x64", "windows-arm64"]) {
    const result = buildDesktopCandidateMetadata({
      platform,
      version: "0.1.4",
      releaseSha: "b".repeat(40),
      sha256: "a".repeat(64),
      sizeBytes: 42,
      windows: {
        sha512: `${"A".repeat(86)}==`,
        publisherName: "Fixture Publisher",
      },
    });
    assert.equal(result.artifactName, `OpenMeld-Desktop-0.1.4-${platform}.exe`);
    assert.equal(result.zipObjectKey, null);
    assert.equal(result.zipDownloadPath, null);
    assert.equal(result.manifest.windows.publisherName, "Fixture Publisher");
  }
});

test("resolves the unsigned Apple silicon Desktop artifact name", () => {
  assert.equal(
    resolveDesktopArtifactName("0.1.0-preview.0"),
    "OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg"
  );
});

test("builds the Desktop update manifest consumed by the app", () => {
  assert.deepEqual(
    buildDesktopPreviewMetadata({
      sha256: "abc123",
      sizeBytes: 42,
      version: "0.1.0-preview.0",
    }),
    {
      latestVersion: "0.1.0-preview.0",
      minimumSupportedVersion: "0.1.0-preview.0",
      downloadPageUrl: DEFAULT_DOWNLOAD_PAGE_URL,
      message: null,
      macosArm64: {
        artifactName:
          "OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
        objectKey:
          "desktop/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
        url: DEFAULT_DOWNLOAD_URL,
        version: "0.1.0-preview.0",
        sha256: "abc123",
        sizeBytes: 42,
      },
    }
  );
});

test("builds remote Wrangler R2 upload arguments with release headers", () => {
  assert.deepEqual(
    buildWranglerObjectPutArgs({
      bucketName: DEFAULT_R2_BUCKET_NAME,
      cacheControl: "public, max-age=31536000, immutable",
      contentDisposition:
        'attachment; filename="OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg"',
      contentType: "application/x-apple-diskimage",
      filePath:
        "/repo/clients/desktop/dist/release/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
      objectKey:
        "desktop/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
    }),
    [
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      "openmeld-desktop-downloads-prod/desktop/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
      "--file",
      "/repo/clients/desktop/dist/release/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
      "--content-type",
      "application/x-apple-diskimage",
      "--cache-control",
      "public, max-age=31536000, immutable",
      "--force",
      "--remote",
      "--content-disposition",
      'attachment; filename="OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg"',
    ]
  );
});
