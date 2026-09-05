import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import type {
  DaemonRuntimeAdapterCapabilitySnapshot,
  LocalComponentsStatus,
  RuntimeTransportBaseCapabilities,
} from "@openmeld/schemas/types";
import { resolveRegistryRuntimeAdapterCapabilitySnapshot } from "../../agents/registry-source";

export function resolveDaemonCapabilities(input: {
  localAdapterContainer: LocalDaemonAdapterContainer;
  localComponentsStatus?: LocalComponentsStatus | null;
  profileConfigurationRevision?: boolean;
}): RuntimeTransportBaseCapabilities {
  const runtimeAdapters = input.localAdapterContainer
    .listAdapters()
    .map((entry) =>
      resolveRegistryRuntimeAdapterCapabilitySnapshot(entry.adapterId)
    )
    .filter(
      (entry): entry is DaemonRuntimeAdapterCapabilitySnapshot => entry !== null
    )
    .sort((left, right) => left.adapterId.localeCompare(right.adapterId));

  return {
    agentReplyContextReview: true,
    informationProtectionPrompt: true,
    workingLanguagePrompt: true,
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
      refreshCatalog: true,
      resumeControllerConversation: true,
      setEnabled: true,
      setProfileWorkspace: true,
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
