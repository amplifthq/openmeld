// The IPC contract between the renderer and the Electron main process.
// The preload script exposes `OpenMeldBridge` on `window.openmeld` (contextBridge); main
// implements each method by running L1 commands + L2 mappers, so the renderer
// only ever sees view types — never raw CLI output. Single source for the
// channel names shared by preload + main.

import type {
  AgentsView,
  AuthSignOutView,
  AuthView,
  DesktopSettingsView,
  DesktopUpdateView,
  ServiceAutoStartUpdateView,
  ServiceView,
} from "./view-types";

export type OpenMeldBridge = {
  getAuthStatus(): Promise<AuthView>;
  /** Opens the browser sign-in flow; resolves once it finishes (or is closed). */
  signIn(): Promise<AuthView>;
  /** Signs out the local OpenMeld session on this Mac, then rereads auth + service. */
  signOutOnThisMac(): Promise<AuthSignOutView>;
  getServiceStatus(): Promise<ServiceView>;
  /** Installs the official OpenMeld CLI npm package, then rereads service status. */
  installCli(): Promise<ServiceView>;
  /** `openmeld setup` — installs + starts + connects this computer. */
  setupComputer(): Promise<ServiceView>;
  installService(): Promise<ServiceView>;
  updateService(): Promise<ServiceView>;
  startService(): Promise<ServiceView>;
  stopService(): Promise<ServiceView>;
  updateCli(): Promise<ServiceView>;
  setServiceAutoStart(enabled: boolean): Promise<ServiceAutoStartUpdateView>;
  getAgents(): Promise<AgentsView>;
  setAgentEnabled(agentId: string, enabled: boolean): Promise<AgentsView>;
  /** Opens OpenMeld on the web in the default browser. Optional path must stay on OpenMeld Web. */
  openWeb(path?: string): Promise<void>;
  getDesktopSettings(): Promise<DesktopSettingsView>;
  setOpenAtLogin(enabled: boolean): Promise<DesktopSettingsView>;
  /** Checks whether this Desktop build should prompt the user to update. */
  getDesktopUpdateStatus(): Promise<DesktopUpdateView>;
  /** Opens the public Desktop download page in the default browser. */
  openDesktopDownloadPage(): Promise<void>;
  /** Opens the Node.js download page when this Mac does not have Node/npm. */
  openNodeDownloadPage(): Promise<void>;
  /** Renderer signals the splash is done; main shrinks the wide splash window
   * to the compact app size. */
  enterApp(): Promise<void>;
  /** Quit the Electron app/tray. Does not stop OpenMeld Service or sign out. */
  quitDesktop(): Promise<void>;
  /** Subscribe to main-process requests to show a top-level Desktop section. */
  onWindowDestinationChange(
    handler: (destination: DesktopWindowDestination) => void
  ): () => void;
};

export type DesktopWindowDestination = "home" | "profiles" | "settings";

/** Window-control channels (handled directly in main, not via DesktopHandlers). */
export const WINDOW_IPC = {
  enterApp: "window:enter-app",
  navigateDestination: "window:navigate-destination",
  quitDesktop: "window:quit-desktop",
} as const;

export const OPENMELD_IPC = {
  getAuthStatus: "openmeld:get-auth-status",
  signIn: "openmeld:sign-in",
  signOutOnThisMac: "openmeld:sign-out-on-this-mac",
  getServiceStatus: "openmeld:get-service-status",
  installCli: "openmeld:install-cli",
  setupComputer: "openmeld:setup-computer",
  installService: "openmeld:install-service",
  updateService: "openmeld:update-service",
  startService: "openmeld:start-service",
  stopService: "openmeld:stop-service",
  updateCli: "openmeld:update-cli",
  setServiceAutoStart: "openmeld:set-service-auto-start",
  getAgents: "openmeld:get-agents",
  setAgentEnabled: "openmeld:set-agent-enabled",
  openWeb: "openmeld:open-web",
  getDesktopSettings: "openmeld:get-desktop-settings",
  setOpenAtLogin: "openmeld:set-open-at-login",
  getDesktopUpdateStatus: "openmeld:get-desktop-update-status",
  openDesktopDownloadPage: "openmeld:open-desktop-download-page",
  openNodeDownloadPage: "openmeld:open-node-download-page",
} as const;

export type OpenMeldIpcChannel =
  (typeof OPENMELD_IPC)[keyof typeof OPENMELD_IPC];
