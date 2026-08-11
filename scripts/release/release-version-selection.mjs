import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { fetchCliChannelManifest } from "./cli-channel-sync.mjs";

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const execFileAsync = promisify(execFile);

export async function resolveCliReleaseVersion(input = {}) {
  const explicitVersion = normalizeOptionalVersion(input.explicitVersion);
  if (input.next && explicitVersion) {
    throw new Error(
      "--next and --version are mutually exclusive. Choose one release version mode."
    );
  }
  if (explicitVersion) {
    return {
      source: "explicit",
      targetVersion: explicitVersion,
    };
  }
  if (!input.next) {
    return null;
  }

  try {
    const readChannels = input.readChannels ?? readCliReleaseChannels;
    const channels = await readChannels({
      cwd: input.cwd,
      env: input.env,
      fetch: input.fetch,
      runCommand: input.runCommand,
    });
    const npmVersion = requireStableVersion(channels?.npmVersion, "npm latest");
    const r2Version = requireStableVersion(channels?.r2Version, "R2 stable");
    const highestPublishedVersion =
      compareStableVersions(npmVersion, r2Version) >= 0
        ? npmVersion
        : r2Version;
    return {
      drift: npmVersion !== r2Version,
      highestPublishedVersion,
      npmVersion,
      r2Version,
      source: "next",
      targetVersion: incrementPatchVersion(highestPublishedVersion),
    };
  } catch (error) {
    throw new Error(
      [
        `--next could not determine a release version: ${formatError(error)}`,
        "No version was selected because both npm and R2 channel facts are required.",
        "Next: restore network and credentials, then run `pnpm run release:preflight` or retry the same command.",
      ].join("\n")
    );
  }
}

export async function readCliReleaseChannels(input = {}) {
  const runCommand = input.runCommand ?? runDefaultCommand;
  const [npmResult, r2Manifest] = await Promise.all([
    runCommand({
      args: ["view", "openmeld", "dist-tags", "--json"],
      command: "npm",
      cwd: input.cwd ?? process.cwd(),
      env: input.env ?? process.env,
    }),
    fetchCliChannelManifest({ fetch: input.fetch }),
  ]);
  if (npmResult.status !== 0) {
    throw new Error(
      `npm dist-tags query failed: ${readCommandFailure(npmResult)}`
    );
  }
  const distTags = parseJson(npmResult.stdout, "npm dist-tags");
  return {
    npmVersion: distTags?.latest,
    r2Version: r2Manifest?.channels?.stable?.version,
  };
}

export function formatCliReleaseVersionResolution(resolution) {
  if (resolution.source === "explicit") {
    return `CLI version decision: explicit ${resolution.targetVersion}; channel lookup skipped.`;
  }
  const facts = `npm latest ${resolution.npmVersion}; R2 stable ${resolution.r2Version}; highest ${resolution.highestPublishedVersion}; next ${resolution.targetVersion}.`;
  if (!resolution.drift) {
    return `CLI version decision: ${facts}`;
  }
  return `WARNING: CLI channel version drift: ${facts}`;
}

export function compareStableVersions(left, right) {
  const parsedLeft = parseStableVersion(left);
  const parsedRight = parseStableVersion(right);
  for (let index = 0; index < parsedLeft.length; index += 1) {
    const difference = parsedLeft[index] - parsedRight[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function incrementPatchVersion(version) {
  const [major, minor, patch] = parseStableVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function normalizeOptionalVersion(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return requireStableVersion(value, "--version");
}

function requireStableVersion(value, label) {
  const normalized = String(value ?? "").trim();
  if (!STABLE_VERSION_PATTERN.test(normalized)) {
    throw new Error(
      `${label} must be a stable semantic version in X.Y.Z form; received ${normalized || "missing"}.`
    );
  }
  return normalized;
}

function parseStableVersion(value) {
  const match = String(value).match(STABLE_VERSION_PATTERN);
  if (!match) {
    throw new Error(`Invalid stable version: ${String(value)}`);
  }
  return match.slice(1).map(Number);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runDefaultCommand(input) {
  try {
    const result = await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      encoding: "utf8",
      env: input.env,
      maxBuffer: 1024 * 1024,
    });
    return {
      status: 0,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    };
  } catch (error) {
    return {
      status: typeof error?.code === "number" ? error.code : 1,
      stderr: String(error?.stderr ?? error?.message ?? ""),
      stdout: String(error?.stdout ?? ""),
    };
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${formatError(error)}`);
  }
}

function readCommandFailure(result) {
  return (
    [String(result.stderr ?? "").trim(), String(result.stdout ?? "").trim()]
      .filter(Boolean)
      .join("; ") || `exit code ${String(result.status)}`
  );
}
