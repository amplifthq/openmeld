import { runtimeTransportModeSchema } from "@openmeld/schemas";
import type { RuntimeTransportMode } from "@openmeld/schemas/types";
import {
  sleep as sharedSleep,
  toErrorMessage as sharedToErrorMessage,
} from "@openmeld/utils";

import type {
  RuntimeAgentControllerConversationIdMappingSpec,
  RuntimeAgentStreamingMode,
  RuntimeAgentTransportMode,
} from "../../config/runtime-config";
import type { Presenter } from "../../runtime/presenter/types";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
} from "./constants";

export function emitRunLine(input: {
  code: string;
  payload?: unknown;
  presenter: Presenter;
  text: string;
}): void {
  if (input.presenter.view === "agent") {
    input.presenter.data({
      code: input.code,
      payload: {
        message: input.text,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
      },
    });
    return;
  }
  input.presenter.line({
    code: input.code,
    text: input.text,
  });
}

export function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeHeartbeatIntervalMs(
  value: number | undefined
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_HEARTBEAT_INTERVAL_MS;
  }
  return clampInteger(
    value,
    MIN_HEARTBEAT_INTERVAL_MS,
    MAX_HEARTBEAT_INTERVAL_MS
  );
}

export function parseTransportMode(
  value: unknown
): RuntimeAgentTransportMode | null {
  const parsed = runtimeTransportModeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseStreamingMode(
  value: unknown
): RuntimeAgentStreamingMode | null {
  if (value === "final" || value === "stream") {
    return value;
  }
  return null;
}

export function parseRuntimeTransportMode(
  value: unknown
): RuntimeTransportMode | null {
  return parseTransportMode(value);
}

export function parseDispatchSourceProfileKind(
  value: unknown
): "agent" | "human" | "system" | null {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "agent" ||
    normalized === "human" ||
    normalized === "system"
  ) {
    return normalized;
  }
  return null;
}

export function parseContextIdMappingSpec(
  value: unknown
): RuntimeAgentControllerConversationIdMappingSpec | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const sourceField = normalizeOptionalText(record.sourceField);
  const mappingVersion = normalizePositiveInteger(record.mappingVersion);
  if (!(sourceField && mappingVersion)) {
    return null;
  }
  return {
    sourceField,
    mappingVersion,
  };
}

export function parsePositiveInteger(value: unknown): number | null {
  if (!(typeof value === "number" && Number.isInteger(value) && value > 0)) {
    return null;
  }
  return value;
}

export function normalizeNonNegativeInteger(value: unknown): number | null {
  if (!(typeof value === "number" && Number.isInteger(value) && value >= 0)) {
    return null;
  }
  return value;
}

export function normalizePositiveInteger(value: unknown): number | null {
  return parsePositiveInteger(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

export function nowIsoString(): string {
  return new Date().toISOString();
}

type DaemonLogField =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

export function warnDaemonEvent(
  eventName: string,
  fields: Record<string, DaemonLogField | undefined>
): void {
  const definedFields = Object.fromEntries(
    Object.entries(fields).filter((entry) => entry[1] !== undefined)
  );
  console.warn(
    `${nowIsoString()} ${eventName} ${JSON.stringify(definedFields)}`
  );
}

export const toErrorMessage: (error: unknown) => string = sharedToErrorMessage;

export const sleep: (delayMs: number) => Promise<void> = sharedSleep;

export function dirnamePath(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastSlash <= 0) {
    return ".";
  }
  return path.slice(0, lastSlash);
}
