import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNpmRuntimeDependencies,
  readNpmCliArtifact,
} from "./npm-cli-artifact.mjs";

// Historical receiver alignment proves immutable publication identity. It does
// not certify portability or replace any admission/publication consumer check.
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
export async function verifyStableNpmIdentity(input) {
  const request = input.fetch ?? fetch;
  const response = await request(
    `https://registry.npmjs.org/openmeld/${input.version}`,
    { signal: AbortSignal.timeout(60_000), redirect: "error" }
  );
  if (!response.ok) {
    throw new Error(
      `Stable npm identity is unreadable: HTTP ${response.status}.`
    );
  }
  const metadata = await response.json();
  if (
    metadata.name !== "openmeld" ||
    metadata.version !== input.version ||
    metadata.gitHead !== input.sourceSha ||
    !SHA512_INTEGRITY.test(metadata.dist?.integrity ?? "") ||
    metadata.dist?.tarball !==
      `https://registry.npmjs.org/openmeld/-/openmeld-${input.version}.tgz`
  ) {
    throw new Error(
      "Stable npm metadata does not match its immutable tag/source."
    );
  }
  const archive = await request(metadata.dist.tarball, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!archive.ok) {
    throw new Error(
      `Stable npm tarball is unreadable: HTTP ${archive.status}.`
    );
  }
  const directory = mkdtempSync(
    join(tmpdir(), "openmeld-stable-npm-identity-")
  );
  try {
    const file = join(directory, "openmeld.tgz");
    writeFileSync(file, Buffer.from(await archive.arrayBuffer()));
    const { manifest, integrity } = await readNpmCliArtifact(file);
    if (
      integrity !== metadata.dist.integrity ||
      manifest.name !== "openmeld" ||
      manifest.version !== input.version ||
      (manifest.gitHead !== undefined && manifest.gitHead !== input.sourceSha)
    ) {
      throw new Error(
        "Stable npm tarball identity or integrity does not match."
      );
    }
    let portabilityIssue = null;
    try {
      assertNpmRuntimeDependencies(manifest);
    } catch (error) {
      portabilityIssue = error.message;
    }
    return {
      action: "SKIP",
      criterion: "immutable-historical-npm-identity",
      reason: `Stable openmeld@${input.version} matches its immutable tag and registry integrity; consumer portability is not certified by receiver alignment.`,
      version: input.version,
      sourceSha: input.sourceSha,
      integrity,
      portabilityIssue,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
