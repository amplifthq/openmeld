import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExecutableOnPath } from "@openmeld/adapter-core";
import {
  normalizeOptionalWorkingDirectory,
  runtimeTransportModeSchema,
} from "@openmeld/schemas";
import type {
  DaemonRuntimeAdapterCapabilitySnapshot,
  ProviderRuntimeCapabilityDeclaration,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";
import embeddedRegistry from "../../../../config/agents/registry.json";
import { readEmbeddedModelCatalog } from "../model-catalog/embedded";

export type AgentsRegistryCategory = "builtin" | "custom";
export type AgentsRegistryDetectionMode = "all" | "any";
export type AgentsRegistryDetectionCheckKind =
  | "pathExists"
  | "fileExists"
  | "envTruthy"
  | "commandExists";
export type AgentsRegistryPlatform = "all" | "darwin" | "linux" | "win32";
export type AgentsRegistryTransportMode = RuntimeTransportMode;
export type AgentsRegistryStreamingMode = "final" | "stream";
export type AgentsRegistryAgentControllerRefMatcherKind =
  | "contains"
  | "equals"
  | "prefix"
  | "suffix"
  | "regex";

export type AgentsRegistryAgentControllerRefMatcher = {
  kind: AgentsRegistryAgentControllerRefMatcherKind;
  values: string[];
};

export type AgentsRegistryRuntimeCapabilityDeclaration =
  ProviderRuntimeCapabilityDeclaration;

export type AgentsRegistryAdapterBinding = {
  adapterId: string;
  controllerRefMatcher: AgentsRegistryAgentControllerRefMatcher;
  transportModes: AgentsRegistryTransportMode[];
  capabilityDeclaration: AgentsRegistryRuntimeCapabilityDeclaration;
};

export type AgentsRegistryRuntimeSupport = {
  supported: boolean;
  adapters: AgentsRegistryAdapterBinding[];
};

export type AgentsRegistryLifecycleStatus = "active" | "suspended";

export type AgentsRegistryLifecycle = {
  status: AgentsRegistryLifecycleStatus;
};

export type AgentsRegistryOriginLaunch = {
  commandTemplate: string;
  unselectedModelCommandTemplate?: string;
};

export type AgentsRegistryRuntimeAdapterMatch = {
  agentId: string;
  adapterId: string;
  controllerRefMatcher: AgentsRegistryAgentControllerRefMatcher;
  transportModes: AgentsRegistryTransportMode[];
  defaultTransportMode?: AgentsRegistryTransportMode;
  defaultStreamingMode?: AgentsRegistryStreamingMode;
};

export type AgentsRegistryResolvedRuntimeAdapterContract =
  AgentsRegistryRuntimeAdapterMatch & {
    capabilityDeclaration: AgentsRegistryRuntimeCapabilityDeclaration;
  };

export type AgentsRegistryRuntimeAdapterCapabilitySnapshot =
  DaemonRuntimeAdapterCapabilitySnapshot;

export type AgentsRegistryDetectionCheck = {
  kind: AgentsRegistryDetectionCheckKind;
  value: string;
  platform?: AgentsRegistryPlatform;
};

export type AgentsRegistryDetection = {
  mode: AgentsRegistryDetectionMode;
  checks: AgentsRegistryDetectionCheck[];
};

export type AgentsRegistryServiceCapability = {
  skillsInstallable: boolean;
};

export type AgentsRegistryAgent = {
  id: string;
  displayName: string;
  category: AgentsRegistryCategory;
  skillsDir: string;
  globalSkillsDir?: string | string[];
  detection: AgentsRegistryDetection;
  service: AgentsRegistryServiceCapability;
  runtime: AgentsRegistryRuntimeSupport;
  lifecycle: AgentsRegistryLifecycle;
  originLaunch?: AgentsRegistryOriginLaunch;
  transportModes?: AgentsRegistryTransportMode[];
  defaultTransportMode?: AgentsRegistryTransportMode;
  defaultStreamingMode?: AgentsRegistryStreamingMode;
};

export type AgentsRegistryDocument = {
  schemaVersion: string;
  agents: AgentsRegistryAgent[];
};

const SUPPORTED_DETECTION_MODES = new Set<AgentsRegistryDetectionMode>([
  "all",
  "any",
]);
const SUPPORTED_DETECTION_CHECK_KINDS =
  new Set<AgentsRegistryDetectionCheckKind>([
    "pathExists",
    "fileExists",
    "envTruthy",
    "commandExists",
  ]);
const SUPPORTED_PLATFORMS = new Set<AgentsRegistryPlatform>([
  "all",
  "darwin",
  "linux",
  "win32",
]);
const SUPPORTED_TRANSPORT_MODES = new Set<AgentsRegistryTransportMode>(
  runtimeTransportModeSchema.options
);
const SUPPORTED_STREAMING_MODES = new Set<AgentsRegistryStreamingMode>([
  "final",
  "stream",
]);
const SUPPORTED_RUNTIME_MATCHER_KINDS =
  new Set<AgentsRegistryAgentControllerRefMatcherKind>([
    "contains",
    "equals",
    "prefix",
    "suffix",
    "regex",
  ]);
const TEMPLATE_TOKEN_RE = /\$\{([A-Z0-9_]+)\}/g;
const ORIGIN_LAUNCH_TOKEN_RE =
  /\{(agentControllerConversationId|model|workingDirectory)\}/g;
const ANY_BRACE_TOKEN_RE = /\{([^}]+)\}/g;
const SAFE_POSIX_SHELL_TOKEN_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const SUPPORTED_ORIGIN_LAUNCH_TOKENS = new Set([
  "agentControllerConversationId",
  "model",
  "workingDirectory",
] as const);
type SupportedOriginLaunchToken =
  | "agentControllerConversationId"
  | "model"
  | "workingDirectory";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const registryRelativePath = "config/agents/registry.json";
