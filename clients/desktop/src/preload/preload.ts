import {
  type DesktopNotificationActivation,
  desktopComputerConnectionOperationSchema,
  desktopComputerConnectionProgressSchema,
  desktopComputerDisconnectResultSchema,
  desktopComputerOperationSchema,
  desktopNotificationActivationSchema,
  desktopSpaceStreamEventSchema,
  desktopUpdaterRestartRequestSchema,
  desktopUpdaterStateSchema,
} from "@openmeld/schemas";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
  type DesktopWindowDestination,
  OPENMELD_IPC,
  type OpenMeldBridge,
  WINDOW_IPC,
} from "../shared/ipc-contract";
import { type DesktopPilotBridge, PILOT_IPC } from "../shared/pilot-bridge";

// Attach before renderer code loads. Keep only the latest navigation intent
// until the active renderer subscribes; this is not Settings dialog state.
let pendingDestination: DesktopWindowDestination | undefined;
let pendingNotification: DesktopNotificationActivation | undefined;
const notificationHandlers = new Set<
  (activation: DesktopNotificationActivation) => void
>();
ipcRenderer.on(PILOT_IPC.notificationClick, (_event, value: unknown) => {
  const parsed = desktopNotificationActivationSchema.safeParse(value);
  if (!parsed.success) {
    return;
  }
  if (notificationHandlers.size === 0) {
    pendingNotification = parsed.data;
    return;
  }
  for (const handler of notificationHandlers) {
    handler(parsed.data);
  }
});
ipcRenderer.on(PILOT_IPC.sessionChanged, () => {
  pendingNotification = undefined;
});
const destinationHandlers = new Set<
  (destination: DesktopWindowDestination) => void
>();
let pendingNavigationHref: string | undefined;
const navigationHandlers = new Set<(href: string) => void>();
ipcRenderer.on(WINDOW_IPC.navigateHref, (_event, href: unknown) => {
  if (typeof href !== "string" || !href.startsWith("/")) {
    return;
  }
  if (navigationHandlers.size === 0) {
    pendingNavigationHref = href;
    return;
  }
  for (const handler of navigationHandlers) {
    handler(href);
  }
});
ipcRenderer.on(
  WINDOW_IPC.navigateDestination,
  (_event, destination: unknown) => {
    if (!isDesktopWindowDestination(destination)) {
      return;
    }
    if (destinationHandlers.size === 0) {
      pendingDestination = destination;
      return;
    }
    for (const handler of destinationHandlers) {
      handler(destination);
    }
  }
);

const openMeldBridge: OpenMeldBridge = {
  getAuthStatus: () => ipcRenderer.invoke(OPENMELD_IPC.getAuthStatus),
  signIn: () => ipcRenderer.invoke(OPENMELD_IPC.signIn),
  signOutOnThisMac: () => ipcRenderer.invoke(OPENMELD_IPC.signOutOnThisMac),
  getServiceStatus: () => ipcRenderer.invoke(OPENMELD_IPC.getServiceStatus),
  installCli: () => ipcRenderer.invoke(OPENMELD_IPC.installCli),
  setupComputer: () => ipcRenderer.invoke(OPENMELD_IPC.setupComputer),
  installService: () => ipcRenderer.invoke(OPENMELD_IPC.installService),
  updateService: () => ipcRenderer.invoke(OPENMELD_IPC.updateService),
  startService: (expectedAccount) =>
    ipcRenderer.invoke(OPENMELD_IPC.startService, expectedAccount),
  stopService: (expectedAccount) =>
    ipcRenderer.invoke(OPENMELD_IPC.stopService, expectedAccount),
  updateCli: () => ipcRenderer.invoke(OPENMELD_IPC.updateCli),
  setServiceAutoStart: (enabled) =>
    ipcRenderer.invoke(OPENMELD_IPC.setServiceAutoStart, enabled),
  getAgents: () => ipcRenderer.invoke(OPENMELD_IPC.getAgents),
  setAgentEnabled: (agentId, enabled) =>
    ipcRenderer.invoke(OPENMELD_IPC.setAgentEnabled, agentId, enabled),
  openWeb: (path) => ipcRenderer.invoke(OPENMELD_IPC.openWeb, path),
  openExternal: (url) => ipcRenderer.invoke(OPENMELD_IPC.openExternal, url),
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
    destinationHandlers.add(handler);
    if (pendingDestination) {
      const destination = pendingDestination;
      pendingDestination = undefined;
      handler(destination);
    }
    return () => {
      destinationHandlers.delete(handler);
    };
  },
  onNavigationRequest: (handler) => {
    navigationHandlers.add(handler);
    if (pendingNavigationHref) {
      const href = pendingNavigationHref;
      pendingNavigationHref = undefined;
      handler(href);
    }
    return () => navigationHandlers.delete(handler);
  },
};

