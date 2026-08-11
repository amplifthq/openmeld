import type {
  DesktopMacArtifactView,
  DesktopUpdateView,
} from "../../shared/view-types";
import {
  resolveDesktopDownloadPageUrl,
  resolveDesktopUpdateManifestUrl,
} from "../desktop-environment";

type FetchFn = (
  url: string,
  init: { signal: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type DesktopUpdateManifest = {
  latestVersion: string;
  minimumSupportedVersion: string | null;
  downloadPageUrl: string;
  message: string | null;
  macosArm64: DesktopMacArtifactView | null;
};

type SemverValue = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
};

export type ReadDesktopUpdateStatusDeps = {
  currentVersion: string;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchFn;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 3000;
const SEMVER_RE =
  /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/;
const NUMERIC_IDENTIFIER_RE = /^(0|[1-9]\d*)$/;

export async function readDesktopUpdateStatus({
  currentVersion,
  env,
  fetch = globalThis.fetch as FetchFn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ReadDesktopUpdateStatusDeps): Promise<DesktopUpdateView> {
  const downloadPageUrl = safeResolveDownloadPageUrl(env);
  let manifestUrl: string;
  try {
    manifestUrl = resolveDesktopUpdateManifestUrl({ env });
  } catch (error) {
    return idleUpdateView({
      currentVersion,
      downloadPageUrl,
      problem: updateProblem(
        "desktop_update.invalid_manifest_url",
        readableError(error)
      ),
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(manifestUrl, { signal: controller.signal });
    if (!response.ok) {
      return idleUpdateView({
        currentVersion,
        downloadPageUrl,
        problem: updateProblem(
          "desktop_update.request_failed",
          `OpenMeld Desktop update check failed with HTTP ${response.status}.`
        ),
      });
    }
    const manifest = parseDesktopUpdateManifest(
      await response.json(),
      downloadPageUrl
    );
    return resolveDesktopUpdateView({ currentVersion, manifest });
  } catch (error) {
    const code =
      error instanceof DesktopUpdateManifestError
        ? "desktop_update.invalid_manifest"
        : "desktop_update.request_failed";
    return idleUpdateView({
      currentVersion,
      downloadPageUrl,
      problem: updateProblem(code, readableError(error)),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!(left && right)) {
    throw new Error("Version must be a semantic version.");
  }
  for (const key of ["major", "minor", "patch"] as const) {
    const diff = left[key] - right[key];
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function resolveDesktopUpdateView(input: {
  currentVersion: string;
  manifest: DesktopUpdateManifest;
}): DesktopUpdateView {
  if (!parseSemver(input.currentVersion)) {
    return idleUpdateView({
      currentVersion: input.currentVersion,
      downloadPageUrl: input.manifest.downloadPageUrl,
      problem: updateProblem(
        "desktop_update.invalid_current_version",
        "OpenMeld Desktop has an invalid app version."
      ),
    });
  }
  if (!parseSemver(input.manifest.latestVersion)) {
    return idleUpdateView({
      currentVersion: input.currentVersion,
      downloadPageUrl: input.manifest.downloadPageUrl,
      problem: updateProblem(
        "desktop_update.invalid_manifest",
        "The Desktop update manifest has an invalid latest version."
      ),
    });
  }
  const minimum = input.manifest.minimumSupportedVersion
    ? parseSemver(input.manifest.minimumSupportedVersion)
    : null;
  if (input.manifest.minimumSupportedVersion && !minimum) {
    return idleUpdateView({
      currentVersion: input.currentVersion,
      downloadPageUrl: input.manifest.downloadPageUrl,
      problem: updateProblem(
        "desktop_update.invalid_manifest",
        "The Desktop update manifest has an invalid minimum supported version."
      ),
    });
  }

  const updateRequired = input.manifest.minimumSupportedVersion
    ? compareSemver(
        input.currentVersion,
        input.manifest.minimumSupportedVersion
      ) < 0
    : false;
  const updateAvailable =
    compareSemver(input.currentVersion, input.manifest.latestVersion) < 0;
  let status: DesktopUpdateView["status"] = "idle";
  if (updateAvailable) {
    status = "available";
  }
  if (updateRequired) {
    status = "required";
  }

  return {
    status,
    checked: true,
    currentVersion: input.currentVersion,
    latestVersion: input.manifest.latestVersion,
    minimumSupportedVersion: input.manifest.minimumSupportedVersion,
    downloadPageUrl: input.manifest.downloadPageUrl,
    message: input.manifest.message,
    macosArm64: input.manifest.macosArm64,
    problem: null,
  };
}

function parseDesktopUpdateManifest(
  value: unknown,
  fallbackDownloadPageUrl: string
): DesktopUpdateManifest {
  if (!isRecord(value)) {
    throw new DesktopUpdateManifestError(
      "The Desktop update manifest must be an object."
    );
  }
  const latestVersion = readString(value.latestVersion);
  if (!latestVersion) {
    throw new DesktopUpdateManifestError(
      "The Desktop update manifest is missing latestVersion."
    );
  }
  const minimumSupportedVersion =
    readString(value.minimumSupportedVersion) ?? null;
  const downloadPageUrl =
    normalizeOptionalHttpUrl(
      readString(value.downloadPageUrl),
      "downloadPageUrl"
    ) ?? fallbackDownloadPageUrl;
  const message = readString(value.message) ?? null;
  return {
    latestVersion,
    minimumSupportedVersion,
    downloadPageUrl,
    message,
    macosArm64: readMacosArm64(value.macosArm64),
  };
}

function readMacosArm64(value: unknown): DesktopMacArtifactView | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new DesktopUpdateManifestError("macosArm64 must be an object.");
  }
  const url = normalizeOptionalHttpUrl(readString(value.url), "macosArm64.url");
  const version = readString(value.version);
  if (!(url && version)) {
    throw new DesktopUpdateManifestError(
      "macosArm64 must include url and version."
    );
  }
  const sha256 = readString(value.sha256) ?? null;
  const sizeBytes =
    typeof value.sizeBytes === "number" && Number.isSafeInteger(value.sizeBytes)
      ? value.sizeBytes
      : null;
  return { url, version, sha256, sizeBytes };
}

class DesktopUpdateManifestError extends Error {}

function safeResolveDownloadPageUrl(
  env: NodeJS.ProcessEnv | undefined
): string {
  try {
    return resolveDesktopDownloadPageUrl({ env });
  } catch {
    return "https://openmeld.ai/desktop";
  }
}

function parseSemver(value: string): SemverValue | null {
  const match = SEMVER_RE.exec(value.trim());
  const groups = match?.groups;
  if (!groups) {
    return null;
  }
  return {
    major: Number(groups.major),
    minor: Number(groups.minor),
    patch: Number(groups.patch),
    prerelease: groups.prerelease ? groups.prerelease.split(".") : null,
  };
}

function comparePrerelease(
  left: string[] | null,
  right: string[] | null
): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    const diff = comparePrereleasePart(leftPart, rightPart);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = parseNumericIdentifier(left);
  const rightNumber = parseNumericIdentifier(right);
  if (leftNumber !== null && rightNumber !== null) {
    return Math.sign(leftNumber - rightNumber);
  }
  if (leftNumber !== null) {
    return -1;
  }
  if (rightNumber !== null) {
    return 1;
  }
  return Math.sign(left.localeCompare(right));
}

function parseNumericIdentifier(value: string): number | null {
  if (!NUMERIC_IDENTIFIER_RE.test(value)) {
    return null;
  }
  return Number(value);
}

function normalizeOptionalHttpUrl(
  value: string | null,
  label: string
): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (!(url.protocol === "https:" || url.protocol === "http:")) {
      throw new Error(`${label} must use http or https.`);
    }
    return value;
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
}

function idleUpdateView(input: {
  currentVersion: string | null;
  downloadPageUrl: string;
  problem: DesktopUpdateView["problem"];
}): DesktopUpdateView {
  return {
    status: "idle",
    checked: input.problem === null,
    currentVersion: input.currentVersion,
    latestVersion: null,
    minimumSupportedVersion: null,
    downloadPageUrl: input.downloadPageUrl,
    message: null,
    macosArm64: null,
    problem: input.problem,
  };
}

function updateProblem(
  code: string,
  message: string
): DesktopUpdateView["problem"] {
  return { code, message };
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "OpenMeld Desktop could not check for updates.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
