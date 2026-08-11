// L2 — state model. Pure functions mapping the CLI `--json` results
// (shared/types.ts) into the GUI view contract (shared/view-types.ts).
// No I/O, no Electron — fully unit-testable.
//
// Field paths are read defensively: the CLI's status/agents payloads are rich
// and may evolve, so every access narrows + falls back to a safe "unknown"
// rather than trusting a shape. Confirmed against the CLI source:
//   - `service status --json` → { result: { installed: boolean,
//       runtime?: { status: "running"|"stale"|"not_running"|"unknown" } },
//       runtimeProjection }   (liveness is the `status` string, NOT a boolean;
//       the CLI itself treats live as status === "running")
//   - `agents detect --json`  → { detectedAgents: [{ id, displayName,
//       lifecycleStatus, selectable, blockerReasonCodes, launchStatus }] }
//   - `agents list --json`    → { registrations: [{ agentId, displayName,
//       enabled, lifecycleStatus }] }
//   - `agents show --json`    → { agent: { agentId }, agentControllerInterface }

import { agentControllerInterfaceSnapshotSchema } from "@openmeld/schemas";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import type { CliCommandFailure, CliCommandResult } from "../../shared/types";
import type {
  AgentsView,
  AgentView,
  CliProblem,
  ServiceLifecycle,
  ServiceView,
} from "../../shared/view-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asAgentLifecycleStatus(
  value: unknown
): AgentView["lifecycleStatus"] | null {
  return value === "active" || value === "suspended" ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function problemFromFailure(failure: CliCommandFailure): CliProblem {
  return {
    kind: failure.kind,
    code: failure.error.code,
    message: failure.error.message,
    requestId: failure.error.requestId ?? null,
  };
}

/**
 * Map the CLI's runtime liveness `status` string to a coarse boolean.
 * "running" → live; "not_running"/"stale" → not live (stale = recorded-running
 * but unverifiable, which the CLI itself resolves toward not_running, so the
 * GUI should offer recovery rather than claim liveness); "unknown"/absent →
 * indeterminate (null).
 */
function liveFromRuntimeStatus(status: string | null): boolean | null {
  if (status === "running") {
    return true;
  }
  if (status === "not_running" || status === "stale") {
    return false;
  }
  return null;
}

function deriveLifecycle(
  installed: boolean | null,
  running: boolean | null
): ServiceLifecycle {
  if (installed === false) {
    return "not_installed";
  }
  if (installed === true && running === true) {
    return "running";
  }
  if (installed === true && running === false) {
    return "stopped";
  }
  return "unknown";
}

function readCliVersion(value: unknown): ServiceView["cliVersion"] {
  if (!isRecord(value)) {
    return null;
  }
  return {
    currentVersion: asString(value.currentVersion),
    latestVersion: asString(value.latestVersion),
    requiredVersion: asString(value.requiredVersion),
    updateAvailable: asBoolean(value.updateAvailable),
    checked: asBoolean(value.checked) ?? false,
  };
}

function readServiceAttention(value: unknown): ServiceView["attention"] {
  if (!isRecord(value)) {
    return null;
  }
  const code = asString(value.code);
  if (!code) {
    return null;
  }
  return {
    code,
    level: asString(value.level),
    message: asString(value.message),
    nextStep: asString(value.nextStep),
    anomalyCodes: asStringArray(value.anomalyCodes),
  };
}

/** Map a `service status --json` result into the coarse GUI service view. */
export function toServiceView(result: CliCommandResult): ServiceView {
  if (!result.ok) {
    return {
      lifecycle: "unknown",
      installed: null,
      running: null,
      autoStart: null,
      cliVersion: null,
      runtimeProjection: null,
      attention: null,
      problem: problemFromFailure(result),
    };
  }

  const statusResult = isRecord(result.data.result) ? result.data.result : null;
  const localResult = isRecord(result.data.localResult)
    ? result.data.localResult
    : null;
  const serviceManagerStatus = isRecord(localResult?.serviceManagerStatus)
    ? localResult.serviceManagerStatus
    : null;
  const runtime = isRecord(statusResult?.runtime) ? statusResult.runtime : null;
  const installed = asBoolean(statusResult?.installed);
  const running = liveFromRuntimeStatus(asString(runtime?.status));
  const autoStart = asBoolean(serviceManagerStatus?.enabled);

  return {
    lifecycle: deriveLifecycle(installed, running),
    installed,
    running,
    autoStart,
    cliVersion: readCliVersion(result.data.cliVersion),
    runtimeProjection: result.data.runtimeProjection ?? null,
    attention: readServiceAttention(result.data.attention),
    problem: null,
  };
}

/** Build the agentId → enabled map from an `agents list` result. */
function readEnabledById(
  list?: CliCommandResult | null
): Map<string, boolean | null> {
  const map = new Map<string, boolean | null>();
  if (!list?.ok) {
    return map;
  }
  for (const raw of asArray(list.data.registrations)) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = asString(raw.agentId) ?? asString(raw.id);
    if (id !== null) {
      map.set(id, asBoolean(raw.enabled));
    }
  }
  return map;
}

