import {
  DAEMON_SERVICE_RUNTIME_DETACHED_ENV,
  DAEMON_SERVICE_RUNTIME_MODE_ENV,
  DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
  type DaemonRunMode,
  type DaemonServiceController,
  type DaemonServiceRuntimeMetadata,
} from "../../config/daemon-state";
import {
  DEFAULT_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  RUNTIME_STATE_PERSIST_MIN_INTERVAL_MS,
} from "../core/constants";
import { normalizeText } from "../core/logger";
import type { ServiceConnectionDegradedReason } from "./service-connection-state";

const AUTHENTICATION_REQUIRED_RECONNECT_MAX_DELAY_MS = 15 * 60 * 1000;
const AUTHENTICATION_REQUIRED_RECONNECT_DELAYS_MS = [
  60_000,
  5 * 60_000,
  AUTHENTICATION_REQUIRED_RECONNECT_MAX_DELAY_MS,
] as const;

export function resolveDaemonRunMode(
  inputMode: DaemonRunMode | undefined
): DaemonRunMode {
  if (process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] === "1") {
    return "background";
  }

  const envMode = parseDaemonRunMode(
    process.env[DAEMON_SERVICE_RUNTIME_MODE_ENV]
  );
  if (envMode) {
    return envMode;
  }
  if (inputMode === "foreground") {
    return "foreground";
  }
  return "background";
}

export function parseDaemonRunMode(value: unknown): DaemonRunMode | null {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "foreground" || normalized === "background") {
    return normalized;
  }
  return null;
}

export function shouldPersistDaemonRuntimeState(input: {
  forcePersist: boolean;
  lastPersistedAtMs: number;
  nowMs: number;
  updates: Partial<{
    heartbeatAt: string | null;
    updatedAt: string;
    stopRequestedAt: string | null;
  }>;
}): boolean {
  if (input.forcePersist) {
    return true;
  }
  if ("stopRequestedAt" in input.updates) {
    return true;
  }
  return (
    input.nowMs - input.lastPersistedAtMs >=
    RUNTIME_STATE_PERSIST_MIN_INTERVAL_MS
  );
}

export function resolveReconnectBackoffMs(attempt: number): number {
  const normalizedAttempt = Math.max(1, attempt);
  const next = DEFAULT_RECONNECT_DELAY_MS * 2 ** (normalizedAttempt - 1);
  return Math.min(MAX_RECONNECT_DELAY_MS, next);
}

export function resolveServiceConnectionReconnectBackoffMs(input: {
  attempt: number;
  reason: ServiceConnectionDegradedReason | null;
}): number {
  if (input.reason !== "auth_rejected") {
    return resolveReconnectBackoffMs(input.attempt);
  }
  const index = Math.max(0, input.attempt - 1);
  return (
    AUTHENTICATION_REQUIRED_RECONNECT_DELAYS_MS[index] ??
    AUTHENTICATION_REQUIRED_RECONNECT_DELAYS_MS.at(-1) ??
    AUTHENTICATION_REQUIRED_RECONNECT_MAX_DELAY_MS
  );
}

export function toDaemonStreamUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/daemon/stream";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildDaemonProcessCommand(): string {
  const script = normalizeText(process.argv[1]);
  const args = process.argv.slice(2);
  const values = script ? [script, ...args] : args;
  if (values.length === 0) {
    return process.execPath;
  }
  return `${process.execPath} ${values.join(" ")}`;
}

export function createDaemonRuntimeState(input: {
  command: string;
  gatewayUrl: string | null;
  heartbeatAt: string | null;
  mode: DaemonRunMode;
  pid: number;
  openMeldProfileId: string | null;
  workingDirectory: string | null;
  runtimeMetadata: DaemonServiceRuntimeMetadata;
  startedAt: string;
  stopRequestedAt: string | null;
  updatedAt: string;
}): {
  command: string;
  gatewayUrl: string | null;
  heartbeatAt: string | null;
  mode: DaemonRunMode;
  pid: number;
  openMeldProfileId: string | null;
  workingDirectory: string | null;
  startedAt: string;
  stopRequestedAt: string | null;
  status: "running";
  v: 1;
  schema: typeof DAEMON_SERVICE_RUNTIME_STATE_SCHEMA;
  updatedAt: string;
  managedBySystemService: boolean;
  serviceController: DaemonServiceController;
  autoStart: boolean;
} {
  return {
    v: 1,
    schema: DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
    status: "running",
    mode: input.mode,
    pid: input.pid,
    command: input.command,
    gatewayUrl: input.gatewayUrl,
    openMeldProfileId: input.openMeldProfileId,
    workingDirectory: input.workingDirectory,
    stopRequestedAt: input.stopRequestedAt,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    heartbeatAt: input.heartbeatAt,
    managedBySystemService: input.runtimeMetadata.managedBySystemService,
    serviceController: input.runtimeMetadata.serviceController,
    autoStart: input.runtimeMetadata.autoStart,
  };
}
