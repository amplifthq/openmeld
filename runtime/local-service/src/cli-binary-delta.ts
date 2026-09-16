import { createHash } from "node:crypto";
import {
  type CliBinaryDeltaPatch,
  type CliBinaryDeltaTransport,
  cliBinaryDeltaPatchSchema,
} from "@openmeld/schemas";

export function reconstructCliBinaryDelta(input: {
  baseBytes: Buffer;
  delta: CliBinaryDeltaTransport;
  patchPayloadBytes: Buffer;
  targetSha256: string;
  targetSizeBytes: number;
}): Buffer {
  verifyBytes({
    bytes: input.baseBytes,
    expectedSha256: input.delta.fromSha256,
    expectedSizeBytes: input.delta.fromSizeBytes,
    label: "delta base",
  });

  const patch = parseCliBinaryDeltaPatch(input.patchPayloadBytes);
  assertPatchMatchesRelease({
    delta: input.delta,
    patch,
    targetSha256: input.targetSha256,
    targetSizeBytes: input.targetSizeBytes,
  });

  const targetBytes = Buffer.alloc(input.targetSizeBytes);
  input.baseBytes.copy(
    targetBytes,
    0,
    0,
    Math.min(input.baseBytes.byteLength, targetBytes.byteLength)
  );

  let previousEnd = 0;
  for (const segment of patch.segments) {
    const bytes = Buffer.from(segment.dataBase64, "base64");
    const segmentEnd = segment.offset + bytes.byteLength;
    if (segment.offset < previousEnd) {
      throw new Error(
        "delta patch segments must be sorted and non-overlapping"
      );
    }
    if (segmentEnd > targetBytes.byteLength) {
      throw new Error("delta patch segment exceeds the target binary size");
    }
    bytes.copy(targetBytes, segment.offset);
    previousEnd = segmentEnd;
  }

  verifyBytes({
    bytes: targetBytes,
    expectedSha256: input.targetSha256,
    expectedSizeBytes: input.targetSizeBytes,
    label: "reconstructed binary",
  });
  return targetBytes;
}

function parseCliBinaryDeltaPatch(bytes: Buffer): CliBinaryDeltaPatch {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      `delta patch is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = cliBinaryDeltaPatchSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`delta patch is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

function assertPatchMatchesRelease(input: {
  delta: CliBinaryDeltaTransport;
  patch: CliBinaryDeltaPatch;
  targetSha256: string;
  targetSizeBytes: number;
}): void {
  const mismatches = [
    ["format", input.patch.patchFormat, input.delta.patchFormat],
    ["base sha256", input.patch.baseSha256, input.delta.fromSha256],
    ["base size", input.patch.baseSizeBytes, input.delta.fromSizeBytes],
    ["target sha256", input.patch.targetSha256, input.targetSha256],
    ["target size", input.patch.targetSizeBytes, input.targetSizeBytes],
  ].filter(([, actual, expected]) => actual !== expected);
  if (mismatches.length > 0) {
    throw new Error(
      `delta patch metadata mismatch: ${mismatches.map(([label]) => label).join(", ")}`
    );
  }
}

function verifyBytes(input: {
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