const embeddedRegistryDocument = parseAgentsRegistryDocument(
  embeddedRegistry,
  "embedded agents registry"
);

let cachedRegistryPath: string | null = null;
let cachedRegistryDocument: AgentsRegistryDocument | null = null;

export function resolveAgentsRegistryPath(): string {
  const override = process.env.OPENMELD_AGENTS_REGISTRY_PATH?.trim();
  if (!override) {
    return resolveDefaultAgentsRegistryPath();
  }
  return isAbsolute(override) ? override : resolve(process.cwd(), override);
}

export function loadAgentsRegistryDocument(): AgentsRegistryDocument {
  const registryPath = resolveAgentsRegistryPath();
  if (cachedRegistryPath === registryPath && cachedRegistryDocument) {
    return cachedRegistryDocument;
  }

  const hasPathOverride = Boolean(
    process.env.OPENMELD_AGENTS_REGISTRY_PATH?.trim().length
  );
  let document: AgentsRegistryDocument;
  try {
    const rawContent = readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(rawContent) as unknown;
    document = parseAgentsRegistryDocument(parsed, registryPath);
  } catch (error) {
    if (!hasPathOverride && isMissingFileError(error)) {
      document = embeddedRegistryDocument;
    } else {
      throw error;
    }
  }

  cachedRegistryPath = registryPath;
  cachedRegistryDocument = document;
  return document;
}

export function listBuiltinAgentsRegistryEntries(): AgentsRegistryAgent[] {
  return loadAgentsRegistryDocument().agents.filter(
    (agent) => agent.category === "builtin"
  );
}

export function resolveRegistryTemplate(value: string): string {
  const expanded = value.replace(TEMPLATE_TOKEN_RE, (_full, token: string) =>
    resolveTemplateToken(token)
  );
  return expanded.trim();
}

export function evaluateRegistryDetection(
  detection: AgentsRegistryDetection
): boolean {
  const applicableChecks = detection.checks.filter((check) =>
    isCheckApplicableForCurrentPlatform(check.platform)
  );
  if (applicableChecks.length === 0) {
    return false;
  }

  const evaluatedChecks = applicableChecks.map((check) =>
    evaluateRegistryDetectionCheck(check)
  );
  if (detection.mode === "all") {
    return evaluatedChecks.every(Boolean);
  }
  return evaluatedChecks.some(Boolean);
}

export function resolveRegistryRuntimeAdapterByAgentControllerRef(
  agentControllerRef: string
): AgentsRegistryRuntimeAdapterMatch | null {
  const runtimeAdapterContract =
    resolveRegistryRuntimeAdapterContractByAgentControllerRef(
      agentControllerRef
    );
  if (!runtimeAdapterContract) {
    return null;
  }
  return {
    agentId: runtimeAdapterContract.agentId,
    adapterId: runtimeAdapterContract.adapterId,
    controllerRefMatcher: runtimeAdapterContract.controllerRefMatcher,
    ...(runtimeAdapterContract.defaultTransportMode
      ? { defaultTransportMode: runtimeAdapterContract.defaultTransportMode }
      : {}),
    transportModes: runtimeAdapterContract.transportModes,
    ...(runtimeAdapterContract.defaultStreamingMode
      ? { defaultStreamingMode: runtimeAdapterContract.defaultStreamingMode }
      : {}),
  };
}

