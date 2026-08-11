import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { normalizeOptionalWorkingDirectory } from "@openmeld/schemas";

const REQUIRED_WORKSPACE_ACCESS_MODE = 0o7;

export type ProfileWorkspacePathErrorReason =
  | "invalid_home_reference"
  | "invalid_working_directory"
  | "not_accessible"
  | "not_directory"
  | "not_found"
  | "relative_path";

export type CustomProfileWorkspacePathValidationResult =
  | {
      status: "invalid";
      path: string;
      reason: ProfileWorkspacePathErrorReason;
    }
  | {
      status: "valid";
      value: string;
    };

export class ProfileWorkspacePathError extends Error {
  readonly code = "profile.workspace.path_invalid";
  readonly path: string;
  readonly reason: ProfileWorkspacePathErrorReason;

  constructor(input: {
    message: string;
    path: string;
    reason: ProfileWorkspacePathErrorReason;
  }) {
    super(input.message);
    this.name = "ProfileWorkspacePathError";
    this.path = input.path;
    this.reason = input.reason;
  }
}

export function describeProfileWorkspacePathValidationFailure(input: {
  path: string;
  reason: ProfileWorkspacePathErrorReason;
}): string {
  switch (input.reason) {
    case "invalid_home_reference":
      return `Workspace path '${input.path}' must use '~' or '~/' when it starts with a tilde.`;
    case "invalid_working_directory":
      return `Workspace path '${input.path}' is not a valid working directory string.`;
    case "not_accessible":
      return `Workspace path '${input.path}' must be readable, writable, and executable.`;
    case "not_directory":
      return `Workspace path '${input.path}' must point to a directory.`;
    case "not_found":
      return `Workspace path '${input.path}' does not exist.`;
    case "relative_path":
      return `Workspace path '${input.path}' must be an absolute path or start with '~/'`;
    default:
      return `Workspace path '${input.path}' is invalid.`;
  }
}

export function normalizeCustomProfileWorkspacePath(value: string): string {
  const parsed = normalizeOptionalWorkingDirectory(value);
  if (!parsed) {
    throw buildProfileWorkspacePathError({
      path: String(value),
      reason: "invalid_working_directory",
    });
  }

  const trimmed = parsed.trim();
  if (trimmed.length === 0) {
    throw buildProfileWorkspacePathError({
      path: String(value),
      reason: "invalid_working_directory",
    });
  }

  const expanded = expandTildePath(trimmed);
  if (expanded === null) {
    throw buildProfileWorkspacePathError({
      path: trimmed,
      reason: "invalid_home_reference",
    });
  }
  if (!isAbsolute(expanded)) {
    throw buildProfileWorkspacePathError({
      path: trimmed,
      reason: "relative_path",
    });
  }

  const resolvedPath = resolve(expanded);
  const normalizedResolvedPath =
    normalizeOptionalWorkingDirectory(resolvedPath)?.trim() ?? null;
  if (!normalizedResolvedPath) {
    throw buildProfileWorkspacePathError({
      path: resolvedPath,
      reason: "invalid_working_directory",
    });
  }

  return normalizedResolvedPath;
}

export async function validateCustomProfileWorkspacePath(
  value: string
): Promise<CustomProfileWorkspacePathValidationResult> {
  let normalizedPath: string;
  try {
    normalizedPath = normalizeCustomProfileWorkspacePath(value);
  } catch (error) {
    if (error instanceof ProfileWorkspacePathError) {
      return {
        path: error.path,
        reason: error.reason,
        status: "invalid",
      };
    }
    throw error;
  }

  try {
    const stats = await stat(normalizedPath);
    if (!stats.isDirectory()) {
      return {
        path: normalizedPath,
        reason: "not_directory",
        status: "invalid",
      };
    }
    if (!hasRequiredWorkspaceModeBits(stats)) {
      return {
        path: normalizedPath,
        reason: "not_accessible",
        status: "invalid",
      };
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        path: normalizedPath,
        reason: "not_found",
        status: "invalid",
      };
    }
    if (isPermissionError(error)) {
      return {
        path: normalizedPath,
        reason: "not_accessible",
        status: "invalid",
      };
    }
    throw error;
  }

  return {
    status: "valid",
    value: normalizedPath,
  };
}

function hasRequiredWorkspaceModeBits(stats: Stats): boolean {
  const currentUserId = process.getuid?.();
  if (currentUserId === undefined) {
    return true;
  }

  let modeBits: number;
  if (stats.uid === currentUserId) {
    modeBits = Math.floor(stats.mode / 0o100) % 0o10;
  } else {
    const currentGroupIds = new Set([
      process.getgid?.(),
      ...(process.getgroups?.() ?? []),
    ]);
    modeBits = currentGroupIds.has(stats.gid)
      ? Math.floor(stats.mode / 0o10) % 0o10
      : stats.mode % 0o10;
  }
  return modeBits === REQUIRED_WORKSPACE_ACCESS_MODE;
}

function expandTildePath(value: string): string | null {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }
  if (value.startsWith("~")) {
    return null;
  }
  return value;
}

function buildProfileWorkspacePathError(input: {
  path: string;
  reason: ProfileWorkspacePathErrorReason;
}): ProfileWorkspacePathError {
  return new ProfileWorkspacePathError({
    message: describeProfileWorkspacePathValidationFailure(input),
    path: input.path,
    reason: input.reason,
  });
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isPermissionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "EACCES" ||
      (error as { code?: string }).code === "EPERM")
  );
}
