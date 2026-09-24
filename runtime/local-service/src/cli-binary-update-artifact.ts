import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type CliBinaryRelease,
  WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL,
  WINDOWS_PROCESS_HELPER_FILENAME,
} from "@openmeld/schemas";
import { reconstructCliBinaryDelta } from "./cli-binary-delta.js";
import { verifyWindowsArtifactSignature } from "./windows-artifact-signature.js";

type CommandResult = {
  code: number;
  stderr: string;
  stdout: string;
};

const HARDENED_RUNTIME_FLAG_RE = /flags=.*runtime/iu;
const RETRY_AFTER_SECONDS_RE = /^\d+$/u;
const SIGNING_TIMESTAMP_RE = /^Timestamp=/mu;

type CliBinaryDelta = NonNullable<CliBinaryRelease["deltas"]>[number];
export type CliBinaryDownloadPolicy = {
  maxAttempts: number;
  retryDelaysMs: readonly number[];
  stallTimeoutMs: number;
  totalBudgetMs: number;
};

export type CliBinaryDownloadProgress = {
  receivedBytes: number;
  totalBytes: number;
  transferAttempt: number;
};

export const DEFAULT_CLI_BINARY_DOWNLOAD_POLICY: CliBinaryDownloadPolicy = {
  maxAttempts: 3,
  retryDelaysMs: [500, 1500],
  stallTimeoutMs: 60_000,
  totalBudgetMs: 5 * 60_000,
};

export type CliBinaryUpdateErrorKind =
  | "download_failed"
  | "download_stalled"
  | "download_timed_out"
  | "integrity_check_failed";

export class CliBinaryUpdateError extends Error {
  readonly allowFullFallback: boolean;
  readonly code: `openmeld.tools.update.${CliBinaryUpdateErrorKind}`;
  readonly kind: CliBinaryUpdateErrorKind;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(input: {
    allowFullFallback: boolean;
    cause?: unknown;
    kind: CliBinaryUpdateErrorKind;
    message: string;
    retryAfterMs?: number;
    retryable: boolean;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = "CliBinaryUpdateError";
    this.allowFullFallback = input.allowFullFallback;
    this.code = `openmeld.tools.update.${input.kind}`;
    this.kind = input.kind;
    this.retryAfterMs = input.retryAfterMs;
    this.retryable = input.retryable;
  }
}
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
  release: CliBinaryRelease;
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
  downloadPolicy: CliBinaryDownloadPolicy;
  fetchImpl: typeof fetch;
  onDeltaFallback: (error: Error) => void;
  onProgress?: (progress: CliBinaryDownloadProgress) => void;
  plan: CliBinaryUpdatePlan;
  release: CliBinaryRelease;
}): Promise<Buffer> {
  const recovery = createDownloadRecoveryContext(input.downloadPolicy);
  // A delta is only useful when the global recovery budget can still preserve
  // the documented delta-to-full fallback. With a one-attempt policy, spend
  // that attempt on the complete artifact instead of stranding the upgrade on
  // an optional transport.
  if (
    input.plan.transport === "delta" &&
    input.downloadPolicy.maxAttempts < 2
  ) {
    return downloadFullCliBinaryArtifact({
      ...input,
      plan: resolveFullCliBinaryUpdatePlan(input.release),
      recovery,
    });
  }
  if (input.plan.transport === "delta") {
    try {
      return await downloadCliBinaryDelta({
        ...input,
        attemptCeiling: Math.max(1, input.downloadPolicy.maxAttempts - 1),
        baseBytes: input.plan.baseBytes,
        delta: input.plan.delta,
        recovery,
      });
    } catch (error) {
      const resolvedError = toError(error);
      if (
        resolvedError instanceof CliBinaryUpdateError &&
        !resolvedError.allowFullFallback
      ) {
        throw resolvedError;
      }
      if (recovery.attemptsStarted >= input.downloadPolicy.maxAttempts) {
        throw resolvedError;
      }
      input.onDeltaFallback(resolvedError);
      await waitForRetryDelay({
        cause: resolvedError,
        deadlineAtMs: recovery.deadlineAtMs,
        delayMs:
          resolvedError instanceof CliBinaryUpdateError
            ? (resolvedError.retryAfterMs ?? 0)
            : 0,
      });
    }
    return downloadFullCliBinaryArtifact({
      ...input,
      plan: resolveFullCliBinaryUpdatePlan(input.release),
      recovery,
    });
  }
  return downloadFullCliBinaryArtifact({
    ...input,
    plan: input.plan,
    recovery,
  });
}