function resolveCompatibleAdapterDefaultStreamingMode(input: {
  capabilityDeclaration: AgentsRegistryRuntimeCapabilityDeclaration;
  defaultStreamingMode?: AgentsRegistryStreamingMode | null;
}): AgentsRegistryStreamingMode | undefined {
  if (!input.defaultStreamingMode) {
    return undefined;
  }
  if (
    input.defaultStreamingMode === "stream" &&
    input.capabilityDeclaration.streamingCapability === "final_only"
  ) {
    return undefined;
  }
  return input.defaultStreamingMode;
}

function buildRuntimeAdapterStreamingDefaults(input: {
  capabilityDeclaration: AgentsRegistryRuntimeCapabilityDeclaration;
  defaultStreamingMode?: AgentsRegistryStreamingMode | null;
}): {
  defaultStreamingMode?: AgentsRegistryStreamingMode;
} {
  const defaultStreamingMode =
    resolveCompatibleAdapterDefaultStreamingMode(input);
  return defaultStreamingMode ? { defaultStreamingMode } : {};
}

function validateAgentRuntimeStreamingDefaults(input: {
  context: string;
  defaultStreamingMode?: AgentsRegistryStreamingMode | null;
  runtime: AgentsRegistryRuntimeSupport;
}): void {
  if (
    input.defaultStreamingMode === "stream" &&
    input.runtime.supported &&
    input.runtime.adapters.every(
      (adapter) =>
        adapter.capabilityDeclaration.streamingCapability === "final_only"
    )
  ) {
    throw new Error(
      `Agent ${input.context}.defaultStreamingMode must not be "stream" when every runtime adapter is final_only`
    );
  }
}

export function resolveRegistryRuntimeAdapterContractByAgentControllerRef(
  agentControllerRef: string
): AgentsRegistryResolvedRuntimeAdapterContract | null {
  const normalizedAgentControllerRef = String(agentControllerRef).trim();
  if (!normalizedAgentControllerRef) {
    return null;
  }

  const builtinAgents = listBuiltinAgentsRegistryEntries();
  for (const agent of builtinAgents) {
    if (!agent.runtime.supported) {
      continue;
    }
    for (const adapter of agent.runtime.adapters) {
      if (
        isAgentControllerRefMatchedByRuntimeMatcher(
          normalizedAgentControllerRef,
          adapter.controllerRefMatcher
        )
      ) {
        return {
          agentId: agent.id,
          adapterId: adapter.adapterId,
          capabilityDeclaration: adapter.capabilityDeclaration,
          controllerRefMatcher: {
            kind: adapter.controllerRefMatcher.kind,
            values: [...adapter.controllerRefMatcher.values],
          },
          transportModes: [...adapter.transportModes],
          ...(agent.defaultTransportMode
            ? { defaultTransportMode: agent.defaultTransportMode }
            : {}),
          ...buildRuntimeAdapterStreamingDefaults({
            capabilityDeclaration: adapter.capabilityDeclaration,
            defaultStreamingMode: agent.defaultStreamingMode,
          }),
        };
      }
    }
  }
  return null;
}

export function isRegistryRuntimeAgentControllerRefSupported(
  agentControllerRef: string
): boolean {
  return (
    resolveRegistryRuntimeAdapterByAgentControllerRef(agentControllerRef) !==
    null
  );
}

export function resolveRegistryRuntimeAdapterCapabilitySnapshot(
  adapterId: string
): AgentsRegistryRuntimeAdapterCapabilitySnapshot | null {
  const normalizedAdapterId = String(adapterId).trim();
  if (!normalizedAdapterId) {
    return null;
  }

  const builtinAgents = listBuiltinAgentsRegistryEntries();
  for (const agent of builtinAgents) {
    if (!agent.runtime.supported) {
      continue;
    }
    for (const adapter of agent.runtime.adapters) {
      if (adapter.adapterId !== normalizedAdapterId) {
        continue;
      }
      return {
        adapterId: adapter.adapterId,
        capabilityDeclaration: adapter.capabilityDeclaration,
        ...buildRuntimeAdapterStreamingDefaults({
          capabilityDeclaration: adapter.capabilityDeclaration,
          defaultStreamingMode: agent.defaultStreamingMode,
        }),
        transportModes: [...adapter.transportModes],
      };
    }
  }

  return null;
}

