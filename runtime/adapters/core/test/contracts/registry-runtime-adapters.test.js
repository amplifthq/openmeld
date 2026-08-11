import assert from "node:assert/strict";
import test from "node:test";
import { resolveRegistryRuntimeAdapterContractFromDocument } from "./registry-runtime-adapters.js";

test("resolveRegistryRuntimeAdapterContractFromDocument accepts equivalent declarations with different object key order", () => {
  const registry = {
    agents: [
      {
        defaultStreamingMode: "final",
        id: "agent-a",
        runtime: {
          adapters: [
            {
              adapterId: "codex",
              capabilityDeclaration: {
                continuationCapability: "standard",
                preparationRequirement: "none",
                runtimeWorkingDirectoryMode: "spawn_cwd",
                streamingCapability: "preview_capable",
              },
            },
          ],
          supported: true,
        },
        transportModes: ["local-cli"],
      },
      {
        defaultStreamingMode: "final",
        id: "agent-b",
        runtime: {
          adapters: [
            {
              adapterId: "codex",
              capabilityDeclaration: {
                streamingCapability: "preview_capable",
                runtimeWorkingDirectoryMode: "spawn_cwd",
                preparationRequirement: "none",
                continuationCapability: "standard",
              },
            },
          ],
          supported: true,
        },
        transportModes: ["local-cli"],
      },
    ],
  };

  assert.deepEqual(
    resolveRegistryRuntimeAdapterContractFromDocument(registry, "codex"),
    {
      adapterId: "codex",
      capabilityDeclaration: {
        continuationCapability: "standard",
        preparationRequirement: "none",
        runtimeWorkingDirectoryMode: "spawn_cwd",
        streamingCapability: "preview_capable",
      },
      defaultStreamingMode: "final",
      transportModes: ["local-cli"],
    }
  );
});
