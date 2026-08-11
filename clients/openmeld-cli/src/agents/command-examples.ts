import type { RuntimeAgentTransportMode } from "../config/runtime-config";
import { getConfiguredSkillsConfig } from "../config/runtime-config";
import {
  resolveSkillsAgentRegistry,
  type SkillsAgentRegistryEntry,
} from "../skills/agents";
import { listAgentTargetStates } from "./registry";

const AGENT_EXAMPLE_PLACEHOLDER = "<agent-id>";
const AGENT_EXAMPLE_PAIR_PLACEHOLDER = "<agent-a> <agent-b>";
const TRANSPORT_MODE_EXAMPLE_PLACEHOLDER = "<transport-mode>";

export type TransportModeExample = {
  modeExample: string;
  supportedModes: RuntimeAgentTransportMode[];
};

export function resolveInstallableAgentExamplePair(
  registry?: Record<string, SkillsAgentRegistryEntry>
): string {
  const resolvedRegistry = registry ?? resolveSkillsAgentRegistry();
  const installableIds = Object.entries(resolvedRegistry)
    .filter(
      (entry) =>
        entry[1].lifecycleStatus !== "suspended" &&
        entry[1].skillsInstallable === true
    )
    .map((entry) => entry[0]);
  if (installableIds.length === 0) {
    return AGENT_EXAMPLE_PAIR_PLACEHOLDER;
  }
  if (installableIds.length === 1) {
    return installableIds[0] ?? AGENT_EXAMPLE_PLACEHOLDER;
  }
  return installableIds.slice(0, 2).join(" ");
}

export async function resolvePreferredRunnableControllerExample(): Promise<string> {
  const registry = await resolveConfiguredSkillsRegistry();
  const builtinOrder = Object.keys(registry);
  const states = await listAgentTargetStates().catch(() => []);
  const selectableBuiltinIds = new Set(
    states
      .filter(
        (state) =>
          state.targetKind === "builtin" &&
          state.lifecycleStatus !== "suspended" &&
          state.selectable
      )
      .map((state) => state.agentId)
  );
  const selectableController = builtinOrder.find((agentId) =>
    selectableBuiltinIds.has(agentId)
  );
  if (selectableController) {
    return selectableController;
  }
  const runtimeSupportedController = builtinOrder.find(
    (agentId) =>
      registry[agentId]?.lifecycleStatus !== "suspended" &&
      registry[agentId]?.runtimeSupported === true
  );
  return runtimeSupportedController ?? AGENT_EXAMPLE_PLACEHOLDER;
}

export async function resolveTransportModeExampleForController(
  controllerId?: string
): Promise<TransportModeExample> {
  const normalizedControllerId = String(controllerId ?? "").trim();
  const preferredControllerId =
    normalizedControllerId ||
    (await resolvePreferredRunnableControllerExample());
  const states = await listAgentTargetStates().catch(() => []);
  const matchedState = states.find(
    (state) =>
      state.targetKind === "builtin" && state.agentId === preferredControllerId
  );
  if (matchedState && matchedState.transportModes.length > 0) {
    const supportedModes = matchedState.transportModes.map(
      (transportMode) => transportMode.mode
    );
    return {
      modeExample: supportedModes[0] ?? TRANSPORT_MODE_EXAMPLE_PLACEHOLDER,
      supportedModes,
    };
  }

  const registry = await resolveConfiguredSkillsRegistry();
  const preferredEntry = registry[preferredControllerId];
  if (preferredEntry && preferredEntry.transportModes.length > 0) {
    const supportedModes = preferredEntry.transportModes.map(
      (transportMode) => transportMode.mode
    );
    return {
      modeExample: supportedModes[0] ?? TRANSPORT_MODE_EXAMPLE_PLACEHOLDER,
      supportedModes,
    };
  }

  for (const [_agentId, entry] of Object.entries(registry)) {
    if (!(entry.runtimeSupported && entry.transportModes.length > 0)) {
      continue;
    }
    const supportedModes = entry.transportModes.map(
      (transportMode) => transportMode.mode
    );
    return {
      modeExample: supportedModes[0] ?? TRANSPORT_MODE_EXAMPLE_PLACEHOLDER,
      supportedModes,
    };
  }

  return {
    modeExample: TRANSPORT_MODE_EXAMPLE_PLACEHOLDER,
    supportedModes: [],
  };
}

async function resolveConfiguredSkillsRegistry(): Promise<
  Record<string, SkillsAgentRegistryEntry>
> {
  const skillsConfig = await getConfiguredSkillsConfig().catch(() => null);
  return resolveSkillsAgentRegistry(skillsConfig);
}