export function resolveRegistryOriginLaunchCommand(input: {
  agentControllerRef: string;
  agentControllerConversationId?: string | null;
  model?: string | null;
  workingDirectory?: string | null;
}): string | null {
  const agentControllerRef = String(input.agentControllerRef).trim();
  if (!agentControllerRef) {
    return null;
  }

  const runtimeAdapterMatch =
    resolveRegistryRuntimeAdapterByAgentControllerRef(agentControllerRef);
  if (!runtimeAdapterMatch) {
    return null;
  }

  const matchedBuiltinAgent = listBuiltinAgentsRegistryEntries().find(
    (agent) => agent.id === runtimeAdapterMatch.agentId
  );
  const explicitModel = normalizeOptionalRegistryOriginValue(
    "model",
    input.model
  );
  const unselectedModelCommandTemplate = String(
    matchedBuiltinAgent?.originLaunch?.unselectedModelCommandTemplate ?? ""
  ).trim();
  const commandTemplate = String(
    !explicitModel && unselectedModelCommandTemplate
      ? unselectedModelCommandTemplate
      : (matchedBuiltinAgent?.originLaunch?.commandTemplate ?? "")
  ).trim();
  if (!commandTemplate) {
    return null;
  }
  return renderRegistryOriginLaunchCommand({
    commandTemplate,
    originFacts: {
      agentControllerConversationId: input.agentControllerConversationId,
      model:
        explicitModel ??
        (unselectedModelCommandTemplate
          ? null
          : resolveDefaultOriginLaunchModel({
              agentId: runtimeAdapterMatch.agentId,
            })),
      workingDirectory: input.workingDirectory,
    },
  });
}

export function renderRegistryOriginLaunchCommand(input: {
  commandTemplate: string;
  originFacts: {
    agentControllerConversationId?: string | null;
    model?: string | null;
    workingDirectory?: string | null;
  };
}): string | null {
  const commandTemplate = String(input.commandTemplate).trim();
  if (!commandTemplate) {
    return null;
  }

  const placeholderMatches = [...commandTemplate.matchAll(ANY_BRACE_TOKEN_RE)];
  for (const match of placeholderMatches) {
    const token = match[1];
    if (!(token && isSupportedOriginLaunchToken(token))) {
      return null;
    }
  }

  let missingRequiredFact = false;
  const rendered = commandTemplate.replace(
    ORIGIN_LAUNCH_TOKEN_RE,
    (_fullMatch, token: string) => {
      const typedToken = token as SupportedOriginLaunchToken;
      const value = normalizeOptionalRegistryOriginValue(
        typedToken,
        input.originFacts[typedToken]
      );
      if (!value) {
        missingRequiredFact = true;
        return "";
      }
      return quotePosixShellToken(value);
    }
  );
  return missingRequiredFact ? null : rendered;
}

function parseAgentsRegistryDocument(
  value: unknown,
  registryPath: string
): AgentsRegistryDocument {
  const objectValue = readObjectValue(
    value,
    `agents registry file '${registryPath}'`
  );
  const schemaVersion = readStringValue(
    objectValue.schemaVersion,
    "schemaVersion"
  );
  const rawAgents = readArrayValue(objectValue.agents, "agents");
  const agents = rawAgents.map((agent, index) =>
    parseAgentsRegistryAgent(agent, `agents[${String(index)}]`)
  );
  return {
    schemaVersion,
    agents,
  };
}

function parseAgentsRegistryAgent(
  value: unknown,
  context: string
): AgentsRegistryAgent {
  const objectValue = readObjectValue(value, context);
  const id = readStringValue(objectValue.id, `${context}.id`);
  const displayName = readStringValue(
    objectValue.displayName,
    `${context}.displayName`
  );
  const category = readEnumValue(objectValue.category, `${context}.category`, [
    "builtin",
    "custom",
  ]);
  const skillsDir = readStringValue(
    objectValue.skillsDir,
    `${context}.skillsDir`
  );
  const globalSkillsDir = readOptionalStringOrStringArray(
    objectValue.globalSkillsDir,
    `${context}.globalSkillsDir`
  );
  const detection = parseAgentsRegistryDetection(
    objectValue.detection,
    `${context}.detection`
  );
  const service = parseAgentsRegistryServiceCapability(
    objectValue.service,
    `${context}.service`
  );
  const runtime = parseAgentsRegistryRuntimeSupport(
    objectValue.runtime,
    `${context}.runtime`
  );
  const lifecycle = parseAgentsRegistryLifecycle(
    objectValue.lifecycle,
    `${context}.lifecycle`
  );
  const originLaunch = parseOptionalOriginLaunch(
    objectValue.originLaunch,
    `${context}.originLaunch`
  );
  const transportModes = parseOptionalTransportModes(
    objectValue.transportModes,
    `${context}.transportModes`
  );
  const defaultTransportMode = parseOptionalTransportMode(
    objectValue.defaultTransportMode,
    `${context}.defaultTransportMode`
  );
  const defaultStreamingMode = parseOptionalStreamingMode(
    objectValue.defaultStreamingMode,
    `${context}.defaultStreamingMode`
  );
  const runtimeTransportModes = resolveRuntimeTransportModes(runtime);
  if (
    !runtime.supported &&
    (transportModes || defaultTransportMode || defaultStreamingMode)
  ) {
    throw new Error(
      `Agent ${context} must not declare top-level transportModes/defaultTransportMode/defaultStreamingMode when runtime.supported=false`
    );
  }
  if (transportModes && runtime.supported) {
    const unsupportedModes = transportModes.filter(
      (mode) => !runtimeTransportModes.includes(mode)
    );
    if (unsupportedModes.length > 0) {
      throw new Error(
        `Agent ${context}.transportModes must be a subset of runtime adapter transport modes`
      );
    }
  }
  if (defaultTransportMode && runtime.supported) {
    if (!runtimeTransportModes.includes(defaultTransportMode)) {
      throw new Error(
        `Agent ${context}.defaultTransportMode must be declared by runtime adapters`
      );
    }
    if (transportModes && !transportModes.includes(defaultTransportMode)) {
      throw new Error(
        `Agent ${context}.defaultTransportMode must exist in ${context}.transportModes`
      );
    }
  }
  validateAgentRuntimeStreamingDefaults({
    context,
    defaultStreamingMode,
    runtime,
  });

  return {
    id,
    displayName,
    category,
    skillsDir,
    ...(globalSkillsDir ? { globalSkillsDir } : {}),
    detection,
    service,
    runtime,
    lifecycle,
    ...(originLaunch ? { originLaunch } : {}),
    ...(transportModes ? { transportModes } : {}),
    ...(defaultTransportMode ? { defaultTransportMode } : {}),
    ...(defaultStreamingMode ? { defaultStreamingMode } : {}),
  };
}

