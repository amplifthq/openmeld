import { runtimeTransportBaseCapabilitiesSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { resolveDaemonCapabilitiesFromAdapterIds } from "../src/local-service/adapters/resolve-daemon-capabilities";

describe("resolve local service capabilities", () => {
  it("returns sorted runtime adapter capability snapshots for installed adapters", () => {
    expect(
      resolveDaemonCapabilitiesFromAdapterIds({
        adapterIds: ["openclaw", "unknown-adapter", "codex"],
      })
    ).toEqual({
      agentReplyContextReview: true,
      informationProtectionPrompt: true,
      workingLanguagePrompt: true,
      permissionModeAdvisoryPrompt: true,
      verifiedRequesterContext: true,
      requesterConversationIsolation: true,
      localAgentControl: {
        cancel: true,
        forkSession: true,
        initializeProfileWorkspace: true,
        interrupt: true,
        manageInstallations: true,
        manageInstallationsSafely: true,
        manageProfileFolders: true,
        repairProfileFolders: true,
        readProfileWorkspace: true,
        refreshCatalog: true,
        resumeControllerConversation: true,
        setEnabled: true,
        setProfileWorkspace: true,
        setupInstallations: true,
        updateInstallations: true,
      },
      localAgentInteraction: true,
      localProjectControl: {
        connectCandidate: true,
        connectDeclaredPath: true,
        discoverProjects: true,
        readConnections: true,
        moveConnection: true,
        removeConnection: true,
        removeMissingConnections: true,
        setDefaultConnection: true,
      },
      openMeldToolsControl: {
        requestAutomaticUpdate: true,
        requestUpdate: true,
        setAutomaticUpdates: true,
      },
      runtimeAdapters: [
        {
          adapterId: "codex",
          capabilityDeclaration: {
            continuationCapability: "standard",
            executionContextVersion: 7,
            executionContextPermissionInheritance: true,
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

  it("omits runtime adapters when no reported adapter has a registry capability snapshot", () => {
    expect(
      resolveDaemonCapabilitiesFromAdapterIds({
        adapterIds: ["unknown-adapter"],
      })
    ).toEqual({
      agentReplyContextReview: true,
      informationProtectionPrompt: true,
      workingLanguagePrompt: true,
      permissionModeAdvisoryPrompt: true,
      verifiedRequesterContext: true,
      requesterConversationIsolation: true,
      localAgentControl: {
        cancel: true,
        forkSession: true,
        initializeProfileWorkspace: true,
        interrupt: true,
        manageInstallations: true,
        manageInstallationsSafely: true,
        manageProfileFolders: true,
        repairProfileFolders: true,
        readProfileWorkspace: true,
        refreshCatalog: true,
        resumeControllerConversation: true,
        setEnabled: true,
        setProfileWorkspace: true,
        setupInstallations: true,
        updateInstallations: true,
      },
      localAgentInteraction: true,
      localProjectControl: {
        connectCandidate: true,
        connectDeclaredPath: true,
        discoverProjects: true,
        readConnections: true,
        moveConnection: true,
        removeConnection: true,
        removeMissingConnections: true,
        setDefaultConnection: true,
      },
      openMeldToolsControl: {
        requestAutomaticUpdate: true,
        requestUpdate: true,
        setAutomaticUpdates: true,
      },
    });
  });

  it("advertises profile configuration revisions only after route support is confirmed", () => {
    expect(
      resolveDaemonCapabilitiesFromAdapterIds({
        adapterIds: [],
        profileConfigurationRevision: true,
      })
    ).toMatchObject({
      profileConfigurationRevision: true,
    });
    expect(
      resolveDaemonCapabilitiesFromAdapterIds({
        adapterIds: [],
      })
    ).not.toHaveProperty("profileConfigurationRevision");
  });

  it("keeps unscoped Service registration within the base capability contract", () => {
    const capabilities = resolveDaemonCapabilitiesFromAdapterIds({
      adapterIds: [],
    });

    expect(
      runtimeTransportBaseCapabilitiesSchema.safeParse(capabilities)
    ).toMatchObject({ success: true });
    expect(capabilities).not.toHaveProperty("computerFileAccess");
  });
});