/** Prepare the Windows companion in the caller's disposable artifact directory. */

export function allowUnsignedWindowsInternalPreview(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.OPENMELD_ENV_PRESET === "prod" &&
    env.OPENMELD_WINDOWS_INTERNAL_PREVIEW === "1" &&
    env.OPENMELD_CLI_BINARY_MANIFEST_URL ===
      WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL
  );
}

function assertWindowsPreviewPolicy(
  windows: NonNullable<CliBinaryRelease["windows"]>,
  allowed: boolean
): void {
  if ("mode" in windows && !allowed) {
    throw integrityError(
      "Unsigned Windows artifacts require the explicit OpenMeld internal preview channel"
    );
  }
}

export async function prepareCliBinaryProcessHelper(input: {
  artifactPath: string;
  allowUnsignedPreview?: boolean;
  downloadPolicy: CliBinaryDownloadPolicy;
  fetchImpl: typeof fetch;
  release: CliBinaryRelease;
}): Promise<void> {
  const windows = input.release.windows;
  if (!windows) {
    if (process.platform === "win32") {
      throw integrityError(
        "Windows CLI artifacts must declare their process helper"
      );
    }
    return;
  }
  if (process.platform !== "win32") {
    throw integrityError("Windows artifact preparation requires Windows");
  }
  assertWindowsPreviewPolicy(windows, input.allowUnsignedPreview === true);
  if (
    new URL(windows.processHelper.url).origin !==
    new URL(input.release.url).origin
  ) {
    throw integrityError(
      "Windows process helper returned an unexpected download location"
    );
  }
  const bytes = await downloadCliBinaryUpdateArtifact({
    downloadPolicy: input.downloadPolicy,
    fetchImpl: input.fetchImpl,
    release: windows.processHelper,
    plan: resolveFullCliBinaryUpdatePlan(windows.processHelper),
    onDeltaFallback: () => {
      /* The small helper always uses a complete artifact. */
    },
  });
  const helperPath = join(
    dirname(input.artifactPath),
    WINDOWS_PROCESS_HELPER_FILENAME
  );
  await writeFile(helperPath, bytes, { mode: 0o700, flag: "wx" });
  if (!("mode" in windows)) {
    await verifyWindowsArtifactSignature(helperPath, windows.publisherName);
  }
}

export async function verifyCliBinaryCodeSignature(input: {
  artifactPath: string;
  allowUnsignedPreview?: boolean;
  release: CliBinaryRelease;
  runCommand: (command: string, args: string[]) => Promise<CommandResult>;
}): Promise<void> {
  if (process.platform === "win32") {
    if (!input.release.windows) {
      throw integrityError(
        "Windows CLI artifacts must declare their publisher and process helper"
      );
    }
    assertWindowsPreviewPolicy(
      input.release.windows,
      input.allowUnsignedPreview === true
    );
    if ("mode" in input.release.windows) {
      return;
    }
    try {
      await verifyWindowsArtifactSignature(
        input.artifactPath,
        input.release.windows.publisherName
      );
    } catch (error) {
      throw integrityError(
        `Windows artifact signature verification failed: ${toError(error).message}`
      );
    }
    return;
  }
  if (input.release.windows) {
    throw integrityError(
      "signed Windows artifact verification requires Windows"
    );
  }
  const { codeIdentifier, teamIdentifier } = input.release;
  if (!(codeIdentifier && teamIdentifier)) {
    return;
  }
  if (process.platform !== "darwin") {
    throw integrityError("signed OpenMeld CLI verification requires macOS");
  }

  const verification = await input.runCommand("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--verbose=2",
    input.artifactPath,
  ]);
  if (verification.code !== 0) {
    throw integrityError(
      `binary code signature verification failed: ${commandFailureDetails(verification)}`
    );
  }

  const inspection = await input.runCommand("/usr/bin/codesign", [
    "--display",
    "--verbose=4",
    input.artifactPath,
  ]);
  if (inspection.code !== 0) {
    throw integrityError(
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
      throw integrityError(
        `binary code signature is missing expected identity: ${expected}`
      );
    }
  }
  if (!HARDENED_RUNTIME_FLAG_RE.test(details)) {
    throw integrityError(
      "binary code signature is missing the hardened runtime"
    );
  }
  if (!SIGNING_TIMESTAMP_RE.test(details)) {
    throw integrityError(
      "binary code signature is missing a trusted timestamp"
    );
  }
}

