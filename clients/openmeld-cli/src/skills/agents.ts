import { resolveBuiltinAgentControllerDefinition } from "../agents/builtin-agent-controller-definitions";
import {
  type AgentsRegistryAgent,
  type AgentsRegistryLifecycleStatus,
  evaluateRegistryDetection,
  listBuiltinAgentsRegistryEntries,
  resolveRegistryTemplate,
} from "../agents/registry-source";
import { isPublishedOpenMeldHome } from "../config/paths";
import type {
  RuntimeAgentStreamingMode,
  RuntimeAgentTransportMode,
  RuntimeSkillsConfig,
} from "../config/runtime-config";
import { mapWithConcurrency } from "../lib/map-with-concurrency";

export type SkillsAgentTransportMode = {
  mode: RuntimeAgentTransportMode;
  label: string;
  description: string;
};

export type SkillsAgentRegistryEntry = {
  name: string;
  displayName: string;
  skillsDir: string;
  globalSkillsDir?: string;
  globalSkillsDirSource: "config-override" | "registry-default";
  detectInstalled: () => Promise<boolean>;
  lifecycleStatus: AgentsRegistryLifecycleStatus;
  runtimeSupported: boolean;
  skillsInstallable: boolean;
  transportModes: SkillsAgentTransportMode[];
  defaultTransportMode?: RuntimeAgentTransportMode;
  defaultStreamingMode?: RuntimeAgentStreamingMode;
};

const TRANSPORT_MODE_METADATA: Record<
  RuntimeAgentTransportMode,
  { label: string; description: string }
> = {
  "local-cli": {
    label: "Local CLI (Default)",
    description:
      "Run via local CLI on this computer, with session continuation when available.",
  },
  "codex-app-server": {
    label: "Codex App Server",
    description:
      "Run Codex through the local Codex App Server with native thread control.",
  },
  acp: {
    label: "Agent Client Protocol (ACP)",
    description:
      "Run Cursor through its structured local ACP interface with resumable sessions.",
  },
};
const SUPPORTED_RUNTIME_STREAMING_MODES = new Set<RuntimeAgentStreamingMode>([
  "final",
  "stream",
]);
const DEFAULT_AGENT_DETECTION_PROBE_TIMEOUT_MS = 3000;
const MAX_CONCURRENT_AGENT_DETECTIONS = 4;

export function resolveSkillsAgentRegistry(
  skillsConfig?: RuntimeSkillsConfig | null
): Record<string, SkillsAgentRegistryEntry> {
  const overrides = skillsConfig?.agents ?? {};
  const merged: Record<string, SkillsAgentRegistryEntry> = {};

  for (const agent of listBuiltinAgentsRegistryEntries()) {
    const override = overrides[agent.id];
    const overrideSkillsDir = normalizeOptionalNonEmptyString(
      override?.skillsDir
    );
    const overrideGlobalSkillsDir = normalizeOptionalNonEmptyString(
      override?.globalSkillsDir
    );
    const transportModes = resolveAgentTransportModes(agent);
    const defaultTransportMode = resolveDefaultTransportMode(
      agent,
      transportModes
    );
    const defaultStreamingMode = resolveDefaultStreamingMode(agent);

    merged[agent.id] = {
      name: agent.id,
      displayName: agent.displayName,
      skillsDir: overrideSkillsDir ?? resolveRegistryTemplate(agent.skillsDir),
      ...(overrideGlobalSkillsDir
        ? { globalSkillsDir: overrideGlobalSkillsDir }
        : resolveRegistryGlobalSkillsDir(agent.globalSkillsDir)),
      globalSkillsDirSource: overrideGlobalSkillsDir
        ? "config-override"
        : "registry-default",
      detectInstalled: async () => detectInstalledBuiltinAgent(agent),
      ...resolveRegistryMetadata(agent),
      transportModes,
      ...(defaultTransportMode ? { defaultTransportMode } : {}),
      ...(defaultStreamingMode ? { defaultStreamingMode } : {}),
    };
  }

  return merged;
}

/**
 * Whether this CLI may manage the registry-default agent skills directories
 * (`~/.claude/skills` and friends). Those directories are shared real-user
 * state owned by the published `~/.openmeld` lane: a CLI running with a
 * lane-specific OpenMeld home must not detect, track, or install into them,
 * because pointing a shared agent directory at a lane-local skills store
 * hijacks the published install and dangles once the lane is deleted.
 * Explicitly configured targets (`--dir`, config custom targets, per-agent
 * `globalSkillsDir` overrides) stay available for lane-local testing.
 */
export function canManageRegistryAgentSkillTargets(): boolean {
  return isPublishedOpenMeldHome();
}

export async function detectInstalledSkillsAgents(
  registry: Record<string, SkillsAgentRegistryEntry>
): Promise<string[]> {
  const allowRegistryDefaults = canManageRegistryAgentSkillTargets();
  return await detectInstalledRegistryAgents({
    entries: Object.entries(registry).filter(
      ([, config]) =>
        allowRegistryDefaults ||
        config.globalSkillsDirSource === "config-override"
    ),
  });
}

/**
 * Detects local Agent Controllers without granting a lane permission to manage
 * their shared skills directories. Runtime discovery is read-only machine
 * evidence and must remain available in isolated dev and canary lanes.
 */
