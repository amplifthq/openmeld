import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  inspectNpmCliArtifact,
  packNpmCliArtifact,
  verifyNpmCliConsumer,
} from "./npm-cli-artifact.mjs";

// Build once, then install the same npm tarball on each consumer platform.
const [mode, file] = process.argv.slice(2);
if (!(file && ["pack", "verify"].includes(mode))) {
  throw new Error(
    "Usage: node scripts/release/npm-cli-smoke.mjs pack|verify <tarball>"
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
} else {
  const artifact = await inspectNpmCliArtifact(path, {
    ...(process.env.RELEASE_SHA ? { gitHead: process.env.RELEASE_SHA } : {}),
  });
  await verifyNpmCliConsumer(path, artifact.manifest);
  console.log(
    `Verified ${process.platform}/${process.arch} ${process.version}: ${artifact.integrity}`
  );
}
