import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type DesktopUpdaterFailureDiagnostic,
  desktopUpdaterFailureDiagnosticSchema,
} from "@openmeld/schemas";

const ERROR_CODE = /^(?:ERR_[A-Z0-9_]+|E[A-Z]+)$/u;
const NET_ERROR = /\b(ERR_[A-Z0-9_]+)\b/u;
const HTTP_STATUS = /^(?:HttpError: )?([45]\d{2})\b/u;

export function describeUpdateFailure(input: {
  error: unknown;
  stage: DesktopUpdaterFailureDiagnostic["stage"];
  currentVersion: string;
  targetVersion: string | null;
}): DesktopUpdaterFailureDiagnostic {
  const error = input.error instanceof Error ? input.error : null;
  const message = error?.message ?? "";
  const rawCode = error && "code" in error ? String(error.code) : "";
  const code = ERROR_CODE.test(rawCode)
    ? rawCode.slice(0, 80)
    : (NET_ERROR.exec(message)?.[1]?.slice(0, 80) ?? null);
  const rawStatus =
    error && "statusCode" in error
      ? Number(error.statusCode)
      : Number(HTTP_STATUS.exec(message)?.[1]);
  const httpStatus =
    Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
      ? rawStatus
      : null;
  // Native errors can contain signed URLs, headers, paths and response bodies.
  // Store bounded native codes and known classifications, never arbitrary text.
  let detail = "The updater reported an unclassified error.";
  if (httpStatus) {
    detail = "The update server returned an HTTP error.";
  } else if (code) {
    detail =
      "The updater reported a native error. Inspect the recorded error code.";
  } else if (message.toLowerCase().includes("checksum")) {
    detail = "The downloaded update failed checksum verification.";
  } else if (message.toLowerCase().includes("signature")) {
    detail = "The update failed signature verification.";
  } else if (message.toLowerCase().includes("draft")) {
    detail = "Desktop could not save drafts before restart.";
  }
  return desktopUpdaterFailureDiagnosticSchema.parse({
    format: 1,
    recordedAt: new Date().toISOString(),
    stage: input.stage,
    currentVersion: input.currentVersion.slice(0, 80),
    targetVersion: input.targetVersion?.slice(0, 80) ?? null,
    code,
    httpStatus,
    message: detail,
  });
}

export function recordUpdateFailure(
  path: string,
  record: DesktopUpdaterFailureDiagnostic
): void {
  const value = desktopUpdaterFailureDiagnosticSchema.parse(record);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}
