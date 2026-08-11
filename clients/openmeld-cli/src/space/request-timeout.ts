import {
  DEFAULT_SPACE_CONVERSATION_VALIDATE_TIMEOUT_MS,
  DEFAULT_SPACE_REQUEST_TIMEOUT_MS,
  MAX_SPACE_REQUEST_TIMEOUT_MS,
  MIN_SPACE_REQUEST_TIMEOUT_MS,
} from "../strategy-constants";

const SPACE_REQUEST_TIMEOUT_ENV_KEY = "OPENMELD_SPACE_REQUEST_TIMEOUT_MS";

export function resolveSpaceRequestTimeoutMs(override?: number): number {
  if (isFinitePositiveNumber(override)) {
    return clampSpaceRequestTimeoutMs(override);
  }

  const fromEnv = Number.parseInt(
    String(process.env[SPACE_REQUEST_TIMEOUT_ENV_KEY] ?? ""),
    10
  );
  if (isFinitePositiveNumber(fromEnv)) {
    return clampSpaceRequestTimeoutMs(fromEnv);
  }

  return DEFAULT_SPACE_REQUEST_TIMEOUT_MS;
}

export function resolveSpaceRequestTimeoutMsForDiagnostics(): number {
  return resolveSpaceRequestTimeoutMs(undefined);
}

export function resolveSpaceConversationValidateTimeoutMs(): number {
  return Math.max(
    resolveSpaceRequestTimeoutMs(undefined),
    DEFAULT_SPACE_CONVERSATION_VALIDATE_TIMEOUT_MS
  );
}

function clampSpaceRequestTimeoutMs(value: number): number {
  const normalized = Math.trunc(value);
  return Math.max(
    MIN_SPACE_REQUEST_TIMEOUT_MS,
    Math.min(MAX_SPACE_REQUEST_TIMEOUT_MS, normalized)
  );
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
