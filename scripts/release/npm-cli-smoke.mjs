import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  inspectNpmCliArtifact,
  NPM_ARTIFACT_TAR,
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
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `integrity=${artifact.integrity}\n`
      );
    }
    console.log(`Packed ${artifact.manifest.version}: ${artifact.integrity}`);
  } finally {
    artifact.cleanup();
  }
} else if (mode === "reject") {
  const directory = mkdtempSync(
    resolve(tmpdir(), "openmeld-unsupported-node-")
  );
  try {
    execFileSync(NPM_ARTIFACT_TAR, ["-xzf", path, "-C", directory]);
    const result = spawnSync(
      process.execPath,
      [resolve(directory, "package/dist/openmeld.js"), "--version"],
      { encoding: "utf8" }
    );
    if (
      result.status !== 1 ||
      !result.stderr?.includes(
        "OpenMeld requires Node.js 22.x || 24.x || 25.x;"
      ) ||
      !result.stderr.includes("Install Node.js 24 (recommended)")
    ) {
      throw new Error(
        `Unsupported Node did not exit with the upgrade instruction: ${result.error ?? result.stderr}`
      );
    }
    const jsonResult = spawnSync(
      process.execPath,
      [
        resolve(directory, "package/dist/openmeld.js"),
        "service",
        "status",
        "--json",
      ],
      { encoding: "utf8" }
    );
    const envelope = JSON.parse(jsonResult.stdout || "null");
    if (
      jsonResult.status !== 1 ||
      envelope?.schemaVersion !== 1 ||
      envelope.type !== "error" ||
      envelope.error?.code !== "cli.node_unsupported" ||
      !envelope.error.message.includes("Install Node.js 24")
    ) {
      throw new Error(
        "Unsupported Node did not preserve the desktop JSON error contract"
      );
    }
    console.log("Verified unsupported Node JSON startup error");
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