export async function detectInstalledRuntimeAgents(
  registry: Record<string, SkillsAgentRegistryEntry>
): Promise<string[]> {
  const allowRegistryDefaults = canManageRegistryAgentSkillTargets();
  return await detectInstalledRegistryAgents({
    entries: Object.entries(registry).filter(
      ([, config]) =>
        config.runtimeSupported ||
        allowRegistryDefaults ||
        config.globalSkillsDirSource === "config-override"
    ),
  });
}

async function detectInstalledRegistryAgents(input: {
  entries: [string, SkillsAgentRegistryEntry][];
}): Promise<string[]> {
  const checks = await mapWithConcurrency(
    input.entries,
    MAX_CONCURRENT_AGENT_DETECTIONS,
    async ([agentName, config]) => ({
      agentName,
      installed: await config.detectInstalled(),
    })
  );

  return checks
    .filter((entry) => entry.installed)
    .map((entry) => entry.agentName)
    .sort((a, b) => a.localeCompare(b));
}

async function detectInstalledBuiltinAgent(
  agent: AgentsRegistryAgent
): Promise<boolean> {
  const auxiliaryDetected = evaluateRegistryDetection(agent.detection);
  if (!(agent.category === "builtin" && agent.runtime.supported)) {
    return auxiliaryDetected;
  }

  const installResolver = resolveBuiltinAgentControllerDefinition(
    agent.id
  )?.installResolver;
  if (!installResolver) {
    return auxiliaryDetected;
  }

  const installedCandidates =
    await installResolver.resolveInstalledLaunchCandidates({
      timeoutMs: resolveAgentDetectionProbeTimeoutMs(),
    });
  if (installedCandidates.ok) {
    return installedCandidates.candidates.length > 0;
  }
  // "not_launchable" still means OpenMeld found this agent on this computer --
  // e.g. an OS permission check (Gatekeeper) blocks it from starting right
  // now. Report it as detected so downstream install resolution can surface
  // the real reason as a needs-repair status, instead of this collapsing into
  // "not found on this computer" and disappearing from every agent picker.
  return installedCandidates.reason === "not_launchable";
}

function resolveRegistryMetadata(
  agent: AgentsRegistryAgent
): Pick<
  SkillsAgentRegistryEntry,
  "lifecycleStatus" | "runtimeSupported" | "skillsInstallable"
> {
  return {
    lifecycleStatus: agent.lifecycle.status,
    runtimeSupported: agent.runtime.supported,
    skillsInstallable: agent.service.skillsInstallable,
  };
}

function resolveRegistryGlobalSkillsDir(value: string | string[] | undefined): {
  globalSkillsDir?: string;
} {
  if (typeof value === "string") {
    const resolved = normalizeOptionalNonEmptyString(
      resolveRegistryTemplate(value)
    );
    return resolved ? { globalSkillsDir: resolved } : {};
  }
  if (!Array.isArray(value)) {
    return {};
  }
  for (const candidate of value) {
    const resolved = normalizeOptionalNonEmptyString(
      resolveRegistryTemplate(candidate)
    );
    if (resolved) {
      return { globalSkillsDir: resolved };
    }
  }
  return {};
}

function resolveAgentTransportModes(
  agent: AgentsRegistryAgent
): SkillsAgentTransportMode[] {
  if (!agent.runtime.supported) {
    return [];
  }
  const adapterModes = new Set<RuntimeAgentTransportMode>();
  for (const adapter of agent.runtime.adapters) {
    for (const mode of adapter.transportModes) {
      adapterModes.add(mode);
    }
  }
  return [...adapterModes].map((mode) => {
    const metadata = TRANSPORT_MODE_METADATA[mode];
    return {
      mode,
      label: metadata.label,
      description: metadata.description,
    };
  });
}

function resolveDefaultTransportMode(
  agent: AgentsRegistryAgent,
  transportModes: SkillsAgentTransportMode[]
): RuntimeAgentTransportMode | undefined {
  if (transportModes.length === 0) {
    return undefined;
  }
  const configuredDefaultMode = agent.defaultTransportMode;
  if (
    configuredDefaultMode &&
    transportModes.some(
      (transportMode) => transportMode.mode === configuredDefaultMode
    )
  ) {
    return configuredDefaultMode;
  }
  return transportModes[0]?.mode;
}

function resolveDefaultStreamingMode(
  agent: AgentsRegistryAgent
): RuntimeAgentStreamingMode | undefined {
  const configured = agent.defaultStreamingMode;
  if (configured && isRuntimeStreamingMode(configured)) {
    return configured;
  }
  return undefined;
}

function isRuntimeStreamingMode(
  value: unknown
): value is RuntimeAgentStreamingMode {
  return SUPPORTED_RUNTIME_STREAMING_MODES.has(
    value as RuntimeAgentStreamingMode
  );
}

function resolveAgentDetectionProbeTimeoutMs(): number {
  const raw = normalizeOptionalNonEmptyString(
    process.env.OPENMELD_AGENT_DETECTION_PROBE_TIMEOUT_MS
  );
  if (!raw) {
    return DEFAULT_AGENT_DETECTION_PROBE_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_AGENT_DETECTION_PROBE_TIMEOUT_MS;
}

function normalizeOptionalNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
