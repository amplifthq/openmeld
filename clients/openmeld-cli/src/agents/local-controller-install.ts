import type {
  RuntimeAgentControllerLaunchCandidate,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import {
  type BuiltinControllerInstallResolver,
  resolveBuiltinAgentControllerDefinition,
} from "./builtin-agent-controller-definitions";

// This is the shared local controller install boundary. OpenMeld product identity
// stays on AgentControllerRef; this layer only chooses which local install
// should provide the controller's launch contract on this computer.
export type LocalControllerInstallChoice =
  RuntimeAgentControllerLaunchCandidate;

export type LocalControllerInstallStatus =
  | "ready"
  | "needs_choice"
  | "needs_repair"
  | "not_available";

export type LocalControllerInstallResolution = {
  detail: string | null;
  installChoices: LocalControllerInstallChoice[];
  launchContract: RuntimeAgentControllerLaunchContract | null;
  status: LocalControllerInstallStatus;
};

export type LocalControllerInstallRepairResult =
  | {
      launchContract: RuntimeAgentControllerLaunchContract;
      ok: true;
      selectedInstall: LocalControllerInstallChoice;
    }
  | {
      errorCode:
        | "controller.launch.choice_required"
        | "controller.launch.needs_repair";
      errorMessage: string;
      installChoices: LocalControllerInstallChoice[];
      ok: false;
    };

export async function resolveBuiltinControllerInstallResolution(input: {
  agentId: string;
  detected: boolean;
  displayName: string;
  persistedLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  runtimeSupported: boolean;
}): Promise<LocalControllerInstallResolution> {
  if (!(input.detected && input.runtimeSupported)) {
    return {
      detail: null,
      installChoices: [],
      launchContract: null,
      status: "not_available",
    };
  }

  const resolver = resolveBuiltinControllerInstallResolverOrNull(input.agentId);
  if (!resolver) {
    return {
      detail: `${input.displayName} does not expose a builtin local install resolver yet.`,
      installChoices: [],
      launchContract: null,
      status: "needs_repair",
    };
  }

  const persistedLaunchContract = input.persistedLaunchContract
    ? await refreshBuiltinControllerPersistedLaunchContract({
        agentId: input.agentId,
        launchContract: input.persistedLaunchContract,
      })
    : null;
  if (persistedLaunchContract) {
    const persistedVerification = await resolver.verifyLaunchContract({
      launchContract: persistedLaunchContract,
    });
    if (persistedVerification.ok) {
      return {
        detail: null,
        installChoices: [],
        launchContract: persistedLaunchContract,
        status: "ready",
      };
    }
    if (persistedVerification.failureKind === "incomplete_check") {
      return {
        detail: null,
        installChoices: [],
        launchContract: persistedLaunchContract,
        status: "ready",
      };
    }

    const installedCandidates =
      await resolver.resolveInstalledLaunchCandidates();
    if (installedCandidates.ok && installedCandidates.candidates.length > 1) {
      return {
        detail: buildNeedsInstallChoiceDetail(input.displayName),
        installChoices: installedCandidates.candidates,
        launchContract: null,
        status: "needs_choice",
      };
    }

    return {
      detail: persistedVerification.errorMessage,
      installChoices:
        installedCandidates.ok && installedCandidates.candidates.length === 1
          ? installedCandidates.candidates
          : [],
      launchContract: persistedLaunchContract,
      status: "needs_repair",
    };
  }

  const installedCandidates = await resolver.resolveInstalledLaunchCandidates();
  if (!installedCandidates.ok) {
    return {
      detail: installedCandidates.errorMessage,
      installChoices: [],
      launchContract: null,
      status: "needs_repair",
    };
  }

  if (installedCandidates.candidates.length === 1) {
    const candidate = installedCandidates.candidates[0];
    if (!candidate) {
      return {
        detail: `${input.displayName} needs repair on this computer before OpenMeld can start it.`,
        installChoices: [],
        launchContract: null,
        status: "needs_repair",
      };
    }
    return {
      detail: null,
      installChoices: [],
      launchContract: candidate.launchContract,
      status: "ready",
    };
  }

  if (installedCandidates.candidates.length > 1) {
    return {
      detail: buildNeedsInstallChoiceDetail(input.displayName),
      installChoices: installedCandidates.candidates,
      launchContract: null,
      status: "needs_choice",
    };
  }

  return {
    detail: `${input.displayName} needs repair on this computer before OpenMeld can start it.`,
    installChoices: [],
    launchContract: null,
    status: "needs_repair",
  };
}

export async function repairBuiltinControllerInstall(input: {
  agentId: string;
  detected: boolean;
  displayName: string;
  installId?: string | null;
  runtimeSupported: boolean;
}): Promise<LocalControllerInstallRepairResult> {
  if (!(input.detected && input.runtimeSupported)) {
    return {
      errorCode: "controller.launch.needs_repair",
      errorMessage: `${input.displayName} is not available on this computer.`,
      installChoices: [],
      ok: false,
    };
  }

  const resolver = resolveBuiltinControllerInstallResolverOrNull(input.agentId);
  if (!resolver) {
    return {
      errorCode: "controller.launch.needs_repair",
      errorMessage: `${input.displayName} does not expose a builtin local install resolver yet.`,
      installChoices: [],
      ok: false,
    };
  }

  const installedCandidates = await resolver.resolveInstalledLaunchCandidates();
  if (!installedCandidates.ok) {
    return {
      errorCode: "controller.launch.needs_repair",
      errorMessage: installedCandidates.errorMessage,
      installChoices: [],
      ok: false,
    };
  }

  const selectedInstallId = normalizeOptionalText(input.installId);
  if (selectedInstallId) {
    const selectedInstall =
      installedCandidates.candidates.find(
        (candidate) => candidate.installId === selectedInstallId
      ) ?? null;
    if (!selectedInstall) {
      return {
        errorCode: "controller.launch.choice_required",
        errorMessage: buildMissingInstallChoiceDetail(input.displayName),
        installChoices: installedCandidates.candidates,
        ok: false,
      };
    }
    return {
      launchContract: selectedInstall.launchContract,
      ok: true,
      selectedInstall,
    };
  }

  if (installedCandidates.candidates.length === 1) {
    const selectedInstall = installedCandidates.candidates[0];
    if (!selectedInstall) {
      return {
        errorCode: "controller.launch.needs_repair",
        errorMessage: `${input.displayName} needs repair on this computer before OpenMeld can start it.`,
        installChoices: [],
        ok: false,
      };
    }
    return {
      launchContract: selectedInstall.launchContract,
      ok: true,
      selectedInstall,
    };
  }

  if (installedCandidates.candidates.length > 1) {
    return {
      errorCode: "controller.launch.choice_required",
      errorMessage: buildNeedsInstallChoiceDetail(input.displayName),
      installChoices: installedCandidates.candidates,
      ok: false,
    };
  }

  return {
    errorCode: "controller.launch.needs_repair",
    errorMessage: `${input.displayName} needs repair on this computer before OpenMeld can start it.`,
    installChoices: [],
    ok: false,
  };
}

function resolveBuiltinControllerInstallResolverOrNull(
  agentId: string
): BuiltinControllerInstallResolver | null {
  return (
    resolveBuiltinAgentControllerDefinition(agentId)?.installResolver ?? null
  );
}

export async function refreshBuiltinControllerPersistedLaunchContract(input: {
  agentId: string;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const resolver = resolveBuiltinControllerInstallResolverOrNull(input.agentId);
  if (!resolver?.refreshPersistedLaunchContract) {
    return input.launchContract;
  }
  return await resolver.refreshPersistedLaunchContract({
    launchContract: input.launchContract,
  });
}

function buildNeedsInstallChoiceDetail(displayName: string): string {
  return `OpenMeld found more than one ${displayName} install on this computer. Choose which one OpenMeld should use here.`;
}

function buildMissingInstallChoiceDetail(displayName: string): string {
  return `OpenMeld still needs one ${displayName} install choice on this computer.`;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export type BuiltinAgentLaunchStatus = LocalControllerInstallStatus;
export type BuiltinAgentLaunchResolution = LocalControllerInstallResolution;
export type BuiltinAgentLaunchRepairResult = LocalControllerInstallRepairResult;

export const resolveBuiltinAgentLaunchResolution =
  resolveBuiltinControllerInstallResolution;
export const repairBuiltinAgentLaunchContract = repairBuiltinControllerInstall;
