import {
  resolveInstalledClaudeCodeLaunchCandidates,
  verifyClaudeCodeLaunchContract,
} from "@openmeld/adapter-claude-code";
import {
  isCodexHostApplicationCommandPath,
  resolveInstalledCodexLaunchCandidates,
  verifyCodexLaunchContract,
} from "@openmeld/adapter-codex";
import type {
  InstalledLaunchCandidatesOptions,
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
import {
  type AgentControllerUsageLimitSupport,
  resolveAgentControllerUsageLimitSupport,
} from "@openmeld/agent-runtime";
import type {
  AgentControllerInterfaceCapabilities,
  AgentControllerInterfaceNativeInterface,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import {
  isClaudeNativeCommandPath,
  isCursorNativeCommandPath,
  isGrokBuildNativeCommandPath,
  isOpenCodeNativeCommandPath,
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
  resolveInstalledLaunchCandidates: (
    input?: InstalledLaunchCandidatesOptions
  ) => Promise<InstalledLaunchCandidatesResolution>;
  verifyLaunchContract: (input: {
    launchContract: RuntimeAgentControllerLaunchContract;
  }) => Promise<LaunchContractVerificationResult>;
};

export type ControllerVersionLatestSpec =
  | { kind: "github-release"; repository: string }
  | { kind: "homebrew" }
  | { kind: "http-json"; url: string }
  | { kind: "http-text"; url: string }
  | { kind: "npm" };

export type BuiltinAgentControllerOfficialChannel = {
  latest: ControllerVersionLatestSpec;
  matchesPath: (commandPath: string) => boolean;
  updateCommand: string | null;
};

export type BuiltinAgentControllerVersionMaintenanceDefinition = {
  homebrewPackage?: {
    kind: "cask" | "formula";
    name: string;
  };
  hostApplicationPath?: (commandPath: string) => boolean;
  npmPackageName?: string;
  officialChannels?: readonly BuiltinAgentControllerOfficialChannel[];
};

export type BuiltinAgentControllerDefinition = {
  adapterId: string;
  agentId: string;
  capabilities: AgentControllerInterfaceCapabilities;
  conversationOccupancy: BuiltinAgentControllerConversationOccupancySupport;
  installResolver: BuiltinControllerInstallResolver;
  nativeInterface: AgentControllerInterfaceNativeInterface;
  usageLimitSupport: BuiltinAgentControllerUsageLimitSupport;
  versionMaintenance?: BuiltinAgentControllerVersionMaintenanceDefinition;
};

export type BuiltinAgentControllerConversationOccupancySupport = {
  contractVersion: 1;
  mode: "official_atomic_admission_and_release_signal" | "unsupported";
};

export type BuiltinAgentControllerUsageLimitSupport =
  AgentControllerUsageLimitSupport;

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
    conversationOccupancy: { contractVersion: 1, mode: "unsupported" },
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledClaudeCodeLaunchCandidates,
      verifyLaunchContract: verifyClaudeCodeLaunchContract,
    },
    nativeInterface: "claude-agent-sdk",
    usageLimitSupport: resolveAgentControllerUsageLimitSupport(
      "builtin:claude-code"
    ),
    versionMaintenance: {
      homebrewPackage: { kind: "cask", name: "claude-code" },
      npmPackageName: "@anthropic-ai/claude-code",
      officialChannels: [
        {
          latest: { kind: "npm" } satisfies ControllerVersionLatestSpec,
          matchesPath: isClaudeNativeCommandPath,
          updateCommand: "claude update",
        },
      ],
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
    conversationOccupancy: {
      contractVersion: 1,
      mode: "official_atomic_admission_and_release_signal",
    },
    installResolver: {
      resolveInstalledLaunchCandidates: resolveInstalledCodexLaunchCandidates,
      verifyLaunchContract: verifyCodexLaunchContract,
    },
    nativeInterface: "codex-app-server",
    usageLimitSupport: resolveAgentControllerUsageLimitSupport("builtin:codex"),
    versionMaintenance: {
      homebrewPackage: { kind: "cask", name: "codex" },
      hostApplicationPath: isCodexHostApplicationCommandPath,
      npmPackageName: "@openai/codex",
    },
  },
  {
    adapterId: "openclaw",
    agentId: "openclaw",
    capabilities: EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES,
    conversationOccupancy: { contractVersion: 1, mode: "unsupported" },
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledOpenClawLaunchCandidates,
      verifyLaunchContract: verifyOpenClawLaunchContract,
    },
    nativeInterface: "local-cli",
    usageLimitSupport:
      resolveAgentControllerUsageLimitSupport("builtin:openclaw"),
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
    conversationOccupancy: { contractVersion: 1, mode: "unsupported" },
    installResolver: {
      refreshPersistedLaunchContract: refreshCursorPersistedLaunchContract,
      resolveInstalledLaunchCandidates: resolveInstalledCursorLaunchCandidates,
      verifyLaunchContract: verifyCursorLaunchContract,
    },
    nativeInterface: "acp",
    usageLimitSupport:
      resolveAgentControllerUsageLimitSupport("builtin:cursor"),
    versionMaintenance: {
      homebrewPackage: { kind: "cask", name: "cursor-cli" },
      officialChannels: [
        {
          latest: { kind: "homebrew" } satisfies ControllerVersionLatestSpec,
          matchesPath: isCursorNativeCommandPath,
          updateCommand: "cursor-agent update",
        },
      ],
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
    conversationOccupancy: { contractVersion: 1, mode: "unsupported" },
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledGrokBuildLaunchCandidates,
      verifyLaunchContract: verifyGrokBuildLaunchContract,
    },
    nativeInterface: "acp",
    usageLimitSupport:
      resolveAgentControllerUsageLimitSupport("builtin:grok-build"),
    versionMaintenance: {
      officialChannels: [
        {
          latest: {
            kind: "http-text",
            url: "https://x.ai/cli/stable",
          } satisfies ControllerVersionLatestSpec,
          matchesPath: isGrokBuildNativeCommandPath,
          updateCommand: "grok update",
        },
      ],
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
    conversationOccupancy: { contractVersion: 1, mode: "unsupported" },
    installResolver: {
      resolveInstalledLaunchCandidates:
        resolveInstalledOpenCodeLaunchCandidates,
      verifyLaunchContract: verifyOpenCodeLaunchContract,
    },
    nativeInterface: "local-cli",
    usageLimitSupport:
      resolveAgentControllerUsageLimitSupport("builtin:opencode"),
    versionMaintenance: {
      homebrewPackage: { kind: "formula", name: "opencode" },
      npmPackageName: "opencode-ai",
      officialChannels: [
        {
          latest: {
            kind: "github-release",
            repository: "anomalyco/opencode",
          } satisfies ControllerVersionLatestSpec,
          matchesPath: isOpenCodeNativeCommandPath,
          updateCommand: "opencode upgrade",
        },
      ],
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
