import type { RuntimeTransportLookupOwnerServiceResponse } from "@openmeld/schemas/types";

type Session = Extract<
  RuntimeTransportLookupOwnerServiceResponse,
  { online: true }
>["sessions"][number];

/** Read projection and command admission share the same Service capability policy. */
export function projectPeopleComputerControls(session: Session) {
  const compatible = session.executionCompatibility.status === "compatible";
  const agents = session.capabilities.localAgentControl;
  const tools = session.capabilities.openMeldToolsControl;
  return {
    localFolderPicker: {
      selectFolders:
        compatible &&
        session.capabilities.localFolderPicker?.selectFolders === true,
    },
    computerFileAccess: {
      readPolicy:
        compatible &&
        session.capabilities.computerFileAccess?.readPolicy === true,
      updatePolicy:
        compatible &&
        session.capabilities.computerFileAccess?.updatePolicy === true,
    },
    localAgentControl: {
      refreshCatalog: compatible && agents?.refreshCatalog === true,
      setEnabled: compatible && agents?.setEnabled === true,
      manageInstallations: compatible && agents?.manageInstallations === true,
      manageInstallationsSafely:
        compatible && agents?.manageInstallationsSafely === true,
      setProfileWorkspace: compatible && agents?.setProfileWorkspace === true,
    },
    openMeldToolsControl: {
      requestUpdate: compatible && tools?.requestUpdate === true,
      setAutomaticUpdates: compatible && tools?.setAutomaticUpdates === true,
    },
  };
}
