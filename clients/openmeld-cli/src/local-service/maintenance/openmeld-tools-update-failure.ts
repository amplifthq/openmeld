import { openMeldToolsUpdateFailureCodeSchema } from "@openmeld/schemas";
import type { OpenMeldToolsUpdateFailureCode } from "@openmeld/schemas/types";
import { toErrorMessage } from "@openmeld/utils";

const PERSISTED_FAILURE_PREFIX = "openmeld.tools.update.failure=";
const INTERNAL_FAILURE_PREFIX = "openmeld.tools.update.";
const LINE_SPLIT_RE = /\r?\n/u;

export class OpenMeldToolsUpdateFailureError extends Error {
  readonly failureCode: OpenMeldToolsUpdateFailureCode;

  constructor(input: {
    cause?: unknown;
    failureCode: OpenMeldToolsUpdateFailureCode;
    message: string;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = "OpenMeldToolsUpdateFailureError";
    this.failureCode = openMeldToolsUpdateFailureCodeSchema.parse(
      input.failureCode
    );
  }
}

export function withOpenMeldToolsUpdateFailure(
  error: unknown,
  fallbackCode: OpenMeldToolsUpdateFailureCode
): OpenMeldToolsUpdateFailureError {
  const existing = resolveOpenMeldToolsUpdateFailure(error);
  if (error instanceof OpenMeldToolsUpdateFailureError && existing) {
    return error;
  }
  return new OpenMeldToolsUpdateFailureError({
    cause: error,
    failureCode: existing ?? fallbackCode,
    message: toErrorMessage(error),
  });
}

export function resolveOpenMeldToolsUpdateFailure(
  error: unknown
): OpenMeldToolsUpdateFailureCode | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const direct = openMeldToolsUpdateFailureCodeSchema.safeParse(
      (current as { failureCode?: unknown }).failureCode
    );
    if (direct.success) {
      return direct.data;
    }
    const internalCode = (current as { code?: unknown }).code;
    if (typeof internalCode === "string") {
      const parsed = openMeldToolsUpdateFailureCodeSchema.safeParse(
        internalCode.startsWith(INTERNAL_FAILURE_PREFIX)
          ? `cli.update.${internalCode.slice(INTERNAL_FAILURE_PREFIX.length)}`
          : internalCode
      );
      if (parsed.success) {
        return parsed.data;
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function encodePersistedOpenMeldToolsUpdateFailure(input: {
  detail: string;
  failureCode: OpenMeldToolsUpdateFailureCode;
}): string {
  const failureCode = openMeldToolsUpdateFailureCodeSchema.parse(
    input.failureCode
  );
  const detail = input.detail.trim();
  return `${PERSISTED_FAILURE_PREFIX}${failureCode}${
    detail ? `\n${detail}` : ""
  }`;
}

export function resolvePersistedOpenMeldToolsUpdateFailure(
  errorMessage: string | null
): OpenMeldToolsUpdateFailureCode | null {
  if (!errorMessage?.startsWith(PERSISTED_FAILURE_PREFIX)) {
    return null;
  }
  const firstLine = errorMessage.split(LINE_SPLIT_RE, 1)[0] ?? "";
  const parsed = openMeldToolsUpdateFailureCodeSchema.safeParse(
    firstLine.slice(PERSISTED_FAILURE_PREFIX.length)
  );
  return parsed.success ? parsed.data : null;
}
