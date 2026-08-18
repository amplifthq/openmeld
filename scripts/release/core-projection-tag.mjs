import { createHash } from "node:crypto";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function deriveCoreProjectionTag(input) {
  if (!FULL_COMMIT_SHA_PATTERN.test(input.commitSha)) {
    throw new Error(
      "Core projection tag derivation refused: commitSha must be an exact 40-character lowercase commit SHA."
    );
  }
  const manifestSource = Buffer.isBuffer(input.releaseManifestSource)
    ? input.releaseManifestSource
    : Buffer.from(input.releaseManifestSource, "utf8");
  const digest = createHash("sha256")
    .update(input.commitSha)
    .update("\0")
    .update(manifestSource)
    .digest("hex");
  return `openmeld-release-${digest.slice(0, 40)}`;
}
