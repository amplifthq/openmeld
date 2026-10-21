import type {
  DaemonRuntimeAdapterCapabilitySnapshot,
  LocalComponentsStatus,
  RuntimeTransportBaseCapabilities,
} from "@openmeld/schemas/types";
import { resolveRegistryRuntimeAdapterCapabilitySnapshot } from "../../agents/registry-source";

export function resolveDaemonCapabilitiesFromAdapterIds(input: {
  adapterIds: readonly string[];
  localComponentsStatus?: LocalComponentsStatus | null;
  profileConfigurationRevision?: boolean;
}): RuntimeTransportBaseCapabilities {
  const runtimeAdapters = input.adapterIds
    .map(resolveRegistryRuntimeAdapterCapabilitySnapshot)
    .filter(
      (entry): entry is DaemonRuntimeAdapterCapabilitySnapshot => entry !== null
    )
    .sort((left, right) => left.adapterId.localeCompare(right.adapterId));

  return {
    agentReplyContextReview: true,
    informationProtectionPrompt: true,
    workingLanguagePrompt: true,
    permissionModeAdvisoryPrompt: true,
    verifiedRequesterContext: true,
    requesterConversationIsolation: true,
    localAgentInteraction: true,
    ...(input.profileConfigurationRevision === true
      ? { profileConfigurationRevision: true as const }
      : {}),
    ...(input.localComponentsStatus
      ? { localComponents: input.localComponentsStatus }
      : {}),
    openMeldToolsControl: {
      requestAutomaticUpdate: true,
      requestUpdate: true,
      setAutomaticUpdates: true,
    },
    localAgentControl: {
      cancel: true,
      forkSession: true,
      interrupt: true,
      manageInstallations: true,
      manageInstallationsSafely: true,
      updateInstallations: true,
      setupInstallations: true,
      refreshCatalog: true,
      resumeControllerConversation: true,
      setEnabled: true,
      setProfileWorkspace: true,
      readProfileWorkspace: true,
      initializeProfileWorkspace: true,
      manageProfileFolders: true,
      repairProfileFolders: true,
    },
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
    ...(runtimeAdapters.length > 0 ? { runtimeAdapters } : {}),
  };
}