async function downloadCliBinaryDelta(input: {
  attemptCeiling: number;
  baseBytes: Buffer;
  delta: CliBinaryDelta;
  downloadPolicy: CliBinaryDownloadPolicy;
  fetchImpl: typeof fetch;
  onProgress?: (progress: CliBinaryDownloadProgress) => void;
  recovery: DownloadRecoveryContext;
  release: CliBinaryRelease;
}): Promise<Buffer> {
  const patchBytes = await downloadBinaryBytesWithRecovery({
    attemptCeiling: input.attemptCeiling,
    expectedSizeBytes: input.delta.patchSizeBytes,
    fetchImpl: input.fetchImpl,
    label: "binary delta archive",
    onProgress: input.onProgress,
    recovery: input.recovery,
    url: input.delta.patchUrl,
  });
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
    throw integrityError(
      `binary delta could not be decompressed: ${toError(error).message}`,
      error
    );
  }
  if (patchPayloadBytes.byteLength !== input.delta.patchPayloadSizeBytes) {
    throw integrityError(
      `binary delta payload size mismatch: expected ${input.delta.patchPayloadSizeBytes} bytes, received ${patchPayloadBytes.byteLength} bytes`
    );
  }

  try {
    return reconstructCliBinaryDelta({
      baseBytes: input.baseBytes,
      delta: input.delta,
      patchPayloadBytes,
      targetSha256: input.release.sha256,
      targetSizeBytes: input.release.sizeBytes,
    });
  } catch (error) {
    throw integrityError(
      `binary delta reconstruction failed: ${toError(error).message}`,
      error
    );
  }
}

export function resolveFullCliBinaryUpdatePlan(
  release: CliBinaryRelease
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
  downloadPolicy: CliBinaryDownloadPolicy;
  fetchImpl: typeof fetch;
  onProgress?: (progress: CliBinaryDownloadProgress) => void;
  plan: CliBinaryFullUpdatePlan;
  recovery: DownloadRecoveryContext;
  release: CliBinaryRelease;
}): Promise<Buffer> {
  const downloadBytes = await downloadBinaryBytesWithRecovery({
    expectedSizeBytes: input.plan.downloadSizeBytes,
    fetchImpl: input.fetchImpl,
    label:
      input.plan.transport === "archive" ? "binary archive" : "binary download",
    onProgress: input.onProgress,
    recovery: input.recovery,
    url: input.plan.downloadUrl,
  });
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
      throw integrityError(
        `binary archive could not be decompressed: ${toError(error).message}`,
        error
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
  release: CliBinaryRelease
): release is CliBinaryRelease & {
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
    throw integrityError(
      `${input.label} size mismatch: expected ${input.expectedSizeBytes} bytes, received ${input.bytes.byteLength} bytes`
    );
  }
  const actualSha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (actualSha256 !== input.expectedSha256.toLowerCase()) {
    throw integrityError(
      `${input.label} sha256 mismatch: expected ${input.expectedSha256.toLowerCase()}, received ${actualSha256}`
    );
  }
}

type DownloadRecoveryContext = {
  attemptsStarted: number;
  deadlineAtMs: number;
  policy: CliBinaryDownloadPolicy;
};

function createDownloadRecoveryContext(
  policy: CliBinaryDownloadPolicy
): DownloadRecoveryContext {
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    !Number.isFinite(policy.stallTimeoutMs) ||
    policy.stallTimeoutMs <= 0 ||
    !Number.isFinite(policy.totalBudgetMs) ||
    policy.totalBudgetMs <= 0 ||
    policy.retryDelaysMs.some(
      (delayMs) => !Number.isFinite(delayMs) || delayMs < 0
    )
  ) {
    throw new Error("CLI binary download policy is invalid.");
  }
  return {
    attemptsStarted: 0,
    deadlineAtMs: performance.now() + policy.totalBudgetMs,
    policy,
  };
}

