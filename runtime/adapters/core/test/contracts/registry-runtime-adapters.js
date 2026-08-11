import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const REGISTRY_URL = new URL(
  "../../../../../config/agents/registry.json",
  import.meta.url
);

function loadRegistryDocument() {
  return JSON.parse(readFileSync(REGISTRY_URL, "utf8"));
}

function hasEquivalentRuntimeAdapterContract(left, right) {
  return (
    isDeepStrictEqual(
      left.capabilityDeclaration,
      right.capabilityDeclaration
    ) &&
    isDeepStrictEqual(left.transportModes, right.transportModes) &&
    left.defaultStreamingMode === right.defaultStreamingMode
  );
}

export function listRuntimeSupportedRegistryAdapterIds() {
  const registry = loadRegistryDocument();
  const adapterIds = new Set();

  for (const agent of registry.agents) {
    if (agent.runtime?.supported !== true) {
      continue;
    }
    for (const runtimeAdapter of agent.runtime.adapters ?? []) {
      adapterIds.add(runtimeAdapter.adapterId);
    }
  }

  return [...adapterIds].sort((left, right) => left.localeCompare(right));
}

export function resolveRegistryRuntimeAdapterContractFromDocument(
  registry,
  adapterId
) {
  let match = null;

  for (const agent of registry.agents) {
    if (agent.runtime?.supported !== true) {
      continue;
    }

    for (const runtimeAdapter of agent.runtime.adapters ?? []) {
      if (runtimeAdapter.adapterId !== adapterId) {
        continue;
      }

      const resolved = {
        adapterId,
        capabilityDeclaration: runtimeAdapter.capabilityDeclaration,
        defaultStreamingMode: agent.defaultStreamingMode,
        transportModes: agent.transportModes,
      };

      if (!match) {
        match = resolved;
        continue;
      }

      if (!hasEquivalentRuntimeAdapterContract(match, resolved)) {
        throw new Error(
          `shared.provider_contract.registry_ambiguous: adapter '${adapterId}' has multiple runtime declarations in registry`
        );
      }
    }
  }

  if (match) {
    return match;
  }

  throw new Error(
    `shared.provider_contract.registry_missing: adapter '${adapterId}' is not runtime-supported in registry`
  );
}

export function resolveRegistryRuntimeAdapterContract(adapterId) {
  return resolveRegistryRuntimeAdapterContractFromDocument(
    loadRegistryDocument(),
    adapterId
  );
}
