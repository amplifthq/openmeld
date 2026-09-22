import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertNpmRuntimeDependencies,
  inspectNpmCliArtifact,
  packNpmCliArtifact,
  prepareNpmCliArtifact,
  verifyPublishedNpmCliArtifact,
} from "./npm-cli-artifact.mjs";

const INVALID_DEPENDENCY = /non-portable/u;
const INVALID_CONTENT = /missing|binary artifacts|does not match/u;
const INVALID_INTEGRITY = /bytes do not match/u;

function fixture(dependencies = {}) {
  const root = mkdtempSync(join(tmpdir(), "openmeld npm fixture "));
  const cli = join(root, "clients/openmeld-cli");
  mkdirSync(join(cli, "dist"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ private: true, packageManager: "pnpm@10.30.0" })
  );
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - clients/*\ncatalog:\n  zod: 4.6.5\n"
  );
  const manifest = {
    name: "openmeld",
    version: "0.0.1",
    type: "module",
    bin: { openmeld: "dist/openmeld.js" },
    files: ["README.md", "dist"],
    dependencies,
    devDependencies: { "not-a-runtime-package": "workspace:*" },
    openmeld: { minRequiredCliVersion: "0.0.1" },
  };
  // Do not resolve synthetic dev workspace dependencies during fixture packing.
  manifest.devDependencies = undefined;
  writeFileSync(join(cli, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(cli, "README.md"), "Fixture CLI\n");
  writeFileSync(
    join(cli, "dist/openmeld.js"),
    "#!/usr/bin/env node\nif(!process.env.OPENMELD_HOME?.startsWith(process.env.HOME))process.exit(2);console.log('0.0.1');\n"
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "add",
    "."
  );
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "fixture"
  );
  return {
    root,
    cli,
    manifest,
    gitHead: git("rev-parse", "HEAD"),
    cleanup: () =>
      rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

test("rejects development-only references in every installed dependency field, not devDependencies", () => {
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const specifier of [
      "catalog:",
      "catalog:runtime",
      "workspace:*",
      "file:../local",
      "link:../local",
    ]) {
      assert.throws(
        () => assertNpmRuntimeDependencies({ [field]: { zod: specifier } }),
        INVALID_DEPENDENCY
      );
    }
  }
  assert.doesNotThrow(() =>
    assertNpmRuntimeDependencies({
      dependencies: { zod: "4.6.5" },
      devDependencies: { internal: "workspace:*" },
    })
  );
});

test("packs expanded catalogs and exact source identity without editing source metadata", async () => {
  const source = fixture({ zod: "catalog:" });
  let artifact;
  try {
    artifact = await packNpmCliArtifact({ cwd: source.root });
    assert.equal(artifact.manifest.dependencies.zod, "4.6.5");
    assert.equal(artifact.manifest.gitHead, source.gitHead);
    assert.equal(
      JSON.parse(readFileSync(join(source.cli, "package.json"), "utf8"))
        .dependencies.zod,
      "catalog:"
    );
    await assert.rejects(
      inspectNpmCliArtifact(artifact.path, { version: "0.0.2" }),
      INVALID_CONTENT
    );
    await assert.rejects(
      inspectNpmCliArtifact(artifact.path, { gitHead: "a".repeat(40) }),
      INVALID_CONTENT
    );
  } finally {
    artifact?.cleanup();
    source.cleanup();
  }
});

test("installs the exact tarball outside the workspace and verifies downloaded release bytes", async () => {
  const source = fixture();
  let artifact;
  try {
    artifact = await prepareNpmCliArtifact({ cwd: source.root });
    const bytes = readFileSync(artifact.path);
    const input = {
      metadata: {
        dist: {
          integrity: artifact.integrity,
          tarball: "https://registry.npmjs.org/openmeld/-/openmeld-0.0.1.tgz",
        },
      },
      target: {
        version: "0.0.1",
        headSha: source.gitHead,
        minRequiredCliVersion: "0.0.1",
        npmIntegrity: artifact.integrity,
      },
      fetch: () => Promise.resolve(new Response(bytes)),
    };
    await verifyPublishedNpmCliArtifact(input);
    await assert.rejects(
      verifyPublishedNpmCliArtifact({
        ...input,
        target: { ...input.target, npmIntegrity: `sha512-${"A".repeat(86)}==` },
      }),
      INVALID_INTEGRITY
    );
  } finally {
    artifact?.cleanup();
    if (artifact) {
      assert.equal(existsSync(artifact.path), false);
    }
    source.cleanup();
  }
});

test("rejects a pack that has no entrypoint or accidentally includes standalone binaries", async () => {
  const source = fixture();
  try {
    mkdirSync(join(source.cli, "dist/binary"));
    writeFileSync(join(source.cli, "dist/binary/openmeld"), "not an npm asset");
    await assert.rejects(
      packNpmCliArtifact({ cwd: source.root }),
      INVALID_CONTENT
    );
    rmSync(join(source.cli, "dist"), { recursive: true });
    await assert.rejects(
      packNpmCliArtifact({ cwd: source.root }),
      INVALID_CONTENT
    );
  } finally {
    source.cleanup();
  }
});
