import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  cliBinaryDeltaPatchSchema,
  cliBinaryManifestSchema,
} from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";

const BLOCK_SIZE_BYTES = 4096;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_COMPLETE_ARCHIVE_RATIO = 0.8;

export function createCliBinaryDelta(input) {
  const baseSha256 = hashBytesSha256(input.baseBytes);
  const targetSha256 = hashBytesSha256(input.targetBytes);
  const payload = cliBinaryDeltaPatchSchema.parse({
    baseSha256,
    baseSizeBytes: input.baseBytes.byteLength,
    blockSizeBytes: BLOCK_SIZE_BYTES,
    patchFormat: "block-ranges-v1",
    schemaVersion: 1,
    segments: buildChangedBlockSegments({
      baseBytes: input.baseBytes,
      targetBytes: input.targetBytes,
    }),
    targetSha256,
    targetSizeBytes: input.targetBytes.byteLength,
  });
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const patchBytes = gzipSync(payloadBytes, { level: 9 });
  const safeFromVersion = input.fromVersion.replace(/[^0-9A-Za-z.-]+/gu, "-");
  const artifactName = `${input.artifactName}-delta-from-${safeFromVersion}.gz`;
  const outFile = `${input.outFile}-delta-from-${safeFromVersion}.gz`;
  writeFileSync(outFile, patchBytes);

  return {
    artifactName,
    manifest: {
      fromSha256: baseSha256,
      fromSizeBytes: input.baseBytes.byteLength,
      fromVersion: input.fromVersion,
      patchCompression: "gzip",
      patchFormat: "block-ranges-v1",
      patchPayloadSizeBytes: payloadBytes.byteLength,
      patchSha256: hashBytesSha256(patchBytes),
      patchSizeBytes: patchBytes.byteLength,
      patchUrl: `${input.downloadBaseUrl}/${artifactName}`,
    },
    outFile,
  };
}

export async function resolveCliBinaryDeltaForRelease(input) {
  try {
    const previous = await fetchPreviousCliBinaryRelease({
      downloadBaseUrl: input.downloadBaseUrl,
      fetchImpl: input.fetchImpl,
      manifestObjectKey: input.manifestObjectKey,
      platform: input.built.platform,
      targetVersion: input.built.version,
    });
    if (!previous) {
      process.stdout.write(
        "[release:cli-binary] No previous CLI version is available for a delta.\n"
      );
      return null;
    }
    const delta = createCliBinaryDelta({
      artifactName: input.built.artifactName,
      baseBytes: previous.bytes,
      downloadBaseUrl: input.downloadBaseUrl,
      fromVersion: previous.version,
      outFile: input.built.outFile,
      targetBytes: readFileSync(input.built.outFile),
    });
    if (
      delta.manifest.patchSizeBytes >=
      input.archiveSizeBytes * MAX_COMPLETE_ARCHIVE_RATIO
    ) {
      rmSync(delta.outFile, { force: true });
      process.stdout.write(
        `[release:cli-binary] Delta from ${previous.version} is not materially smaller than the complete archive; skipping it.\n`
      );
      return null;
    }
    return delta;
  } catch (error) {
    process.stdout.write(
      `[release:cli-binary] Could not build a delta; the complete signed archive remains available. ${error instanceof Error ? error.message : String(error)}\n`
    );
    return null;
  }
}

function buildChangedBlockSegments(input) {
  const segments = [];
  let changedStart = null;
  for (
    let offset = 0;
    offset < input.targetBytes.byteLength;
    offset += BLOCK_SIZE_BYTES
  ) {
    const end = Math.min(
      offset + BLOCK_SIZE_BYTES,
      input.targetBytes.byteLength
    );
    const targetBlock = input.targetBytes.subarray(offset, end);
    const baseBlock = input.baseBytes.subarray(
      offset,
      Math.min(end, input.baseBytes.byteLength)
    );
    const changed = !targetBlock.equals(baseBlock);
    if (changed && changedStart === null) {
      changedStart = offset;
    }
    if (!(changed || changedStart === null)) {
      segments.push({
        dataBase64: input.targetBytes
          .subarray(changedStart, offset)
          .toString("base64"),
        offset: changedStart,
      });
      changedStart = null;
    }
  }
  if (changedStart !== null) {
    segments.push({
      dataBase64: input.targetBytes.subarray(changedStart).toString("base64"),
      offset: changedStart,
    });
  }
  return segments;
}

async function fetchPreviousCliBinaryRelease(input) {
  const manifestUrl = new URL(
    `/${input.manifestObjectKey}`,
    input.downloadBaseUrl
  ).toString();
  const manifestResponse = await input.fetchImpl(manifestUrl, {
    method: "GET",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!manifestResponse.ok) {
    throw new Error(
      `previous CLI manifest returned HTTP ${manifestResponse.status}`
    );
  }
  const manifest = cliBinaryManifestSchema.parse(await manifestResponse.json());
  const stable = manifest.channels.stable;
  if (stable.version === input.targetVersion) {
    return null;
  }
  const release = stable.platforms[input.platform];
  if (!release) {
    throw new Error(`previous CLI manifest is missing ${input.platform}`);
  }
  const compressed =
    release.archiveFormat === "gzip" &&
    release.archiveUrl &&
    release.archiveSha256 &&
    release.archiveSizeBytes;
  const artifactResponse = await input.fetchImpl(
    compressed ? release.archiveUrl : release.url,
    {
      method: "GET",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );
  if (!artifactResponse.ok) {
    throw new Error(
      `previous CLI artifact returned HTTP ${artifactResponse.status}`
    );
  }
  const downloadBytes = Buffer.from(await artifactResponse.arrayBuffer());
  if (compressed) {
    assertBufferMetadata({
      bytes: downloadBytes,
      expectedSha256: release.archiveSha256,
      expectedSizeBytes: release.archiveSizeBytes,
      label: "previous CLI archive",
    });
  }
  const bytes = compressed
    ? gunzipSync(downloadBytes, { maxOutputLength: release.sizeBytes })
    : downloadBytes;
  assertBufferMetadata({
    bytes,
    expectedSha256: release.sha256,
    expectedSizeBytes: release.sizeBytes,
    label: "previous CLI binary",
  });
  return { bytes, version: stable.version };
}

function assertBufferMetadata(input) {
  if (input.bytes.byteLength !== input.expectedSizeBytes) {
    throw new Error(
      `${input.label} size mismatch: expected ${input.expectedSizeBytes}, received ${input.bytes.byteLength}`
    );
  }
  const sha256 = hashBytesSha256(input.bytes);
  if (sha256 !== input.expectedSha256) {
    throw new Error(
      `${input.label} sha256 mismatch: expected ${input.expectedSha256}, received ${sha256}`
    );
  }
}

function hashBytesSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
