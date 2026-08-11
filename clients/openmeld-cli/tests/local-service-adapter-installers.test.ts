import { listLocalAdapterInstallers } from "@openmeld/local-service";
import { describe, expect, it } from "vitest";
import { loadAgentsRegistryDocument } from "../src/agents/registry-source";

function listRegistryRuntimeAdapterIds(): string[] {
  const registry = loadAgentsRegistryDocument();
  const adapterIds = new Set<string>();

  for (const agent of registry.agents) {
    if (!agent.runtime.supported) {
      continue;
    }
    for (const adapter of agent.runtime.adapters) {
      adapterIds.add(adapter.adapterId);
    }
  }

  return [...adapterIds].sort((left, right) => left.localeCompare(right));
}

describe("local service local adapter installers", () => {
  it("covers all runtime-supported adapter ids from registry", () => {
    const registryAdapterIds = listRegistryRuntimeAdapterIds();
    const installerAdapterIds = listLocalAdapterInstallers()
      .map((installer) => installer.adapterId)
      .sort((left, right) => left.localeCompare(right));

    expect(installerAdapterIds).toEqual(registryAdapterIds);
  });
});
