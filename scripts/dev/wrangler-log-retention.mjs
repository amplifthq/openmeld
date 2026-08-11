import { readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_WRANGLER_LOG_RETENTION_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WRANGLER_DEBUG_LOG_FILE_REGEX =
  /^wrangler-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d{3}\.log$/u;

export function cleanupExpiredWranglerDebugLogs(options = {}) {
  const retentionDays = resolveRetentionDays(options.retentionDays);
  const nowMs = resolveNowMs(options.nowMs);
  const cutoffMs = nowMs - retentionDays * MS_PER_DAY;
  const logDirectory = resolveWranglerDebugLogDirectory(options);
  let entries;

  try {
    entries = readdirSync(logDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return buildCleanupResult({
        deletedCount: 0,
        directoryExists: false,
        failedCount: 0,
        logDirectory,
        retentionDays,
      });
    }
    throw error;
  }

  let deletedCount = 0;
  let failedCount = 0;

  for (const entry of entries) {
    if (!(entry.isFile() && WRANGLER_DEBUG_LOG_FILE_REGEX.test(entry.name))) {
      continue;
    }

    const filePath = join(logDirectory, entry.name);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs >= cutoffMs || isSameLocalDate(stat.mtimeMs, nowMs)) {
        continue;
      }
      rmSync(filePath, { force: true });
      deletedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return buildCleanupResult({
    deletedCount,
    directoryExists: true,
    failedCount,
    logDirectory,
    retentionDays,
  });
}

export function resolveWranglerDebugLogDirectory(options = {}) {
  const env = options.env ?? process.env;
  const explicitPath = String(env.WRANGLER_LOG_PATH ?? "").trim();
  if (explicitPath.length > 0) {
    const absolutePath = resolve(explicitPath);
    return explicitPath.endsWith(".log") ? dirname(absolutePath) : absolutePath;
  }

  return resolveDefaultWranglerDebugLogDirectory({
    env,
    homeDir: options.homeDir,
    platform: options.platform,
  });
}

export function resolveDefaultWranglerDebugLogDirectory(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDir ?? homedir();

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Preferences", ".wrangler", "logs");
  }

  if (platform === "win32" && typeof env.APPDATA === "string") {
    return join(env.APPDATA, ".wrangler", "logs");
  }

  const configHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.length > 0
      ? env.XDG_CONFIG_HOME
      : join(homeDirectory, ".config");
  return join(configHome, ".wrangler", "logs");
}

function resolveRetentionDays(value) {
  if (value === undefined) {
    return DEFAULT_WRANGLER_LOG_RETENTION_DAYS;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("wrangler log retentionDays must be a positive number.");
  }
  return value;
}

function resolveNowMs(value) {
  if (value === undefined) {
    return Date.now();
  }

  if (!Number.isFinite(value)) {
    throw new Error("wrangler log retention nowMs must be finite.");
  }
  return value;
}

function buildCleanupResult(input) {
  return {
    deletedCount: input.deletedCount,
    directoryExists: input.directoryExists,
    failedCount: input.failedCount,
    logDirectory: input.logDirectory,
    retentionDays: input.retentionDays,
  };
}

function isMissingDirectoryError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isSameLocalDate(leftMs, rightMs) {
  const left = new Date(leftMs);
  const right = new Date(rightMs);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
