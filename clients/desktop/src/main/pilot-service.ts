import type { DesktopHandlers } from "./ipc-handlers";

/** The pilot reuses an existing Service; local mutation has no atomic cloud-account binding yet. */
export function readOnlyPilotServiceHandlers(
  base: DesktopHandlers
): DesktopHandlers {
  const unavailable = () =>
    Promise.reject(
      new Error(
        "Computer changes are unavailable in this Desktop pilot. Manage this computer in OpenMeld Web."
      )
    );
  return {
    ...base,
    signIn: unavailable,
    signOutOnThisMac: unavailable,
    installCli: unavailable,
    upgradeCli: unavailable,
    setupComputer: unavailable,
    installService: unavailable,
    updateService: unavailable,
    startService: unavailable,
    stopService: unavailable,
    setServiceAutoStart: unavailable,
    setAgentEnabled: unavailable,
  };
}