contextBridge.exposeInMainWorld("openmeld", openMeldBridge);
contextBridge.exposeInMainWorld("openmeldDesktop", {
  updaterState: async () =>
    desktopUpdaterStateSchema.parse(
      await ipcRenderer.invoke(PILOT_IPC.updaterState)
    ),
  updaterAction: (action) =>
    ipcRenderer.invoke(PILOT_IPC.updaterAction, action),
  updaterPrepared: (reply) =>
    ipcRenderer.invoke(PILOT_IPC.updaterPrepared, reply),
  onUpdaterChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const result = desktopUpdaterStateSchema.safeParse(value);
      if (result.success) {
        handler(result.data);
      }
    };
    ipcRenderer.on(PILOT_IPC.updaterChanged, listener);
    return () => ipcRenderer.removeListener(PILOT_IPC.updaterChanged, listener);
  },
  onUpdaterPrepare: (handler) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const result = desktopUpdaterRestartRequestSchema.safeParse(value);
      if (result.success) {
        handler(result.data);
      }
    };
    ipcRenderer.on(PILOT_IPC.updaterPrepare, listener);
    return () => ipcRenderer.removeListener(PILOT_IPC.updaterPrepare, listener);
  },
  onWindowDestinationChange: openMeldBridge.onWindowDestinationChange,
  onNavigationRequest: openMeldBridge.onNavigationRequest,
  openExternal: openMeldBridge.openExternal,
  setNotificationContext: (input) =>
    ipcRenderer.invoke(PILOT_IPC.notificationContext, input),
  showNotification: (input) =>
    ipcRenderer.invoke(PILOT_IPC.notificationShow, input),
  testNotification: (input) =>
    ipcRenderer.invoke(PILOT_IPC.notificationTest, input),
  notificationFocused: () => ipcRenderer.invoke(PILOT_IPC.notificationFocused),
  onNotificationPoll: (handler) => {
    const listener = () => handler();
    ipcRenderer.on(PILOT_IPC.notificationPoll, listener);
    return () =>
      ipcRenderer.removeListener(PILOT_IPC.notificationPoll, listener);
  },
  onNotificationClick: (handler) => {
    notificationHandlers.add(handler);
    if (pendingNotification) {
      const activation = pendingNotification;
      pendingNotification = undefined;
      handler(activation);
    }
    return () => {
      notificationHandlers.delete(handler);
    };
  },
  platform: () => ipcRenderer.invoke(PILOT_IPC.platform),
  session: () => ipcRenderer.invoke(PILOT_IPC.session),
  localComputer: () => ipcRenderer.invoke(PILOT_IPC.localComputer),
  signIn: () => ipcRenderer.invoke(PILOT_IPC.signIn),
  signOut: () => ipcRenderer.invoke(PILOT_IPC.signOut),
  connectComputer: (input) =>
    ipcRenderer.invoke(PILOT_IPC.connectComputer, input),
  disconnectComputer: (input) =>
    ipcRenderer.invoke(PILOT_IPC.disconnectComputer, input),
  disconnectComputerWithFeedback: async (input) =>
    desktopComputerDisconnectResultSchema.parse(
      await ipcRenderer.invoke(PILOT_IPC.disconnectComputerWithFeedback, input)
    ),
  computerOperationCurrent: async () => {
    const parsed = desktopComputerOperationSchema
      .nullable()
      .safeParse(
        await ipcRenderer.invoke(PILOT_IPC.connectionOperationCurrent)
      );
    return parsed.success ? parsed.data : null;
  },
  onComputerOperation: (handler) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const parsed = desktopComputerOperationSchema.safeParse(value);
      if (parsed.success) {
        handler(parsed.data);
      }
    };
    ipcRenderer.on(PILOT_IPC.connectionOperation, listener);
    return () =>
      ipcRenderer.removeListener(PILOT_IPC.connectionOperation, listener);
  },
  connectionProgressCurrent: async () => {
    const parsed = desktopComputerConnectionProgressSchema
      .nullable()
      .safeParse(await ipcRenderer.invoke(PILOT_IPC.connectionProgressCurrent));
    return parsed.success ? parsed.data : null;
  },
  connectionOperationCurrent: async () => {
    const parsed = desktopComputerConnectionOperationSchema
      .nullable()
      .safeParse(
        await ipcRenderer.invoke(PILOT_IPC.connectionOperationCurrent)
      );
    return parsed.success ? parsed.data : null;
  },
  onConnectionProgress: (handler) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const parsed = desktopComputerConnectionProgressSchema.safeParse(value);
      if (parsed.success) {
        handler(parsed.data);
      }
    };
    ipcRenderer.on(PILOT_IPC.connectionProgress, listener);
    return () =>
      ipcRenderer.removeListener(PILOT_IPC.connectionProgress, listener);
  },
  onConnectionOperation: (handler) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const parsed = desktopComputerConnectionOperationSchema.safeParse(value);
      if (parsed.success) {
        handler(parsed.data);
      }
    };
    ipcRenderer.on(PILOT_IPC.connectionOperation, listener);
    return () =>
      ipcRenderer.removeListener(PILOT_IPC.connectionOperation, listener);
  },
  onSessionChanged: (handler) => {
    const listener = () => handler();
    ipcRenderer.on(PILOT_IPC.sessionChanged, listener);
    return () => ipcRenderer.removeListener(PILOT_IPC.sessionChanged, listener);
  },
  spaceStreamOpen: (input) =>
    ipcRenderer.invoke(PILOT_IPC.spaceStreamOpen, input),
  spaceStreamClose: (id) => ipcRenderer.invoke(PILOT_IPC.spaceStreamClose, id),
  spaceStreamPing: (id) => ipcRenderer.invoke(PILOT_IPC.spaceStreamPing, id),
  onSpaceStream: (handler) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const result = desktopSpaceStreamEventSchema.safeParse(value);
      if (result.success) {
        handler(result.data);
      }
    };
    ipcRenderer.on(PILOT_IPC.spaceStreamEvent, listener);
    return () =>
      ipcRenderer.removeListener(PILOT_IPC.spaceStreamEvent, listener);
  },
  accountStreamOpen: (input) =>
    ipcRenderer.invoke(PILOT_IPC.accountStreamOpen, input),
  accountStreamClose: (id) =>
    ipcRenderer.invoke(PILOT_IPC.accountStreamClose, id),
  accountStreamPing: (id) =>
    ipcRenderer.invoke(PILOT_IPC.accountStreamPing, id),
  onAccountStream: (handler) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const result = desktopSpaceStreamEventSchema.safeParse(value);
      if (result.success) {
        handler(result.data);
      }
    };
    ipcRenderer.on(PILOT_IPC.accountStreamEvent, listener);
    return () =>
      ipcRenderer.removeListener(PILOT_IPC.accountStreamEvent, listener);
  },
} satisfies DesktopPilotBridge);

function isDesktopWindowDestination(
  value: unknown
): value is DesktopWindowDestination {
  return (
    value === "computer" ||
    value === "home" ||
    value === "inbox" ||
    value === "profiles" ||
    value === "settings"
  );
}
