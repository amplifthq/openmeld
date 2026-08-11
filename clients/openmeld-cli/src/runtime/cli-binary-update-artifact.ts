import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { CliBinaryReleaseInfo } from "../config/version-state";
import { reconstructCliBinaryDelta } from "./cli-binary-delta";

type CommandResult = {
  code: number;
  stderr: string;
  stdout: string;
};

const HARDENED_RUNTIME_FLAG_RE = /flags=.*runtime/iu;
const SIGNING_TIMESTAMP_RE = /^Timestamp=/mu;

type CliBinaryDelta = NonNullable<CliBinaryReleaseInfo["deltas"]>[number];
type CliBinaryFullUpdatePlan =
  | {
      downloadSha256: string;
      downloadSizeBytes: number;
      downloadUrl: string;
      transport: "archive";
    }
  | {
      downloadSha256: string;
      downloadSizeBytes: number;
      downloadUrl: string;
      transport: "raw";
    };

export type CliBinaryUpdatePlan =
  | CliBinaryFullUpdatePlan
  | {
      baseBytes: Buffer;
      delta: CliBinaryDelta;
      downloadSizeBytes: number;
      transport: "delta";
    };

export async function resolveCliBinaryUpdatePlan(input: {
  baseBinaryPath: string;
  currentVersion: string;
  onDeltaFallback: (error: Error) => void;
  release: CliBinaryReleaseInfo;
}): Promise<CliBinaryUpdatePlan> {
  const fullDownloadPlan = resolveFullCliBinaryUpdatePlan(input.release);
  const versionDeltas = input.release.deltas?.filter(
    (candidate) => candidate.fromVersion === input.currentVersion
  );
  if (!versionDeltas?.length) {
    return fullDownloadPlan;
  }

  let baseBytes: Buffer;
  try {
    baseBytes = await readFile(input.baseBinaryPath);
  } catch (error) {
    input.onDeltaFallback(toError(error));
    return fullDownloadPlan;
  }
  const baseSha256 = createHash("sha256").update(baseBytes).digest("hex");
  const delta = versionDeltas.find(
    (candidate) =>
      candidate.fromSizeBytes === baseBytes.byteLength &&
      candidate.fromSha256.toLowerCase() === baseSha256
  );
  if (!delta) {
    return fullDownloadPlan;
  }
  return {
    baseBytes,
    delta,
    downloadSizeBytes: delta.patchSizeBytes,
    transport: "delta",
  };
}

export async function downloadCliBinaryUpdateArtifact(input: {
  downloadTimeoutMs: number;
  fetchImpl: typeof fetch;
  onDeltaFallback: (error: Error) => void;
  plan: CliBinaryUpdatePlan;
  release: CliBinaryReleaseInfo;
}): Promise<Buffer> {
  if (input.plan.transport === "delta") {
    try {
      return await downloadCliBinaryDelta({
        ...input,
        baseBytes: input.plan.baseBytes,
        delta: input.plan.delta,
      });
    } catch (error) {
      input.onDeltaFallback(toError(error));
    }
    return downloadFullCliBinaryArtifact({
      ...input,
      plan: resolveFullCliBinaryUpdatePlan(input.release),
    });
  }
  return downloadFullCliBinaryArtifact({ ...input, plan: input.plan });
}

export async function verifyCliBinaryCodeSignature(input: {
  artifactPath: string;
  release: CliBinaryReleaseInfo;
  runCommand: (command: string, args: string[]) => Promise<CommandResult>;
}): Promise<void> {
  const { codeIdentifier, teamIdentifier } = input.release;
  if (!(codeIdentifier && teamIdentifier)) {
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error("signed OpenMeld CLI verification requires macOS");
  }

  const verification = await input.runCommand("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--verbose=2",
    input.artifactPath,
  ]);
  if (verification.code !== 0) {
    throw new Error(
      `binary code signature verification failed: ${commandFailureDetails(verification)}`
    );
  }

  const inspection = await input.runCommand("/usr/bin/codesign", [
    "--display",
    "--verbose=4",
    input.artifactPath,
  ]);
  if (inspection.code !== 0) {
    throw new Error(
      `binary code signature inspection failed: ${commandFailureDetails(inspection)}`
    );
  }
  const details = `${inspection.stdout}\n${inspection.stderr}`;
  for (const expected of [
    `Identifier=${codeIdentifier}`,
    `TeamIdentifier=${teamIdentifier}`,
    "Authority=Developer ID Application:",
  ]) {
    if (!details.includes(expected)) {
      throw new Error(
        `binary code signature is missing expected identity: ${expected}`
      );
    }
  }
  if (!HARDENED_RUNTIME_FLAG_RE.test(details)) {
    throw new Error("binary code signature is missing the hardened runtime");
  }
  if (!SIGNING_TIMESTAMP_RE.test(details)) {
    throw new Error("binary code signature is missing a trusted timestamp");
  }
}

