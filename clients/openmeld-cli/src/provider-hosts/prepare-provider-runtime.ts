import type { ProviderDispatchRuntimeContext } from "@openmeld/schemas/types";
import {
  type AgentsRegistryResolvedRuntimeAdapterContract,
  resolveRegistryRuntimeAdapterContractByAgentControllerRef,
} from "../agents/registry-source";
import {
  type OpenClawRuntimePreparationResult,
  prepareOpenClawRuntime,
} from "./openclaw/runtime-preparation";

export type ProviderRuntimePreparationMode = "dispatch" | "reply_readiness";

export type ProviderRuntimePreparationDetails =
  | {
      kind: "none";
    }
  | OpenClawRuntimePreparationResult["preparationDetails"];

export type ProviderRuntimePreparationResult = {
  envOverrides: Record<string, string | undefined> | undefined;
  preparationDetails: ProviderRuntimePreparationDetails;
  runtimeContext: ProviderDispatchRuntimeContext;
};

type ProviderRuntimePreparationRequest = {
  agentControllerRef: string;
  daemonWorkingDirectory: string;
  mode: ProviderRuntimePreparationMode;
  openClawBin?: string;
  profileName: string | null;
  runtimeContext: ProviderDispatchRuntimeContext;
  targetProfileId: string;
};

type ProviderRuntimePreparer = (
  input: ProviderRuntimePreparationRequest
) => Promise<ProviderRuntimePreparationResult>;

type ProviderRuntimePreparerRegistry = Record<string, ProviderRuntimePreparer>;

const DEFAULT_PROVIDER_RUNTIME_PREPARERS = {
  openclaw: prepareOpenClawRuntime,
} satisfies ProviderRuntimePreparerRegistry;

export function listRegisteredProviderRuntimePreparationAdapterIds(): string[] {
  return Object.keys(DEFAULT_PROVIDER_RUNTIME_PREPARERS).sort();
}

export async function prepareProviderRuntime(
  input: ProviderRuntimePreparationRequest,
  options: {
    preparers?: ProviderRuntimePreparerRegistry;
    resolveAdapterContract?: (
      agentControllerRef: string
    ) => AgentsRegistryResolvedRuntimeAdapterContract | null;
  } = {}
): Promise<ProviderRuntimePreparationResult> {
  const runtimeAdapterContract = (
    options.resolveAdapterContract ??
    resolveRegistryRuntimeAdapterContractByAgentControllerRef
  )(input.agentControllerRef);
  if (
    !runtimeAdapterContract ||
    runtimeAdapterContract.capabilityDeclaration.preparationRequirement ===
      "none"
  ) {
    return {
      envOverrides: undefined,
      preparationDetails: {
        kind: "none",
      },
      runtimeContext: input.runtimeContext,
    };
  }

  const preparers: ProviderRuntimePreparerRegistry =
    options.preparers ?? DEFAULT_PROVIDER_RUNTIME_PREPARERS;
  const preparer = preparers[runtimeAdapterContract.adapterId];
  if (!preparer) {
    throw new Error(
      `No runtime preparation implementation is registered for adapter '${runtimeAdapterContract.adapterId}'`
    );
  }
  return await preparer(input);
}
