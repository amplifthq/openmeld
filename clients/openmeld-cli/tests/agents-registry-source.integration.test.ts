import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadAgentsRegistryDocument,
  renderRegistryOriginLaunchCommand,
  resolveRegistryOriginLaunchCommand,
  resolveRegistryRuntimeAdapterCapabilitySnapshot,
  resolveRegistryRuntimeAdapterContractByAgentControllerRef,
} from "../src/agents/registry-source";
import { withTempHome } from "./helpers/fs";

const CAPABILITY_DECLARATION_RE = /capabilityDeclaration/;
const RUNTIME_SUPPORTED_FALSE_RE = /supported=false/;
const STREAMING_DEFAULT_RE = /defaultStreamingMode/;

describe("agents registry origin launch", () => {
  it("renders codex origin launch with working directory", () => {
    expect(
      resolveRegistryOriginLaunchCommand({
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-ctx-1",
        workingDirectory: " /tmp/My Project ",
      })
    ).toBe("cd ' /tmp/My Project ' && codex resume thread-ctx-1");
  });

  it("renders shell-safe codex origin launch for working directories with apostrophes", () => {
    expect(
      resolveRegistryOriginLaunchCommand({
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-ctx-1",
        workingDirectory: "/Users/alice/O'Brien",
      })
    ).toBe("cd '/Users/alice/O'\\''Brien' && codex resume thread-ctx-1");
  });

  it("renders codex origin launch with an explicit model", () => {
    expect(
      resolveRegistryOriginLaunchCommand({
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-ctx-1",
        model: "gpt-5.4-mini",
        workingDirectory: " /tmp/My Project ",
      })
    ).toBe(
      "cd ' /tmp/My Project ' && codex resume -m gpt-5.4-mini thread-ctx-1"
    );
  });

  it("renders claude origin launch with working directory", () => {
    expect(
      resolveRegistryOriginLaunchCommand({
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationId: "session-1",
        workingDirectory: " /tmp/My Project ",
      })
    ).toBe(
      "cd ' /tmp/My Project ' && claude --model claude-opus-4-8 --resume session-1"
    );
  });

  it("renders shell-safe claude origin launch for working directories with apostrophes", () => {
    expect(
      resolveRegistryOriginLaunchCommand({
        agentControllerRef: "builtin:claude-code",
        agentControllerConversationId: "session-1",
        workingDirectory: "/Users/alice/O'Brien",
      })
    ).toBe(
      "cd '/Users/alice/O'\\''Brien' && claude --model claude-opus-4-8 --resume session-1"
    );
  });

  it("renders openclaw origin launch from agent controller conversation ID", () => {
    expect(
      resolveRegistryOriginLaunchCommand({
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId:
          "agent:ops:openmeld-space:demo--deadbeef",
      })
    ).toBe("openclaw tui --session agent:ops:openmeld-space:demo--deadbeef");
  });

  it("returns null when a required origin launch value is missing", () => {
    expect(
      resolveRegistryOriginLaunchCommand({
        agentControllerRef: "builtin:openclaw",
      })
    ).toBeNull();
  });

  it("returns null when a template references an unsupported token", () => {
    expect(
      renderRegistryOriginLaunchCommand({
        commandTemplate: "tool open {sessionId}",
        originFacts: {
          agentControllerConversationId: "ctx-1",
        },
      })
    ).toBeNull();
  });
});

