import { listLocalAdapterInstallers } from "@openmeld/local-service";
import { describe, expect, it } from "vitest";
import { listBuiltinAgentControllerDefinitions } from "../src/agents/builtin-agent-controller-definitions";
import { listBuiltinAgentsRegistryEntries } from "../src/agents/registry-source";

function listRuntimeSupportedBuiltinAgentIds(): string[] {
  return listBuiltinAgentsRegistryEntries()
    .filter((agent) => agent.runtime.supported)
    .map((agent) => agent.id)
    .sort((left, right) => left.localeCompare(right));
}

describe("builtin agent controller definitions", () => {
  it("covers every runtime-supported builtin registry agent", () => {
    const definitionAgentIds = listBuiltinAgentControllerDefinitions()
      .map((definition) => definition.agentId)
      .sort((left, right) => left.localeCompare(right));

    expect(definitionAgentIds).toEqual(listRuntimeSupportedBuiltinAgentIds());
  });

  it("keeps controller definitions aligned with registry adapter contracts", () => {
    const registryAgentsById = new Map(
      listBuiltinAgentsRegistryEntries().map((agent) => [agent.id, agent])
    );

    for (const definition of listBuiltinAgentControllerDefinitions()) {
      const registryAgent = registryAgentsById.get(definition.agentId);
      expect(registryAgent?.runtime.supported).toBe(true);
      expect(
        registryAgent?.runtime.adapters.map((adapter) => adapter.adapterId)
      ).toContain(definition.adapterId);
    }
  });

  it("keeps controller definitions backed by local adapter installers", () => {
    const installedAdapterIds = new Set(
      listLocalAdapterInstallers().map((installer) => installer.adapterId)
    );

    for (const definition of listBuiltinAgentControllerDefinitions()) {
      expect(
        installedAdapterIds.has(definition.adapterId),
        `${definition.agentId} uses uninstalled adapter ${definition.adapterId}`
      ).toBe(true);
    }
  });

  it("advertises Codex interrupt-backed Stop without claiming cancel support", () => {
    const codexDefinition = listBuiltinAgentControllerDefinitions().find(
      (definition) => definition.agentId === "codex"
    );

    expect(codexDefinition?.capabilities).toMatchObject({
      cancel: false,
      interrupt: true,
    });
  });

  it("advertises OpenCode interrupt-backed Stop without claiming cancel support", () => {
    const openCodeDefinition = listBuiltinAgentControllerDefinitions().find(
      (definition) => definition.agentId === "opencode"
    );

    expect(openCodeDefinition?.capabilities).toMatchObject({
      cancel: false,
      interrupt: true,
    });
    expect(openCodeDefinition?.versionMaintenance).toMatchObject({
      npmPackageName: "opencode-ai",
      officialUpdateCommand: "opencode upgrade",
    });
    expect(
      openCodeDefinition?.versionMaintenance?.officialUpdatePath(
        "/usr/local/bin/opencode"
      )
    ).toBe(true);
  });

  it("declares the Homebrew package kind and name for maintained controllers", () => {
    const homebrewPackages = Object.fromEntries(
      listBuiltinAgentControllerDefinitions()
        .filter((definition) => definition.versionMaintenance)
        .map((definition) => [
          definition.agentId,
          definition.versionMaintenance?.homebrewPackage,
        ])
    );

    expect(homebrewPackages).toEqual({
      "claude-code": { kind: "cask", name: "claude-code" },
      codex: { kind: "cask", name: "codex" },
      cursor: { kind: "cask", name: "cursor-cli" },
      opencode: { kind: "formula", name: "opencode" },
    });
  });
});
