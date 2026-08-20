import {
  resolveInstalledClaudeCodeLaunchCandidates,
  verifyClaudeCodeLaunchContract,
} from "@openmeld/adapter-claude-code";
import {
  resolveInstalledCodexLaunchCandidates,
  verifyCodexLaunchContract,
} from "@openmeld/adapter-codex";
import type {
  InstalledLaunchCandidatesResolution,
  LaunchContractVerificationResult,
} from "@openmeld/adapter-core";
import {
  refreshCursorPersistedLaunchContract,
  resolveInstalledCursorLaunchCandidates,
  verifyCursorLaunchContract,
} from "@openmeld/adapter-cursor";
import {
  resolveInstalledGrokBuildLaunchCandidates,
  verifyGrokBuildLaunchContract,
} from "@openmeld/adapter-grok-build";
import {
  resolveInstalledOpenClawLaunchCandidates,
  verifyOpenClawLaunchContract,
} from "@openmeld/adapter-openclaw";
import {
  resolveInstalledOpenCodeLaunchCandidates,
  verifyOpenCodeLaunchContract,
} from "@openmeld/adapter-opencode";
import type {
  AgentControllerInterfaceCapabilities,
  AgentControllerInterfaceNativeInterface,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import {
  isClaudeNativeCommandPath,
  isCursorNativeCommandPath,
  isGrokBuildNativeCommandPath,
} from "./controller-command-paths";

export type BuiltinControllerInstallResolver = {
  refreshPersistedLaunchContract?: (input: {
    launchContract: RuntimeAgentControllerLaunchContract;
  }) => Promise<RuntimeAgentControllerLaunchContract>;
  // Reuses the adapter package's own resolution type (rather than a
  // hand-duplicated copy) so the ok:false `reason` discriminator
  // ("not_installed" | "not_launchable") can never silently drift out of
  // sync between the two -- that exact drift once made this type accept
  // ok:false objects with no reason field, hiding a TypeScript error.
  resolveInstalledLaunchCandidates: (input?: {
    timeoutMs?: number | null;
  }) => Promise<InstalledLaunchCandidatesResolution>;
  verifyLaunchContract: (input: {
    launchContract: RuntimeAgentControllerLaunchContract;
  }) => Promise<LaunchContractVerificationResult>;
};

export type BuiltinAgentControllerVersionMaintenanceDefinition = {
  homebrewPackage?: {
    kind: "cask" | "formula";
    name: string;
  };
  npmPackageName?: string;
  officialUpdateCommand?: string;
  officialUpdatePath: (commandPath: string) => boolean;
};

export type BuiltinAgentControllerDefinition = {
  adapterId: string;
  agentId: string;
  capabilities: AgentControllerInterfaceCapabilities;
  installResolver: BuiltinControllerInstallResolver;
  nativeInterface: AgentControllerInterfaceNativeInterface;
  usageLimitSupport: "native" | "not_evaluated" | "unsupported";
  versionMaintenance?: BuiltinAgentControllerVersionMaintenanceDefinition;
};

export const EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES = {
  approvals: false,
  cancel: false,
  interrupt: false,
  modelSelection: false,
  nativeEventStream: false,
  permissionModes: false,
  structuredUserInput: false,
} satisfies AgentControllerInterfaceCapabilities;

const BUILTIN_AGENT_CONTROLLER_DEFINITIONS = [
  {
    adapterId: "claude-code",
    agentId: "claude-code",
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: false,
      permissionModes: true,
      structuredUserInput: false,
    },
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledClaudeCodeLaunchCandidates,
      verifyLaunchContract: verifyClaudeCodeLaunchContract,
    },
    nativeInterface: "claude-agent-sdk",
    usageLimitSupport: "native",
    versionMaintenance: {
      homebrewPackage: { kind: "cask", name: "claude-code" },
      npmPackageName: "@anthropic-ai/claude-code",
      officialUpdateCommand: "claude update",
      officialUpdatePath: isClaudeNativeCommandPath,
    },
  },
  {
    adapterId: "codex",
    agentId: "codex",
    capabilities: {
      approvals: true,
      cancel: false,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    installResolver: {
      resolveInstalledLaunchCandidates: resolveInstalledCodexLaunchCandidates,
      verifyLaunchContract: verifyCodexLaunchContract,
    },
    nativeInterface: "codex-app-server",
    usageLimitSupport: "native",
    versionMaintenance: {
      homebrewPackage: { kind: "cask", name: "codex" },
      npmPackageName: "@openai/codex",
      officialUpdatePath: () => false,
    },
  },
  {
    adapterId: "openclaw",
    agentId: "openclaw",
    capabilities: EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES,
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledOpenClawLaunchCandidates,
      verifyLaunchContract: verifyOpenClawLaunchContract,
    },
    nativeInterface: "local-cli",
    usageLimitSupport: "not_evaluated",
  },
  {
    adapterId: "cursor",
    agentId: "cursor",
    capabilities: {
      approvals: false,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    installResolver: {
      refreshPersistedLaunchContract: refreshCursorPersistedLaunchContract,
      resolveInstalledLaunchCandidates: resolveInstalledCursorLaunchCandidates,
      verifyLaunchContract: verifyCursorLaunchContract,
    },
    nativeInterface: "acp",
    usageLimitSupport: "unsupported",
    versionMaintenance: {
      homebrewPackage: { kind: "cask", name: "cursor-cli" },
      officialUpdateCommand: "cursor-agent update",
      officialUpdatePath: isCursorNativeCommandPath,
    },
  },
  {
    adapterId: "grok-build",
    agentId: "grok-build",
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: true,
    },
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledGrokBuildLaunchCandidates,
      verifyLaunchContract: verifyGrokBuildLaunchContract,
    },
    nativeInterface: "acp",
    usageLimitSupport: "native",
    versionMaintenance: {
      officialUpdateCommand: "grok update",
      officialUpdatePath: isGrokBuildNativeCommandPath,
    },
  },
  {
    adapterId: "opencode",
    agentId: "opencode",
    capabilities: {
      approvals: false,
      cancel: false,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: false,
      permissionModes: false,
      structuredUserInput: false,
    },
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledOpenCodeLaunchCandidates,
      verifyLaunchContract: verifyOpenCodeLaunchContract,
    },
    nativeInterface: "local-cli",
    usageLimitSupport: "unsupported",
    versionMaintenance: {
      homebrewPackage: { kind: "formula", name: "opencode" },
      npmPackageName: "opencode-ai",
      officialUpdateCommand: "opencode upgrade",
      officialUpdatePath: () => true,
    },
  },
] satisfies readonly BuiltinAgentControllerDefinition[];

export function listBuiltinAgentControllerDefinitions(): readonly BuiltinAgentControllerDefinition[] {
  return BUILTIN_AGENT_CONTROLLER_DEFINITIONS;
}

export function resolveBuiltinAgentControllerDefinition(
  agentId: string
): BuiltinAgentControllerDefinition | undefined {
  return BUILTIN_AGENT_CONTROLLER_DEFINITIONS.find(
    (definition) => definition.agentId === agentId
  );
}