function parseAgentsRegistryLifecycle(
  value: unknown,
  context: string
): AgentsRegistryLifecycle {
  if (value === undefined || value === null) {
    return { status: "active" };
  }
  const objectValue = readObjectValue(value, context);
  return {
    status: readEnumValue(objectValue.status, `${context}.status`, [
      "active",
      "suspended",
    ]),
  };
}

function parseAgentsRegistryDetection(
  value: unknown,
  context: string
): AgentsRegistryDetection {
  const objectValue = readObjectValue(value, context);
  const mode = readEnumValue(objectValue.mode, `${context}.mode`, [
    "all",
    "any",
  ]);
  if (!SUPPORTED_DETECTION_MODES.has(mode)) {
    throw new Error(`Unsupported detection mode at ${context}.mode: ${mode}`);
  }
  const checks = readArrayValue(objectValue.checks, `${context}.checks`).map(
    (check, index) =>
      parseAgentsRegistryDetectionCheck(
        check,
        `${context}.checks[${String(index)}]`
      )
  );
  return {
    mode,
    checks,
  };
}

function parseAgentsRegistryDetectionCheck(
  value: unknown,
  context: string
): AgentsRegistryDetectionCheck {
  const objectValue = readObjectValue(value, context);
  const kind = readEnumValue(objectValue.kind, `${context}.kind`, [
    "pathExists",
    "fileExists",
    "envTruthy",
    "commandExists",
  ]);
  if (!SUPPORTED_DETECTION_CHECK_KINDS.has(kind)) {
    throw new Error(
      `Unsupported detection check kind at ${context}.kind: ${kind}`
    );
  }
  const detectionValue = readStringValue(objectValue.value, `${context}.value`);
  const platform = readOptionalEnumValue(
    objectValue.platform,
    `${context}.platform`,
    ["all", "darwin", "linux", "win32"]
  );
  if (platform && !SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform at ${context}.platform: ${platform}`);
  }
  return {
    kind,
    value: detectionValue,
    ...(platform ? { platform } : {}),
  };
}

function parseAgentsRegistryServiceCapability(
  value: unknown,
  context: string
): AgentsRegistryServiceCapability {
  const objectValue = readObjectValue(value, context);
  const skillsInstallable = readBooleanValue(
    objectValue.skillsInstallable,
    `${context}.skillsInstallable`
  );
  return {
    skillsInstallable,
  };
}

function parseAgentsRegistryRuntimeSupport(
  value: unknown,
  context: string
): AgentsRegistryRuntimeSupport {
  const objectValue = readObjectValue(value, context);
  const supported = readBooleanValue(
    objectValue.supported,
    `${context}.supported`
  );
  const adapters = readArrayValue(objectValue.adapters, `${context}.adapters`)
    .map((adapter, index) =>
      parseAgentsRegistryAdapterBinding(
        adapter,
        `${context}.adapters[${String(index)}]`
      )
    )
    .filter(Boolean);

  if (supported && adapters.length === 0) {
    throw new Error(
      `Runtime support at ${context} requires at least one adapter when supported=true`
    );
  }
  if (!supported && adapters.length > 0) {
    throw new Error(
      `Runtime support at ${context} must not declare adapters when supported=false`
    );
  }

  return {
    supported,
    adapters,
  };
}

function parseAgentsRegistryAdapterBinding(
  value: unknown,
  context: string
): AgentsRegistryAdapterBinding {
  const objectValue = readObjectValue(value, context);
  const adapterId = readStringValue(
    objectValue.adapterId,
    `${context}.adapterId`
  );
  const controllerRefMatcher = parseAgentsRegistryAgentControllerRefMatcher(
    objectValue.controllerRefMatcher,
    `${context}.controllerRefMatcher`
  );
  const transportModes = readArrayValue(
    objectValue.transportModes,
    `${context}.transportModes`
  ).map((transportMode, index) =>
    parseTransportMode(
      transportMode,
      `${context}.transportModes[${String(index)}]`
    )
  );
  const capabilityDeclaration = parseAgentsRegistryRuntimeCapabilityDeclaration(
    objectValue.capabilityDeclaration,
    `${context}.capabilityDeclaration`
  );
  if (transportModes.length === 0) {
    throw new Error(
      `Expected non-empty transport modes at ${context}.transportModes`
    );
  }
  return {
    adapterId,
    capabilityDeclaration,
    controllerRefMatcher,
    transportModes,
  };
}

function parseAgentsRegistryRuntimeCapabilityDeclaration(
  value: unknown,
  context: string
): AgentsRegistryRuntimeCapabilityDeclaration {
  const objectValue = readObjectValue(value, context);
  if (
    objectValue.executionContextVersion !== undefined &&
    objectValue.executionContextVersion !== 1 &&
    objectValue.executionContextVersion !== 2 &&
    objectValue.executionContextVersion !== 3 &&
    objectValue.executionContextVersion !== 4 &&
    objectValue.executionContextVersion !== 5 &&
    objectValue.executionContextVersion !== 6 &&
    objectValue.executionContextVersion !== 7
  ) {
    throw new Error(`${context}.executionContextVersion is unsupported`);
  }
  const streamingCapability = readEnumValue(
    objectValue.streamingCapability,
    `${context}.streamingCapability`,
    ["preview_capable", "final_only"]
  );
  const imageInputCapability = readOptionalEnumValue(
    objectValue.imageInputCapability,
    `${context}.imageInputCapability`,
    ["local_file_path", "unsupported"]
  );
  const runtimeWorkingDirectoryMode = readEnumValue(
    objectValue.runtimeWorkingDirectoryMode,
    `${context}.runtimeWorkingDirectoryMode`,
    ["spawn_cwd", "cli_flag", "provider_workspace", "unsupported"]
  );
  const preparationRequirement = readEnumValue(
    objectValue.preparationRequirement,
    `${context}.preparationRequirement`,
    ["none", "required"]
  );
  const continuationCapability = readEnumValue(
    objectValue.continuationCapability,
    `${context}.continuationCapability`,
    ["standard", "provider_specific"]
  );
  const workspaceResumeBehavior = readEnumValue(
    objectValue.workspaceResumeBehavior,
    `${context}.workspaceResumeBehavior`,
    ["transparent", "provider_specific_switch", "validate_only"]
  );

  return {
    continuationCapability,
    ...(objectValue.executionContextPermissionInheritance === true
      ? { executionContextPermissionInheritance: true as const }
      : {}),
    ...(objectValue.executionContextVersion === 1 ||
    objectValue.executionContextVersion === 2 ||
    objectValue.executionContextVersion === 3 ||
    objectValue.executionContextVersion === 4 ||
    objectValue.executionContextVersion === 5 ||
    objectValue.executionContextVersion === 6 ||
    objectValue.executionContextVersion === 7
      ? { executionContextVersion: objectValue.executionContextVersion }
      : {}),
    ...(imageInputCapability ? { imageInputCapability } : {}),
    preparationRequirement,
    runtimeWorkingDirectoryMode,
    streamingCapability,
    workspaceResumeBehavior,
  };
}

function parseAgentsRegistryAgentControllerRefMatcher(
  value: unknown,
  context: string
): AgentsRegistryAgentControllerRefMatcher {
  const objectValue = readObjectValue(value, context);
  const kind = readEnumValue(objectValue.kind, `${context}.kind`, [
    "contains",
    "equals",
    "prefix",
    "suffix",
    "regex",
  ]);
  if (!SUPPORTED_RUNTIME_MATCHER_KINDS.has(kind)) {
    throw new Error(
      `Unsupported controller matcher kind at ${context}.kind: ${kind}`
    );
  }
  const values = readArrayValue(objectValue.values, `${context}.values`).map(
    (entry, index) =>
      readStringValue(entry, `${context}.values[${String(index)}]`)
  );
  if (values.length === 0) {
    throw new Error(`Expected non-empty matcher values at ${context}.values`);
  }
  return {
    kind,
    values,
  };
}

function parseOptionalTransportModes(
  value: unknown,
  context: string
): AgentsRegistryTransportMode[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((transportMode, index) =>
    parseTransportMode(transportMode, `${context}[${String(index)}]`)
  );
}

function parseOptionalOriginLaunch(
  value: unknown,
  context: string
): AgentsRegistryOriginLaunch | null {
  if (value === undefined || value === null) {
    return null;
  }
  const objectValue = readObjectValue(value, context);
  const commandTemplate = readStringValue(
    objectValue.commandTemplate,
    `${context}.commandTemplate`
  );
  const unselectedModelCommandTemplate =
    objectValue.unselectedModelCommandTemplate === undefined
      ? null
      : readStringValue(
          objectValue.unselectedModelCommandTemplate,
          `${context}.unselectedModelCommandTemplate`
        );
  validateOriginLaunchCommandTemplate(
    commandTemplate,
    `${context}.commandTemplate`
  );
  if (unselectedModelCommandTemplate) {
    validateOriginLaunchCommandTemplate(
      unselectedModelCommandTemplate,
      `${context}.unselectedModelCommandTemplate`
    );
  }
  return {
    commandTemplate,
    ...(unselectedModelCommandTemplate
      ? { unselectedModelCommandTemplate }
      : {}),
  };
}

function validateOriginLaunchCommandTemplate(
  commandTemplate: string,
  context: string
): void {
  const placeholderMatches = [...commandTemplate.matchAll(ANY_BRACE_TOKEN_RE)];
  if (placeholderMatches.length === 0) {
    throw new Error(`Expected origin launch placeholder token at ${context}`);
  }
  for (const match of placeholderMatches) {
    const token = match[1];
    if (!(token && isSupportedOriginLaunchToken(token))) {
      throw new Error(
        `Unsupported origin launch token '${match[0]}' at ${context}`
      );
    }
  }
}

function normalizeOptionalRegistryOriginValue(
  token: SupportedOriginLaunchToken,
  value: unknown
): string | null {
  if (token === "workingDirectory") {
    return normalizeOptionalWorkingDirectory(value) ?? null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveDefaultOriginLaunchModel(input: {
  agentId: string;
}): string | null {
  return (
    readEmbeddedModelCatalog().agentControllers[input.agentId]
      ?.defaultModelId ?? null
  );
}

function quotePosixShellToken(value: string): string {
  if (SAFE_POSIX_SHELL_TOKEN_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isSupportedOriginLaunchToken(
  token: string
): token is SupportedOriginLaunchToken {
  return SUPPORTED_ORIGIN_LAUNCH_TOKENS.has(
    token as SupportedOriginLaunchToken
  );
}

function parseOptionalTransportMode(
  value: unknown,
  context: string
): AgentsRegistryTransportMode | null {
  if (typeof value !== "string") {
    return null;
  }
  return parseTransportMode(value, context);
}

function parseOptionalStreamingMode(
  value: unknown,
  context: string
): AgentsRegistryStreamingMode | null {
  if (typeof value !== "string") {
    return null;
  }
  return parseStreamingMode(value, context);
}

function parseTransportMode(
  value: unknown,
  context: string
): AgentsRegistryTransportMode {
  const transportMode = readEnumValue(
    value,
    context,
    runtimeTransportModeSchema.options
  );
  if (!SUPPORTED_TRANSPORT_MODES.has(transportMode)) {
    throw new Error(
      `Unsupported transport mode at ${context}: ${transportMode}`
    );
  }
  return transportMode;
}

function parseStreamingMode(
  value: unknown,
  context: string
): AgentsRegistryStreamingMode {
  const streamingMode = readEnumValue(value, context, ["final", "stream"]);
  if (!SUPPORTED_STREAMING_MODES.has(streamingMode)) {
    throw new Error(
      `Unsupported streaming mode at ${context}: ${streamingMode}`
    );
  }
  return streamingMode;
}

function resolveRuntimeTransportModes(
  runtime: AgentsRegistryRuntimeSupport
): AgentsRegistryTransportMode[] {
  const modes = new Set<AgentsRegistryTransportMode>();
  for (const adapter of runtime.adapters) {
    for (const mode of adapter.transportModes) {
      modes.add(mode);
    }
  }
  return [...modes];
}

function isAgentControllerRefMatchedByRuntimeMatcher(
  agentControllerRef: string,
  matcher: AgentsRegistryAgentControllerRefMatcher
): boolean {
  const normalizedAgentControllerRef = agentControllerRef.toLowerCase();
  for (const rawValue of matcher.values) {
    if (
      isAgentControllerRefMatchedByRuntimeMatcherValue({
        agentControllerRef,
        normalizedAgentControllerRef,
        matcherKind: matcher.kind,
        matcherValue: rawValue,
      })
    ) {
      return true;
    }
  }
  return false;
}

function isAgentControllerRefMatchedByRuntimeMatcherValue(input: {
  agentControllerRef: string;
  normalizedAgentControllerRef: string;
  matcherKind: AgentsRegistryAgentControllerRefMatcherKind;
  matcherValue: string;
}): boolean {
  const normalizedValue = input.matcherValue.toLowerCase();
  switch (input.matcherKind) {
    case "contains":
      return input.normalizedAgentControllerRef.includes(normalizedValue);
    case "equals":
      return input.normalizedAgentControllerRef === normalizedValue;
    case "prefix":
      return input.normalizedAgentControllerRef.startsWith(normalizedValue);
    case "suffix":
      return input.normalizedAgentControllerRef.endsWith(normalizedValue);
    case "regex":
      return isAgentControllerRefRegexMatched(
        input.agentControllerRef,
        input.matcherValue
      );
    default:
      return false;
  }
}

function isAgentControllerRefRegexMatched(
  agentControllerRef: string,
  matcherValue: string
): boolean {
  try {
    return new RegExp(matcherValue, "i").test(agentControllerRef);
  } catch {
    return false;
  }
}

function evaluateRegistryDetectionCheck(
  check: AgentsRegistryDetectionCheck
): boolean {
  const resolvedValue = resolveRegistryTemplate(check.value);
  if (!resolvedValue) {
    return false;
  }

  if (check.kind === "pathExists") {
    return existsSync(resolvedValue);
  }

  if (check.kind === "fileExists") {
    if (!existsSync(resolvedValue)) {
      return false;
    }
    try {
      return statSync(resolvedValue).isFile();
    } catch {
      return false;
    }
  }

  if (check.kind === "commandExists") {
    return resolveExecutableOnPath(resolvedValue) !== null;
  }

  const normalized = resolvedValue.toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "no");
}

function isCheckApplicableForCurrentPlatform(
  platform: AgentsRegistryPlatform | undefined
): boolean {
  if (!platform || platform === "all") {
    return true;
  }
  return platform === process.platform;
}

function resolveTemplateToken(token: string): string {
  const home = homedir();
  const fallbackXdgConfigHome = join(home, ".config");
  const fallbackCodexHome = join(home, ".codex");
  const fallbackClaudeConfigDir = join(home, ".claude");

  if (token === "HOME") {
    return process.env.HOME?.trim() || home;
  }
  if (token === "XDG_CONFIG_HOME") {
    return process.env.XDG_CONFIG_HOME?.trim() || fallbackXdgConfigHome;
  }
  if (token === "CODEX_HOME") {
    return process.env.CODEX_HOME?.trim() || fallbackCodexHome;
  }
  if (token === "CLAUDE_CONFIG_DIR") {
    return process.env.CLAUDE_CONFIG_DIR?.trim() || fallbackClaudeConfigDir;
  }
  return process.env[token]?.trim() || "";
}

function resolveDefaultAgentsRegistryPath(): string {
  const candidates = buildRegistryPathCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? resolve(process.cwd(), registryRelativePath);
}

function buildRegistryPathCandidates(): string[] {
  const roots = new Set<string>();
  roots.add(process.cwd());

  let cursor = moduleDir;
  for (let depth = 0; depth < 8; depth += 1) {
    roots.add(cursor);
    const parent = resolve(cursor, "..");
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return [...roots].map((rootDir) => resolve(rootDir, registryRelativePath));
}

function readObjectValue(
  value: unknown,
  context: string
): Record<string, unknown> {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    throw new Error(`Expected object at ${context}`);
  }
  return value as Record<string, unknown>;
}

function readArrayValue(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array at ${context}`);
  }
  return value;
}

function readStringValue(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string at ${context}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Expected non-empty string at ${context}`);
  }
  return trimmed;
}

function readBooleanValue(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean at ${context}`);
  }
  return value;
}

function readEnumValue<T extends string>(
  value: unknown,
  context: string,
  allowed: T[]
): T {
  if (typeof value !== "string") {
    throw new Error(`Expected string enum at ${context}`);
  }
  if (!allowed.includes(value as T)) {
    throw new Error(
      `Unexpected enum value at ${context}: ${value}. Allowed: ${allowed.join(", ")}`
    );
  }
  return value as T;
}

function readOptionalEnumValue<T extends string>(
  value: unknown,
  context: string,
  allowed: T[]
): T | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readEnumValue(value, context, allowed);
}

function readOptionalStringOrStringArray(
  value: unknown,
  context: string
): string | string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return readStringValue(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      readStringValue(item, `${context}[${String(index)}]`)
    );
  }
  throw new Error(`Expected string or string[] at ${context}`);
}

function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const withCode = error as Error & { code?: string };
  return withCode.code === "ENOENT";
}
