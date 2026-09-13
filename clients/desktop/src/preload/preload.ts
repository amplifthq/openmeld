import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
  type DesktopWindowDestination,
  OPENMELD_IPC,
  type OpenMeldBridge,
  WINDOW_IPC,
} from "../shared/ipc-contract";
import { type DesktopPilotBridge, PILOT_IPC } from "../shared/pilot-bridge";

const openMeldBridge: OpenMeldBridge = {
  getAuthStatus: () => ipcRenderer.invoke(OPENMELD_IPC.getAuthStatus),
  signIn: () => ipcRenderer.invoke(OPENMELD_IPC.signIn),
  signOutOnThisMac: () => ipcRenderer.invoke(OPENMELD_IPC.signOutOnThisMac),
  getServiceStatus: () => ipcRenderer.invoke(OPENMELD_IPC.getServiceStatus),
  installCli: () => ipcRenderer.invoke(OPENMELD_IPC.installCli),
  setupComputer: () => ipcRenderer.invoke(OPENMELD_IPC.setupComputer),
  installService: () => ipcRenderer.invoke(OPENMELD_IPC.installService),
  updateService: () => ipcRenderer.invoke(OPENMELD_IPC.updateService),
  startService: () => ipcRenderer.invoke(OPENMELD_IPC.startService),
  stopService: () => ipcRenderer.invoke(OPENMELD_IPC.stopService),
  updateCli: () => ipcRenderer.invoke(OPENMELD_IPC.updateCli),
  setServiceAutoStart: (enabled) =>
    ipcRenderer.invoke(OPENMELD_IPC.setServiceAutoStart, enabled),
  getAgents: () => ipcRenderer.invoke(OPENMELD_IPC.getAgents),
  setAgentEnabled: (agentId, enabled) =>
    ipcRenderer.invoke(OPENMELD_IPC.setAgentEnabled, agentId, enabled),
  openWeb: (path) => ipcRenderer.invoke(OPENMELD_IPC.openWeb, path),
  getDesktopSettings: () => ipcRenderer.invoke(OPENMELD_IPC.getDesktopSettings),
  setOpenAtLogin: (enabled) =>
    ipcRenderer.invoke(OPENMELD_IPC.setOpenAtLogin, enabled),
  getDesktopUpdateStatus: () =>
    ipcRenderer.invoke(OPENMELD_IPC.getDesktopUpdateStatus),
  openDesktopDownloadPage: () =>
    ipcRenderer.invoke(OPENMELD_IPC.openDesktopDownloadPage),
  openNodeDownloadPage: () =>
    ipcRenderer.invoke(OPENMELD_IPC.openNodeDownloadPage),
  enterApp: () => ipcRenderer.invoke(WINDOW_IPC.enterApp),
  quitDesktop: () => ipcRenderer.invoke(WINDOW_IPC.quitDesktop),
  onWindowDestinationChange: (handler) => {
    const listener = (_event: IpcRendererEvent, destination: unknown) => {
      if (isDesktopWindowDestination(destination)) {
        handler(destination);
      }
    };
    ipcRenderer.on(WINDOW_IPC.navigateDestination, listener);
    return () =>
      ipcRenderer.removeListener(WINDOW_IPC.navigateDestination, listener);
  },
};

contextBridge.exposeInMainWorld("openmeld", openMeldBridge);
contextBridge.exposeInMainWorld("openmeldDesktop", {
  platform: () => ipcRenderer.invoke(PILOT_IPC.platform),
  session: () => ipcRenderer.invoke(PILOT_IPC.session),
  signIn: () => ipcRenderer.invoke(PILOT_IPC.signIn),
  signOut: () => ipcRenderer.invoke(PILOT_IPC.signOut),
} satisfies DesktopPilotBridge);

function isDesktopWindowDestination(
  value: unknown
): value is DesktopWindowDestination {
  return value === "home" || value === "profiles" || value === "settings";
}
