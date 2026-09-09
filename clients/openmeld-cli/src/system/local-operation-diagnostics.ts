import { isAbsolute } from "node:path";
import type { PrepareStepDiagnosticsBundle } from "@openmeld/schemas/types";

const ERROR_CODES = new Set([
  "EPERM",
  "EACCES",
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "EROFS",
  "ENOSPC",
  "EBUSY",
  "ETXTBSY",
  "EEXIST",
  "EIO",
  "EMFILE",
  "ENFILE",
  "EINVAL",
  "ENAMETOOLONG",
]);
const SYSCALLS = new Set([
  "access",
  "open",
  "read",
  "write",
  "chmod",
  "chown",
  "copyfile",
  "rename",
  "unlink",
  "rmdir",
  "mkdir",
  "stat",
  "lstat",
  "realpath",
  "spawn",
]);
const APP_BUNDLE_PATH_PATTERN = /(?:^|[/\\])[^/\\]+\.app(?:[/\\]|$)/iu;

// Categories are safe to upload. Exact paths remain in local errors/journals.
export function classifyDiagnosticPath(
  value: unknown
): "app_bundle" | "absolute_other" | "relative" | "unknown" {
  if (typeof value !== "string" || !value) {
    return "unknown";
  }
  if (APP_BUNDLE_PATH_PATTERN.test(value)) {
    return "app_bundle";
  }
  return isAbsolute(value) ? "absolute_other" : "relative";
}

// Do not copy message, path, spawnargs, environment, or arbitrary error fields.
// EPERM/EACCES identify an operation failure, never an inferred TCC verdict.
export function collectLocalOperationFailure(
  error: unknown
): PrepareStepDiagnosticsBundle["operationFailure"] {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const native = current as NodeJS.ErrnoException & { dest?: unknown };
    if (native.code && ERROR_CODES.has(native.code)) {
      return {
        code: native.code,
        ...(Number.isSafeInteger(native.errno) ? { errno: native.errno } : {}),
        ...(native.syscall && SYSCALLS.has(native.syscall)
          ? { syscall: native.syscall }
          : {}),
        pathCategory: classifyDiagnosticPath(native.path),
        ...(native.dest === undefined
          ? {}
          : {
              destinationCategory: classifyDiagnosticPath(native.dest),
            }),
      };
    }
    current = current.cause;
  }
  return undefined;
}