async function downloadBinaryBytesWithRecovery(input: {
  attemptCeiling?: number;
  expectedSizeBytes: number;
  fetchImpl: typeof fetch;
  label: string;
  onProgress?: (progress: CliBinaryDownloadProgress) => void;
  recovery: DownloadRecoveryContext;
  url: string;
}): Promise<Buffer> {
  let lastError: CliBinaryUpdateError | null = null;
  const attemptCeiling = Math.min(
    input.attemptCeiling ?? input.recovery.policy.maxAttempts,
    input.recovery.policy.maxAttempts
  );
  while (input.recovery.attemptsStarted < attemptCeiling) {
    if (performance.now() >= input.recovery.deadlineAtMs) {
      throw totalBudgetError(lastError ?? undefined);
    }
    const attemptIndex = input.recovery.attemptsStarted;
    input.recovery.attemptsStarted += 1;
    try {
      return await downloadBinaryBytesAttempt(input);
    } catch (error) {
      const resolved = normalizeDownloadError(error, input.label);
      lastError = resolved;
      if (!resolved.retryable) {
        throw resolved;
      }
      if (input.recovery.attemptsStarted >= attemptCeiling) {
        throw resolved;
      }
      const delayMs =
        input.recovery.policy.retryDelaysMs[attemptIndex] ??
        input.recovery.policy.retryDelaysMs.at(-1) ??
        0;
      await waitForRetryDelay({
        cause: resolved,
        deadlineAtMs: input.recovery.deadlineAtMs,
        delayMs: Math.max(delayMs, resolved.retryAfterMs ?? 0),
      });
    }
  }
  throw lastError ?? totalBudgetError();
}

async function downloadBinaryBytesAttempt(input: {
  expectedSizeBytes: number;
  fetchImpl: typeof fetch;
  label: string;
  onProgress?: (progress: CliBinaryDownloadProgress) => void;
  recovery: DownloadRecoveryContext;
  url: string;
}): Promise<Buffer> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let lastProgressAtMs = performance.now();
  try {
    const response = await waitForDownloadProgress(
      input.fetchImpl(input.url, {
        method: "GET",
        signal: controller.signal,
      }),
      {
        controller,
        lastProgressAtMs,
        recovery: input.recovery,
      }
    );
    if (!response.ok) {
      cancelReadableStream(response.body);
      throw httpDownloadError({
        label: input.label,
        retryAfter: response.headers.get("retry-after"),
        status: response.status,
        statusText: response.statusText,
      });
    }
    if (!response.body) {
      return Buffer.alloc(0);
    }

    reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    input.onProgress?.({
      receivedBytes,
      totalBytes: input.expectedSizeBytes,
      transferAttempt: input.recovery.attemptsStarted,
    });
    while (true) {
      const next = await waitForDownloadProgress(reader.read(), {
        controller,
        lastProgressAtMs,
        recovery: input.recovery,
      });
      if (next.done) {
        return Buffer.concat(chunks, receivedBytes);
      }
      if (!next.value || next.value.byteLength === 0) {
        continue;
      }
      lastProgressAtMs = performance.now();
      receivedBytes += next.value.byteLength;
      if (receivedBytes > input.expectedSizeBytes) {
        throw integrityError(
          `${input.label} size exceeded the declared ${input.expectedSizeBytes} bytes while downloading`
        );
      }
      input.onProgress?.({
        receivedBytes,
        totalBytes: input.expectedSizeBytes,
        transferAttempt: input.recovery.attemptsStarted,
      });
      chunks.push(Buffer.from(next.value));
    }
  } catch (error) {
    controller.abort(error);
    if (reader) {
      cancelReadableStreamReader(reader);
    }
    throw error;
  } finally {
    reader?.releaseLock();
  }
}

