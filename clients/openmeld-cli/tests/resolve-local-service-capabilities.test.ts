import type { RuntimeAdapter } from "@openmeld/adapter-core";
import { createLocalAdapterContainer } from "@openmeld/local-service";
import { runtimeTransportBaseCapabilitiesSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { resolveDaemonCapabilities } from "../src/local-service/adapters/resolve-daemon-capabilities";

function createStubAdapter(): RuntimeAdapter {
  return {} as RuntimeAdapter;
}

describe("resolve local service capabilities", () => {
  it("returns sorted runtime adapter capability snapshots for installed adapters", () => {
    const localAdapterContainer = createLocalAdapterContainer([
      {
        adapter: createStubAdapter(),
        adapterId: "openclaw",
        transportModes: ["local-cli"],
      },
      {
        adapter: createStubAdapter(),
        adapterId: "unknown-adapter",
        transportModes: ["local-cli"],
      },
      {
        adapter: createStubAdapter(),
        adapterId: "codex",
        transportModes: ["codex-app-server"],
      },
    ]);

    expect(
      resolveDaemonCapabilities({
        localAdapterContainer,
      })
    ).toEqual({
      agentReplyContextReview: true,
      informationProtectionPrompt: true,
      workingLanguagePrompt: true,
      localAgentControl: {
        cancel: true,
        interrupt: true,
        manageInstallations: true,
        refreshCatalog: true,
        resumeControllerConversation: true,
        setEnabled: true,
        setProfileWorkspace: true,
      },
      localAgentInteraction: true,
      localProjectControl: {
        connectCandidate: true,
        connectDeclaredPath: true,
        discoverProjects: true,
        moveConnection: true,
        removeConnection: true,
        removeMissingConnections: true,
        setDefaultConnection: true,
      },
      runtimeAdapters: [
        {
          adapterId: "codex",
          capabilityDeclaration: {
            continuationCapability: "standard",
            imageInputCapability: "local_file_path",
            preparationRequirement: "none",
            runtimeWorkingDirectoryMode: "spawn_cwd",
            streamingCapability: "preview_capable",
            workspaceResumeBehavior: "transparent",
          },
          defaultStreamingMode: "final",
          transportModes: ["codex-app-server"],
        },
        {
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
        },
      ],
    });
  });

  it("returns an empty object when no installed adapter has a registry capability snapshot", () => {
    const localAdapterContainer = createLocalAdapterContainer([
      {
        adapter: createStubAdapter(),
        adapterId: "unknown-adapter",
        transportModes: ["local-cli"],
      },
    ]);

    expect(
      resolveDaemonCapabilities({
        localAdapterContainer,
      })
    ).toEqual({
      agentReplyContextReview: true,
      informationProtectionPrompt: true,
      workingLanguagePrompt: true,
      localAgentControl: {
        cancel: true,
        interrupt: true,
        manageInstallations: true,
        refreshCatalog: true,
        resumeControllerConversation: true,
        setEnabled: true,
        setProfileWorkspace: true,
      },
      localAgentInteraction: true,
      localProjectControl: {
        connectCandidate: true,
        connectDeclaredPath: true,
        discoverProjects: true,
        moveConnection: true,
        removeConnection: true,
        removeMissingConnections: true,
        setDefaultConnection: true,
      },
    });
  });

  it("advertises profile configuration revisions only after route support is confirmed", () => {
    const localAdapterContainer = createLocalAdapterContainer([]);

    expect(
      resolveDaemonCapabilities({
        localAdapterContainer,
        profileConfigurationRevision: true,
      })
    ).toMatchObject({
      profileConfigurationRevision: true,
    });
    expect(
      resolveDaemonCapabilities({
        localAdapterContainer,
      })
    ).not.toHaveProperty("profileConfigurationRevision");
  });

  it("keeps new Service registration compatible with the frozen Core capability schema", () => {
    const capabilities = resolveDaemonCapabilities({
      localAdapterContainer: createLocalAdapterContainer([]),
    });

    expect(
      runtimeTransportBaseCapabilitiesSchema.safeParse(capabilities)
    ).toMatchObject({ success: true });
    expect(capabilities).not.toHaveProperty("computerFileAccess");
  });
});