describe("agents registry execution target snapshot", () => {
  it("loads explicit lifecycle policy for supported built-in agents", () => {
    const document = loadAgentsRegistryDocument();
    const lifecycleById = new Map(
      document.agents.map((agent) => [agent.id, agent.lifecycle.status])
    );

    expect(lifecycleById.get("claude-code")).toBe("active");
    expect(lifecycleById.get("codex")).toBe("active");
    expect(lifecycleById.get("cursor")).toBe("active");
    expect(lifecycleById.get("openclaw")).toBe("suspended");
  });

  it("defaults omitted lifecycle policy to active", async () => {
    await withTempHome(async (home) => {
      const registryPath = join(home, "registry-default-lifecycle.json");
      const document = JSON.parse(
        JSON.stringify(loadAgentsRegistryDocument())
      ) as ReturnType<typeof loadAgentsRegistryDocument>;
      const codex = document.agents.find((agent) => agent.id === "codex") as
        | ({ lifecycle?: unknown } & Record<string, unknown>)
        | undefined;
      if (!codex) {
        throw new Error("Expected built-in codex registry entry");
      }
      codex.lifecycle = undefined;

      const previousRegistryPath = process.env.OPENMELD_AGENTS_REGISTRY_PATH;
      process.env.OPENMELD_AGENTS_REGISTRY_PATH = registryPath;
      await writeFile(registryPath, JSON.stringify(document, null, 2));

      try {
        const parsed = loadAgentsRegistryDocument();
        expect(
          parsed.agents.find((agent) => agent.id === "codex")?.lifecycle.status
        ).toBe("active");
      } finally {
        if (previousRegistryPath === undefined) {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = "";
        } else {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = previousRegistryPath;
        }
      }
    });
  });

  it("resolves the merged execution target snapshot by adapter id", () => {
    expect(resolveRegistryRuntimeAdapterCapabilitySnapshot("codex")).toEqual({
      adapterId: "codex",
      capabilityDeclaration: {
        continuationCapability: "standard",
        executionContextPermissionInheritance: true,
        executionContextVersion: 7,
        imageInputCapability: "local_file_path",
        preparationRequirement: "none",
        runtimeWorkingDirectoryMode: "spawn_cwd",
        streamingCapability: "preview_capable",
        workspaceResumeBehavior: "transparent",
      },
      defaultStreamingMode: "final",
      transportModes: ["codex-app-server"],
    });
  });

  it.each([
    "claude-code",
    "codex",
    "opencode",
  ])("declares local-file image input for %s", (adapterId) => {
    expect(
      resolveRegistryRuntimeAdapterCapabilitySnapshot(adapterId)
        ?.capabilityDeclaration.imageInputCapability
    ).toBe("local_file_path");
  });

  it("returns null when the adapter id is not declared in the registry", () => {
    expect(
      resolveRegistryRuntimeAdapterCapabilitySnapshot("unknown-adapter")
    ).toBeNull();
  });

  it("resolves the full runtime adapter contract by controller ref", () => {
    expect(
      resolveRegistryRuntimeAdapterContractByAgentControllerRef("builtin:codex")
    ).toMatchObject({
      adapterId: "codex",
      defaultTransportMode: "codex-app-server",
      transportModes: ["codex-app-server"],
    });

    expect(
      resolveRegistryRuntimeAdapterContractByAgentControllerRef(
        "builtin:cursor"
      )
    ).toMatchObject({
      adapterId: "cursor",
      capabilityDeclaration: {
        continuationCapability: "standard",
        preparationRequirement: "none",
        runtimeWorkingDirectoryMode: "spawn_cwd",
        streamingCapability: "preview_capable",
        workspaceResumeBehavior: "validate_only",
      },
      defaultTransportMode: "acp",
      defaultStreamingMode: "final",
      transportModes: ["acp"],
    });

    expect(
      resolveRegistryRuntimeAdapterContractByAgentControllerRef(
        "builtin:openclaw"
      )
    ).toMatchObject({
      adapterId: "openclaw",
      capabilityDeclaration: {
        continuationCapability: "provider_specific",
        preparationRequirement: "required",
        runtimeWorkingDirectoryMode: "provider_workspace",
        streamingCapability: "final_only",
        workspaceResumeBehavior: "provider_specific_switch",
      },
      defaultStreamingMode: "final",
      transportModes: ["local-cli"],
    });
  });

  it("rejects a runtime-supported adapter without capability declaration", async () => {
    await withTempHome(async (home) => {
      const registryPath = join(home, "registry.json");
      const document = JSON.parse(
        JSON.stringify(loadAgentsRegistryDocument())
      ) as ReturnType<typeof loadAgentsRegistryDocument>;
      const codex = document.agents.find((agent) => agent.id === "codex");
      if (!codex) {
        throw new Error("Expected built-in codex registry entry");
      }

      (
        codex.runtime.adapters[0] as { capabilityDeclaration?: unknown }
      ).capabilityDeclaration = undefined;

      const previousRegistryPath = process.env.OPENMELD_AGENTS_REGISTRY_PATH;
      process.env.OPENMELD_AGENTS_REGISTRY_PATH = registryPath;
      await writeFile(registryPath, JSON.stringify(document, null, 2));

      try {
        expect(() => loadAgentsRegistryDocument()).toThrow(
          CAPABILITY_DECLARATION_RE
        );
      } finally {
        if (previousRegistryPath === undefined) {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = "";
        } else {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = previousRegistryPath;
        }
      }
    });
  });

  it("rejects runtime adapters when runtime support is disabled", async () => {
    await withTempHome(async (home) => {
      const registryPath = join(home, "registry.json");
      const document = JSON.parse(
        JSON.stringify(loadAgentsRegistryDocument())
      ) as ReturnType<typeof loadAgentsRegistryDocument>;
      const cline = document.agents.find((agent) => agent.id === "cline");
      if (!cline) {
        throw new Error("Expected built-in cline registry entry");
      }

      cline.runtime.adapters = [
        {
          adapterId: "cline",
          capabilityDeclaration: {
            continuationCapability: "standard",
            preparationRequirement: "none",
            runtimeWorkingDirectoryMode: "unsupported",
            streamingCapability: "final_only",
            workspaceResumeBehavior: "validate_only",
          },
          controllerRefMatcher: {
            kind: "contains",
            values: ["cline"],
          },
          transportModes: ["local-cli"],
        },
      ];

      const previousRegistryPath = process.env.OPENMELD_AGENTS_REGISTRY_PATH;
      process.env.OPENMELD_AGENTS_REGISTRY_PATH = registryPath;
      await writeFile(registryPath, JSON.stringify(document, null, 2));

      try {
        expect(() => loadAgentsRegistryDocument()).toThrow(
          RUNTIME_SUPPORTED_FALSE_RE
        );
      } finally {
        if (previousRegistryPath === undefined) {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = "";
        } else {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = previousRegistryPath;
        }
      }
    });
  });

  it("preserves stream defaults for adapters whose capability declaration allows preview streaming", async () => {
    await withTempHome(async (home) => {
      const registryPath = join(home, "registry-preview-capable.json");
      const document = JSON.parse(
        JSON.stringify(loadAgentsRegistryDocument())
      ) as ReturnType<typeof loadAgentsRegistryDocument>;
      const codex = document.agents.find((agent) => agent.id === "codex");
      if (!codex?.runtime.supported) {
        throw new Error("Expected built-in codex runtime registry entry");
      }

      codex.defaultStreamingMode = "stream";

      const previousRegistryPath = process.env.OPENMELD_AGENTS_REGISTRY_PATH;
      process.env.OPENMELD_AGENTS_REGISTRY_PATH = registryPath;
      await writeFile(registryPath, JSON.stringify(document, null, 2));

      try {
        expect(
          resolveRegistryRuntimeAdapterCapabilitySnapshot("codex")
        ).toEqual(
          expect.objectContaining({
            adapterId: "codex",
            defaultStreamingMode: "stream",
          })
        );
      } finally {
        if (previousRegistryPath === undefined) {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = "";
        } else {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = previousRegistryPath;
        }
      }
    });
  });

  it("drops incompatible stream defaults from final-only adapter snapshots and contracts", async () => {
    await withTempHome(async (home) => {
      const registryPath = join(home, "registry-mixed-streaming.json");
      const document = JSON.parse(
        JSON.stringify(loadAgentsRegistryDocument())
      ) as ReturnType<typeof loadAgentsRegistryDocument>;
      const codex = document.agents.find((agent) => agent.id === "codex");
      if (!codex?.runtime.supported) {
        throw new Error("Expected built-in codex runtime registry entry");
      }

      codex.defaultStreamingMode = "stream";
      codex.runtime.adapters = [
        {
          adapterId: "codex-preview-capable",
          capabilityDeclaration: {
            continuationCapability: "standard",
            preparationRequirement: "none",
            runtimeWorkingDirectoryMode: "spawn_cwd",
            streamingCapability: "preview_capable",
            workspaceResumeBehavior: "transparent",
          },
          controllerRefMatcher: {
            kind: "equals",
            values: ["builtin:codex-preview-capable"],
          },
          transportModes: ["codex-app-server"],
        },
        {
          adapterId: "codex-final-only",
          capabilityDeclaration: {
            continuationCapability: "standard",
            preparationRequirement: "none",
            runtimeWorkingDirectoryMode: "spawn_cwd",
            streamingCapability: "final_only",
            workspaceResumeBehavior: "validate_only",
          },
          controllerRefMatcher: {
            kind: "equals",
            values: ["builtin:codex-final-only"],
          },
          transportModes: ["codex-app-server"],
        },
      ];

      const previousRegistryPath = process.env.OPENMELD_AGENTS_REGISTRY_PATH;
      process.env.OPENMELD_AGENTS_REGISTRY_PATH = registryPath;
      await writeFile(registryPath, JSON.stringify(document, null, 2));

      try {
        expect(
          resolveRegistryRuntimeAdapterCapabilitySnapshot("codex-final-only")
        ).toEqual(
          expect.objectContaining({
            adapterId: "codex-final-only",
            capabilityDeclaration: expect.objectContaining({
              streamingCapability: "final_only",
            }),
          })
        );
        expect(
          resolveRegistryRuntimeAdapterCapabilitySnapshot("codex-final-only")
        ).not.toHaveProperty("defaultStreamingMode");
        expect(
          resolveRegistryRuntimeAdapterContractByAgentControllerRef(
            "builtin:codex-final-only"
          )
        ).not.toHaveProperty("defaultStreamingMode");
      } finally {
        if (previousRegistryPath === undefined) {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = "";
        } else {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = previousRegistryPath;
        }
      }
    });
  });

  it("rejects top-level stream defaults when every runtime adapter is final-only", async () => {
    await withTempHome(async (home) => {
      const registryPath = join(home, "registry-invalid-streaming.json");
      const document = JSON.parse(
        JSON.stringify(loadAgentsRegistryDocument())
      ) as ReturnType<typeof loadAgentsRegistryDocument>;
      const openClaw = document.agents.find((agent) => agent.id === "openclaw");
      if (!openClaw) {
        throw new Error("Expected built-in openclaw registry entry");
      }

      openClaw.defaultStreamingMode = "stream";

      const previousRegistryPath = process.env.OPENMELD_AGENTS_REGISTRY_PATH;
      process.env.OPENMELD_AGENTS_REGISTRY_PATH = registryPath;
      await writeFile(registryPath, JSON.stringify(document, null, 2));

      try {
        expect(() => loadAgentsRegistryDocument()).toThrow(
          STREAMING_DEFAULT_RE
        );
      } finally {
        if (previousRegistryPath === undefined) {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = "";
        } else {
          process.env.OPENMELD_AGENTS_REGISTRY_PATH = previousRegistryPath;
        }
      }
    });
  });
});