async function downloadCliBinaryDelta(input: {
  baseBytes: Buffer;
  delta: CliBinaryDelta;
  downloadTimeoutMs: number;
  fetchImpl: typeof fetch;
  release: CliBinaryReleaseInfo;
}): Promise<Buffer> {
  const response = await input.fetchImpl(input.delta.patchUrl, {
    method: "GET",
    signal: AbortSignal.timeout(input.downloadTimeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `binary delta download failed: HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }
  const patchBytes = Buffer.from(await response.arrayBuffer());
  verifyBinaryBytes({
    bytes: patchBytes,
    expectedSha256: input.delta.patchSha256,
    expectedSizeBytes: input.delta.patchSizeBytes,
    label: "binary delta archive",
  });

  let patchPayloadBytes: Buffer;
  try {
    patchPayloadBytes = gunzipSync(patchBytes, {
      maxOutputLength: input.delta.patchPayloadSizeBytes,
    });
  } catch (error) {
    throw new Error(
      `binary delta could not be decompressed: ${toError(error).message}`
    );
  }
  if (patchPayloadBytes.byteLength !== input.delta.patchPayloadSizeBytes) {
    throw new Error(
      `binary delta payload size mismatch: expected ${input.delta.patchPayloadSizeBytes} bytes, received ${patchPayloadBytes.byteLength} bytes`
    );
  }

  return reconstructCliBinaryDelta({
    baseBytes: input.baseBytes,
    delta: input.delta,
    patchPayloadBytes,
    targetSha256: input.release.sha256,
    targetSizeBytes: input.release.sizeBytes,
  });
}

function resolveFullCliBinaryUpdatePlan(
  release: CliBinaryReleaseInfo
): CliBinaryFullUpdatePlan {
  if (hasCompressedCliBinaryTransport(release)) {
    return {
      downloadSha256: release.archiveSha256,
      downloadSizeBytes: release.archiveSizeBytes,
      downloadUrl: release.archiveUrl,
      transport: "archive",
    };
  }
  return {
    downloadSha256: release.sha256,
    downloadSizeBytes: release.sizeBytes,
    downloadUrl: release.url,
    transport: "raw",
  };
}

async function downloadFullCliBinaryArtifact(input: {
  downloadTimeoutMs: number;
  fetchImpl: typeof fetch;
  plan: CliBinaryFullUpdatePlan;
  release: CliBinaryReleaseInfo;
}): Promise<Buffer> {
  const response = await input.fetchImpl(input.plan.downloadUrl, {
    method: "GET",
    signal: AbortSignal.timeout(input.downloadTimeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `binary download failed: HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }
  const downloadBytes = Buffer.from(await response.arrayBuffer());
  verifyBinaryBytes({
    bytes: downloadBytes,
    expectedSha256: input.plan.downloadSha256,
    expectedSizeBytes: input.plan.downloadSizeBytes,
    label:
      input.plan.transport === "archive" ? "binary archive" : "binary download",
  });
  let artifactBytes = downloadBytes;
  if (input.plan.transport === "archive") {
    try {
      artifactBytes = gunzipSync(downloadBytes, {
        maxOutputLength: input.release.sizeBytes,
      });
    } catch (error) {
      throw new Error(
        `binary archive could not be decompressed: ${toError(error).message}`
      );
    }
  }
  verifyBinaryBytes({
    bytes: artifactBytes,
    expectedSha256: input.release.sha256,
    expectedSizeBytes: input.release.sizeBytes,
    label: "binary download",
  });
  return artifactBytes;
}

function hasCompressedCliBinaryTransport(
  release: CliBinaryReleaseInfo
): release is CliBinaryReleaseInfo & {
  archiveFormat: "gzip";
  archiveUrl: string;
  archiveSha256: string;
  archiveSizeBytes: number;
} {
  return (
    release.archiveFormat === "gzip" &&
    typeof release.archiveUrl === "string" &&
    typeof release.archiveSha256 === "string" &&
    typeof release.archiveSizeBytes === "number"
  );
}

function verifyBinaryBytes(input: {
  bytes: Buffer;
  expectedSha256: string;
  expectedSizeBytes: number;
  label: string;
}): void {
  if (input.bytes.byteLength !== input.expectedSizeBytes) {
    throw new Error(
      `${input.label} size mismatch: expected ${input.expectedSizeBytes} bytes, received ${input.bytes.byteLength} bytes`
    );
  }
  const actualSha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (actualSha256 !== input.expectedSha256.toLowerCase()) {
    throw new Error(
      `${input.label} sha256 mismatch: expected ${input.expectedSha256.toLowerCase()}, received ${actualSha256}`
    );
  }
}

function commandFailureDetails(result: CommandResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