function readAgentControllerInterfaceById(
  showResults?: readonly CliCommandResult[] | null
): Map<string, AgentControllerInterfaceSnapshot> {
  const map = new Map<string, AgentControllerInterfaceSnapshot>();
  if (!showResults) {
    return map;
  }
  for (const result of showResults) {
    if (!result.ok) {
      continue;
    }
    const rawAgent = isRecord(result.data.agent) ? result.data.agent : null;
    const id = asString(rawAgent?.agentId) ?? asString(rawAgent?.id);
    if (!id || result.data.agentControllerInterface === null) {
      continue;
    }
    const parsed = agentControllerInterfaceSnapshotSchema.safeParse(
      result.data.agentControllerInterface
    );
    if (parsed.success) {
      map.set(id, parsed.data);
    }
  }
  return map;
}

/** Detected agents from `agents detect`, with `enabled` overlaid from list. */
function detectedAgentViews(
  detect: CliCommandResult,
  enabledById: Map<string, boolean | null>,
  agentControllerInterfaceById: Map<string, AgentControllerInterfaceSnapshot>
): AgentView[] {
  if (!detect.ok) {
    return [];
  }
  const views: AgentView[] = [];
  const seen = new Set<string>();
  for (const raw of asArray(detect.data.detectedAgents)) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = asString(raw.id);
    if (id === null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    views.push({
      id,
      displayName: asString(raw.displayName) ?? id,
      detected: true,
      lifecycleStatus: asAgentLifecycleStatus(raw.lifecycleStatus) ?? "active",
      selectable: asBoolean(raw.selectable) ?? false,
      enabled: enabledById.get(id) ?? null,
      blockerReasonCodes: asStringArray(raw.blockerReasonCodes),
      launchStatus: asString(raw.launchStatus),
      agentControllerInterface: agentControllerInterfaceById.get(id) ?? null,
    });
  }
  return views;
}

/** Registered agents from `agents list` that detect did not surface. */
function listOnlyAgentViews(
  list: CliCommandResult | null | undefined,
  seen: Set<string>,
  agentControllerInterfaceById: Map<string, AgentControllerInterfaceSnapshot>
): AgentView[] {
  if (!list?.ok) {
    return [];
  }
  const views: AgentView[] = [];
  for (const raw of asArray(list.data.registrations)) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = asString(raw.agentId) ?? asString(raw.id);
    if (id === null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    views.push({
      id,
      displayName: asString(raw.displayName) ?? id,
      detected: false,
      lifecycleStatus: asAgentLifecycleStatus(raw.lifecycleStatus) ?? "active",
      selectable: false,
      enabled: asBoolean(raw.enabled),
      blockerReasonCodes: [],
      launchStatus: null,
      agentControllerInterface: agentControllerInterfaceById.get(id) ?? null,
    });
  }
  return views;
}

/**
 * Map `agents detect` (the catalog) + optional `agents list` (the enabled set)
 * into a unified agent view. Detect drives order and selectability; list
 * overlays `enabled`. Agents present only in `list` are appended as
 * not-detected. A failure of either command is surfaced via `problem`
 * (detect failure takes priority).
 */
export function toAgentsView(
  detect: CliCommandResult,
  list?: CliCommandResult | null,
  showResults?: readonly CliCommandResult[] | null
): AgentsView {
  const enabledById = readEnabledById(list);
  const agentControllerInterfaceById =
    readAgentControllerInterfaceById(showResults);
  const detected = detectedAgentViews(
    detect,
    enabledById,
    agentControllerInterfaceById
  );
  const seen = new Set(detected.map((agent) => agent.id));
  const listOnly = listOnlyAgentViews(list, seen, agentControllerInterfaceById);

  const detectProblem = detect.ok ? null : problemFromFailure(detect);
  const listProblem = list && !list.ok ? problemFromFailure(list) : null;

  return {
    agents: [...detected, ...listOnly],
    problem: detectProblem ?? listProblem,
  };
}
