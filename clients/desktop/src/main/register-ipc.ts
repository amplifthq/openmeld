import { ipcMain } from "electron";
import { OPENMELD_IPC } from "../shared/ipc-contract";
import { isAbsoluteWebPath } from "./desktop-environment";
import type { DesktopHandlers } from "./ipc-handlers";

export function registerOpenMeldIpcHandlers(
  handlers: DesktopHandlers
): () => void {
  ipcMain.handle(OPENMELD_IPC.getAuthStatus, () => handlers.getAuthStatus());
  ipcMain.handle(OPENMELD_IPC.signIn, () => handlers.signIn());
  ipcMain.handle(OPENMELD_IPC.signOutOnThisMac, () =>
    handlers.signOutOnThisMac()
  );
  ipcMain.handle(OPENMELD_IPC.getServiceStatus, () =>
    handlers.getServiceStatus()
  );
  ipcMain.handle(OPENMELD_IPC.installCli, () => handlers.installCli());
  ipcMain.handle(OPENMELD_IPC.setupComputer, () => handlers.setupComputer());
  ipcMain.handle(OPENMELD_IPC.installService, () => handlers.installService());
  ipcMain.handle(OPENMELD_IPC.updateService, () => handlers.updateService());
  ipcMain.handle(OPENMELD_IPC.startService, () => handlers.startService());
  ipcMain.handle(OPENMELD_IPC.stopService, () => handlers.stopService());
  ipcMain.handle(OPENMELD_IPC.updateCli, () => handlers.upgradeCli());
  ipcMain.handle(OPENMELD_IPC.setServiceAutoStart, (_event, enabled) => {
    const input = validateServiceAutoStartInput(enabled);
    return handlers.setServiceAutoStart(input.enabled);
  });
  ipcMain.handle(OPENMELD_IPC.getAgents, () => handlers.getAgents());
  ipcMain.handle(OPENMELD_IPC.openWeb, (_event, path) => {
    const input = validateOpenWebInput(path);
    return handlers.openWeb(input.path);
  });
  ipcMain.handle(OPENMELD_IPC.getDesktopSettings, () =>
    handlers.getDesktopSettings()
  );
  ipcMain.handle(OPENMELD_IPC.setOpenAtLogin, (_event, enabled) => {
    const input = validateOpenAtLoginInput(enabled);
    return handlers.setOpenAtLogin(input.enabled);
  });
  ipcMain.handle(OPENMELD_IPC.getDesktopUpdateStatus, () =>
    handlers.getDesktopUpdateStatus()
  );
  ipcMain.handle(OPENMELD_IPC.openDesktopDownloadPage, () =>
    handlers.openDesktopDownloadPage()
  );
  ipcMain.handle(OPENMELD_IPC.openNodeDownloadPage, () =>
    handlers.openNodeDownloadPage()
  );
  ipcMain.handle(OPENMELD_IPC.setAgentEnabled, (_event, agentId, enabled) => {
    const input = validateAgentToggleInput(agentId, enabled);
    return handlers.setAgentEnabled(input.agentId, input.enabled);
  });

  return () => {
    for (const channel of Object.values(OPENMELD_IPC)) {
      ipcMain.removeHandler(channel);
    }
  };
}

function validateAgentToggleInput(
  agentId: unknown,
  enabled: unknown
): { agentId: string; enabled: boolean } {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new Error("agentId must be a non-empty string");
  }
  if (typeof enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return { agentId, enabled };
}

function validateOpenAtLoginInput(enabled: unknown): { enabled: boolean } {
  if (typeof enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return { enabled };
}

function validateServiceAutoStartInput(enabled: unknown): { enabled: boolean } {
  if (typeof enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return { enabled };
}

function validateOpenWebInput(path: unknown): { path?: string } {
  if (typeof path === "undefined") {
    return {};
  }
  if (!isAbsoluteWebPath(path)) {
    throw new Error("path must start with a single /");
  }
  return { path };
}