async function waitForDownloadProgress<T>(
  pending: Promise<T>,
  input: {
    controller: AbortController;
    lastProgressAtMs: number;
    recovery: DownloadRecoveryContext;
  }
): Promise<T> {
  const stallDeadlineAtMs =
    input.lastProgressAtMs + input.recovery.policy.stallTimeoutMs;
  const totalDeadlineWins = input.recovery.deadlineAtMs <= stallDeadlineAtMs;
  const deadlineAtMs = Math.min(stallDeadlineAtMs, input.recovery.deadlineAtMs);
  const timeoutMs = Math.max(0, deadlineAtMs - performance.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = totalDeadlineWins ? totalBudgetError() : stalledError();
      reject(error);
      input.controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function waitForRetryDelay(input: {
  cause: unknown;
  deadlineAtMs: number;
  delayMs: number;
}): Promise<void> {
  if (input.delayMs === 0) {
    return;
  }
  const remainingMs = input.deadlineAtMs - performance.now();
  if (remainingMs <= input.delayMs) {
    throw totalBudgetError(input.cause);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, input.delayMs));
}

function normalizeDownloadError(
  error: unknown,
  label: string
): CliBinaryUpdateError {
  if (error instanceof CliBinaryUpdateError) {
    return error;
  }
  const resolved = toError(error);
  const terminalTlsFailure = findErrorCode(error, isTerminalTlsErrorCode);
  if (terminalTlsFailure || isTerminalTlsErrorMessage(resolved.message)) {
    return new CliBinaryUpdateError({
      allowFullFallback: false,
      cause: error,
      kind: "download_failed",
      message: `${label} download failed TLS certificate verification${
        terminalTlsFailure ? ` (${terminalTlsFailure})` : ""
      }`,
      retryable: false,
    });
  }
  const retryable = Boolean(findErrorCode(error, isRetryableNetworkErrorCode));
  return new CliBinaryUpdateError({
    allowFullFallback: true,
    cause: error,
    kind: "download_failed",
    message: `${label} download failed: ${resolved.message}`,
    retryable,
  });
}

function httpDownloadError(input: {
  label: string;
  retryAfter: string | null;
  status: number;
  statusText: string;
}): CliBinaryUpdateError {
  const retryable =
    input.status === 408 ||
    input.status === 429 ||
    input.status === 500 ||
    input.status === 502 ||
    input.status === 503 ||
    input.status === 504;
  const missingDelta = input.status === 404 || input.status === 410;
  const retryAfterMs = input.retryAfter
    ? parseRetryAfterMs(input.retryAfter)
    : undefined;
  return new CliBinaryUpdateError({
    allowFullFallback: retryable || missingDelta,
    kind: "download_failed",
    message: `${input.label} download failed: HTTP ${input.status}${
      input.statusText ? ` ${input.statusText}` : ""
    }`,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    retryable,
  });
}

function parseRetryAfterMs(value: string): number | undefined {
  const trimmed = value.trim();
  if (RETRY_AFTER_SECONDS_RE.test(trimmed)) {
    const seconds = Number(trimmed);
    const milliseconds = seconds * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }
  const retryAtMs = Date.parse(trimmed);
  if (!Number.isFinite(retryAtMs)) {
    return undefined;
  }
  return Math.max(0, retryAtMs - Date.now());
}

function stalledError(): CliBinaryUpdateError {
  return new CliBinaryUpdateError({
    allowFullFallback: true,
    kind: "download_stalled",
    message: "binary download stopped making progress",
    retryable: true,
  });
}

function totalBudgetError(cause?: unknown): CliBinaryUpdateError {
  return new CliBinaryUpdateError({
    allowFullFallback: false,
    ...(cause === undefined ? {} : { cause }),
    kind: "download_timed_out",
    message: "binary download exceeded the total recovery time budget",
    retryable: false,
  });
}

function integrityError(
  message: string,
  cause?: unknown
): CliBinaryUpdateError {
  return new CliBinaryUpdateError({
    allowFullFallback: true,
    ...(cause === undefined ? {} : { cause }),
    kind: "integrity_check_failed",
    message,
    retryable: false,
  });
}

function findErrorCode(
  error: unknown,
  predicate: (code: string) => boolean
): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && predicate(code.toUpperCase())) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function cancelReadableStream(stream: ReadableStream<Uint8Array> | null): void {
  if (!stream) {
    return;
  }
  try {
    stream.cancel().catch(() => undefined);
  } catch {
    // Best-effort cleanup must not replace or outlive the bounded failure.
  }
}

function cancelReadableStreamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>
): void {
  try {
    reader.cancel().catch(() => undefined);
  } catch {
    // Best-effort cleanup must not replace or outlive the bounded failure.
  }
}

function isTerminalTlsErrorCode(code: string): boolean {
  return (
    code.startsWith("CERT_") ||
    code.includes("_CERT_") ||
    code.startsWith("ERR_OSSL_") ||
    code.startsWith("ERR_SSL_") ||
    code.startsWith("ERR_TLS_") ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code.startsWith("UNABLE_TO_GET_ISSUER_CERT") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  );
}

function isTerminalTlsErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("certificate") ||
    normalized.includes("self signed") ||
    normalized.includes("tls handshake") ||
    normalized.includes("unable to verify")
  );
}

function isRetryableNetworkErrorCode(code: string): boolean {
  return (
    code === "EAI_AGAIN" ||
    code === "ECONNABORTED" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETDOWN" ||
    code === "ENETUNREACH" ||
    code === "ENOTFOUND" ||
    code === "EPIPE" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_RES_CONTENT_LENGTH_MISMATCH" ||
    code === "UND_ERR_SOCKET"
  );
}

function commandFailureDetails(result: CommandResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
