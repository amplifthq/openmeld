import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  inspectNpmCliArtifact,
  packNpmCliArtifact,
  verifyNpmCliConsumer,
} from "./npm-cli-artifact.mjs";

// Build once, then install the same npm tarball on each consumer platform.
const [mode, file] = process.argv.slice(2);
if (!(file && ["pack", "verify", "reject"].includes(mode))) {
  throw new Error(
    "Usage: node scripts/release/npm-cli-smoke.mjs pack|verify|reject <tarball>"
  );
}
const path = resolve(file);
if (mode === "pack") {
  const artifact = await packNpmCliArtifact();
  try {
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(artifact.path, path);
    console.log(`Packed ${artifact.manifest.version}: ${artifact.integrity}`);
  } finally {
    artifact.cleanup();
  }
} else if (mode === "reject") {
  const directory = mkdtempSync(
    resolve(tmpdir(), "openmeld-unsupported-node-")
  );
  try {
    execFileSync("tar", ["-xzf", path, "-C", directory]);
    const result = spawnSync(
      process.execPath,
      [resolve(directory, "package/dist/openmeld.js"), "--version"],
      { encoding: "utf8" }
    );
    if (
      result.status !== 1 ||
      !result.stderr?.includes("OpenMeld requires Node.js >=22 <26;") ||
      !result.stderr.includes("Install Node.js 24 (recommended)")
    ) {
      throw new Error(
        `Unsupported Node did not exit with the upgrade instruction: ${result.error ?? result.stderr}`
      );
    }
    console.log(result.stderr.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
} else {
  const artifact = await inspectNpmCliArtifact(path, {
    ...(process.env.RELEASE_SHA ? { gitHead: process.env.RELEASE_SHA } : {}),
  });
  await verifyNpmCliConsumer(path, artifact.manifest);
  console.log(
    `Verified ${process.platform}/${process.arch} ${process.version}: ${artifact.integrity}`
  );
}
