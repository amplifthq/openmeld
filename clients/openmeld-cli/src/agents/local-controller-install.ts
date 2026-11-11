import type { LaunchContractVerificationResult } from "@openmeld/adapter-core";
import type {
  AgentControllerInterfaceSnapshot,
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
  failureReason?: AgentControllerInterfaceSnapshot["launch"]["failureReason"];
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

export type LocalControllerInstalledCandidatesResult =
  | {
      candidates: LocalControllerInstallChoice[];
      ok: true;
    }
  | {
      errorCode: "controller.launch.needs_repair";
      errorMessage: string;
      ok: false;
    };

export async function listBuiltinControllerInstalledCandidates(input: {
  agentId: string;
  detected: boolean;
  displayName: string;
  persistedLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  runtimeSupported: boolean;
}): Promise<LocalControllerInstalledCandidatesResult> {
  if (
    !(
      input.runtimeSupported &&
      (input.detected || input.persistedLaunchContract)
    )
  ) {
    return {
      errorCode: "controller.launch.needs_repair",
      errorMessage: `${input.displayName} is not available on this computer.`,
      ok: false,
    };
  }

  const resolver = resolveBuiltinControllerInstallResolverOrNull(input.agentId);
  if (!resolver) {
    return {
      errorCode: "controller.launch.needs_repair",
      errorMessage: `${input.displayName} does not expose a builtin local install resolver yet.`,
      ok: false,
    };
  }

  const installedCandidates = await resolver.resolveInstalledLaunchCandidates({
    preferredLaunchContract: input.persistedLaunchContract ?? null,
  });
  if (!installedCandidates.ok) {
    return {
      errorCode: "controller.launch.needs_repair",
      errorMessage: installedCandidates.errorMessage,
      ok: false,
    };
  }
  return {
    candidates: installedCandidates.candidates,
    ok: true,
  };
}

export async function resolveBuiltinControllerInstallResolution(input: {
  agentId: string;
  detected: boolean;
  displayName: string;
  persistedLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  runtimeSupported: boolean;
}): Promise<LocalControllerInstallResolution> {
  if (
    !(
      input.runtimeSupported &&
      (input.detected || input.persistedLaunchContract)
    )
  ) {
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
    return await resolvePersistedControllerInstall({
      displayName: input.displayName,
      persistedLaunchContract,
      resolver,
    });
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
    const verificationError = await verifySelectedInstall({
      resolver,
      selectedInstall: candidate,
    });
    if (verificationError) {
      return {
        detail: verificationError,
        installChoices: installedCandidates.candidates,
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
    const selectedInstall = resolveAutomaticInstallChoice({
      candidates: installedCandidates.candidates,
      preferredInstallId: installedCandidates.preferredInstallId,
    });
    if (selectedInstall) {
      const verificationError = await verifySelectedInstall({
        resolver,
        selectedInstall,
      });
      if (verificationError) {
        return {
          detail: verificationError,
          installChoices: installedCandidates.candidates,
          launchContract: null,
          status: "needs_repair",
        };
      }
      return {
        detail: null,
        installChoices: [],
        launchContract: selectedInstall.launchContract,
        status: "ready",
      };
    }
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

async function resolvePersistedControllerInstall(input: {
  displayName: string;
  persistedLaunchContract: RuntimeAgentControllerLaunchContract;
  resolver: BuiltinControllerInstallResolver;
}): Promise<LocalControllerInstallResolution> {
  const persistedVerification = await verifyLaunchContractWithRetry({
    launchContract: input.persistedLaunchContract,
    resolver: input.resolver,
  });
  const installedCandidates =
    await input.resolver.resolveInstalledLaunchCandidates({
      preferredLaunchContract: input.persistedLaunchContract,
    });
  if (!isCompletedLaunchFailure(persistedVerification)) {
    return {
      detail: null,
      installChoices: installedCandidates.ok
        ? installedCandidates.candidates
        : [],
      launchContract: input.persistedLaunchContract,
      status: "ready",
    };
  }

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
    ...(persistedVerification.failureReason
      ? { failureReason: persistedVerification.failureReason }
      : {}),
    installChoices:
      installedCandidates.ok && installedCandidates.candidates.length === 1
        ? installedCandidates.candidates
        : [],
    launchContract: input.persistedLaunchContract,
    status: "needs_repair",
  };
}

function resolveAutomaticInstallChoice(input: {
  candidates: readonly LocalControllerInstallChoice[];
  preferredInstallId?: string;
}): LocalControllerInstallChoice | null {
  const preferredInstall = input.preferredInstallId
    ? (input.candidates.find(
        (candidate) => candidate.installId === input.preferredInstallId
      ) ?? null)
    : null;
  if (preferredInstall) {
    return preferredInstall;
  }
  // Adapters without an explicit first-use preference keep their verified
  // discovery order. Persisted choices are handled above and remain authoritative.
  return input.candidates[0] ?? null;
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
    const verificationError = await verifySelectedInstall({
      resolver,
      selectedInstall,
    });
    if (verificationError) {
      return {
        errorCode: "controller.launch.needs_repair",
        errorMessage: verificationError,
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
    const verificationError = await verifySelectedInstall({
      resolver,
      selectedInstall,
    });
    if (verificationError) {
      return {
        errorCode: "controller.launch.needs_repair",
        errorMessage: verificationError,
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

async function verifySelectedInstall(input: {
  resolver: BuiltinControllerInstallResolver;
  selectedInstall: LocalControllerInstallChoice;
}): Promise<string | null> {
  const verification = await verifyLaunchContractWithRetry({
    launchContract: input.selectedInstall.launchContract,
    resolver: input.resolver,
  });
  return isCompletedLaunchFailure(verification)
    ? verification.errorMessage
    : null;
}

// One launch-verification rule for every install path. A check that could not
// finish (including a probe timeout) proves nothing about the install, so it
// never downgrades it; only a completed negative result does. Any failure gets
// one immediate retry so a single transient start failure cannot report repair.
async function verifyLaunchContractWithRetry(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  resolver: BuiltinControllerInstallResolver;
}): Promise<LaunchContractVerificationResult> {
  const firstAttempt = await input.resolver.verifyLaunchContract({
    launchContract: input.launchContract,
  });
  if (firstAttempt.ok) {
    return firstAttempt;
  }
  return await input.resolver.verifyLaunchContract({
    launchContract: input.launchContract,
  });
}

function isCompletedLaunchFailure(
  verification: LaunchContractVerificationResult
): verification is Extract<LaunchContractVerificationResult, { ok: false }> {
  return !verification.ok && verification.failureKind === "completed_negative";
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
