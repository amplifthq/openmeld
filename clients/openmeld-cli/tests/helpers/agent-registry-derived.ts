import { buildAgentControllerRef } from "@openmeld/agent-runtime";
import type { AgentTargetState } from "../../src/agents/registry";
import {
  createDefaultRuntimeAgentControllerSettings,
  type RuntimeAgentControllerState,
  type RuntimeAgentTransportMode,
} from "../../src/config/runtime-config";
import { resolveSkillsAgentRegistry } from "../../src/skills/agents";

type PreferredBuiltinMetadata = {
  agentId: string;
  displayName: string;
  transportModes: Array<{
    mode: RuntimeAgentTransportMode;
    label: string;
    description: string;
  }>;
  defaultTransportMode: RuntimeAgentTransportMode;
};

export function resolvePreferredRunnableControllerId(): string {
  return resolvePreferredBuiltinMetadata().agentId;
}

export function resolvePreferredAgentControllerRef(): string {
  return buildAgentControllerRef({
    kind: "builtin",
    id: resolvePreferredRunnableControllerId(),
  });
}

export function resolvePreferredTransportModeSelection(): RuntimeAgentTransportMode {
  const metadata = resolvePreferredBuiltinMetadata();
  return (
    metadata.transportModes.find(
      (transportMode) => transportMode.mode !== metadata.defaultTransportMode
    )?.mode ??
    metadata.transportModes[0]?.mode ??
    metadata.defaultTransportMode
  );
}

export function createEnabledPreferredBuiltinControllerState(
  transportMode?: RuntimeAgentTransportMode
): RuntimeAgentControllerState {
  const metadata = resolvePreferredBuiltinMetadata();
  const defaults = createDefaultRuntimeAgentControllerSettings(
    metadata.agentId
  );
  const selectedTransportMode =
    transportMode ?? metadata.defaultTransportMode ?? defaults.transportMode;
  return {
    agentId: metadata.agentId,
    displayName: metadata.displayName,
    enabled: true,
    transportMode: selectedTransportMode,
    timeoutMs: defaults.timeoutMs,
    retry: defaults.retry,
    contextIdMappingSpec: defaults.contextIdMappingSpec,
    registeredAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

export function createEnabledPreferredBuiltinTargetState(): AgentTargetState {
  const metadata = resolvePreferredBuiltinMetadata();
  const defaults = createDefaultRuntimeAgentControllerSettings(
    metadata.agentId
  );
  const registration = createEnabledPreferredBuiltinControllerState(
    metadata.defaultTransportMode
  );
  return {
    agentId: metadata.agentId,
    displayName: metadata.displayName,
    targetKind: "builtin",
    detected: true,
    runtimeSupported: true,
    transportModes: metadata.transportModes,
    defaultTransportMode: metadata.defaultTransportMode,
    contextIdMappingSpec: defaults.contextIdMappingSpec,
    lifecycleStatus: "active",
    selectable: true,
    selectableReason: null,
    installChoices: [],
    launchStatus: "ready",
    launchStatusDetail: null,
    launchContract: {
      kind: "executable",
      commandPath: `/usr/local/bin/${metadata.agentId}`,
    },
    registered: true,
    enabled: true,
    registration,
  };
}

function resolvePreferredBuiltinMetadata(): PreferredBuiltinMetadata {
  const registry = resolveSkillsAgentRegistry();
  for (const [agentId, entry] of Object.entries(registry)) {
    if (!(entry.runtimeSupported && entry.transportModes.length > 0)) {
      continue;
    }
    const defaultTransportMode =
      entry.defaultTransportMode ?? entry.transportModes[0]?.mode;
    if (!defaultTransportMode) {
      continue;
    }
    return {
      agentId,
      displayName: entry.displayName,
      transportModes: entry.transportModes.map((transportMode) => ({
        mode: transportMode.mode,
        label: transportMode.label,
        description: transportMode.description,
      })),
      defaultTransportMode,
    };
  }
  return {
    agentId: "codex",
    displayName: "Codex",
    transportModes: [
      {
        mode: "local-cli",
        label: "Local CLI (Default)",
        description:
          "Run via local CLI on this computer, with session continuation when available.",
      },
    ],
    defaultTransportMode: "local-cli",
  };
}
