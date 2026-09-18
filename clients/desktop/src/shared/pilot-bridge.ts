import type {
  DesktopComputerConnectionProgress,
  DesktopComputerConnectionRequest,
  DesktopComputerConnectionResult,
  DesktopComputerDisconnectRequest,
  DesktopLocalComputer,
  DesktopNotificationActivation,
  DesktopNotificationContext,
  DesktopNotificationRequest,
  DesktopNotificationResult,
  DesktopNotificationTest,
  DesktopPlatform,
  DesktopSession,
  DesktopSpaceStreamBridge,
  DesktopUpdaterAction,
  DesktopUpdaterRestartReply,
  DesktopUpdaterRestartRequest,
  DesktopUpdaterState,
} from "@openmeld/schemas";
import type { OpenMeldBridge } from "./ipc-contract";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: Window requires interface merging.
  interface Window {
    openmeldDesktop: DesktopPilotBridge;
  }
}

export const PILOT_IPC = {
  updaterState: "desktop:updater-state",
  updaterAction: "desktop:updater-action",
  updaterChanged: "desktop:updater-changed",
  updaterPrepare: "desktop:updater-prepare",
  updaterPrepared: "desktop:updater-prepared",
  notificationContext: "desktop:notification-context",
  notificationShow: "desktop:notification-show",
  notificationTest: "desktop:notification-test",
  notificationClick: "desktop:notification-click",
  notificationFocused: "desktop:notification-focused",
  notificationPoll: "desktop:notification-poll",
  platform: "desktop:platform",
  session: "desktop:session",
  localComputer: "desktop:local-computer",
  signIn: "desktop:sign-in",
  signOut: "desktop:sign-out",
  connectComputer: "desktop:connect-computer",
  disconnectComputer: "desktop:disconnect-computer",
  connectionProgress: "desktop:connection-progress",
  sessionChanged: "desktop:session-changed",
  spaceStreamOpen: "desktop:space-stream-open",
  spaceStreamClose: "desktop:space-stream-close",
  spaceStreamPing: "desktop:space-stream-ping",
  spaceStreamEvent: "desktop:space-stream-event",
} as const;
export type DesktopPilotBridge = DesktopSpaceStreamBridge & {
  updaterState(): Promise<DesktopUpdaterState>;
  updaterAction(action: DesktopUpdaterAction): Promise<void>;
  updaterPrepared(reply: DesktopUpdaterRestartReply): Promise<void>;
  onUpdaterChanged(handler: (state: DesktopUpdaterState) => void): () => void;
  onUpdaterPrepare(
    handler: (request: DesktopUpdaterRestartRequest) => void
  ): () => void;
  onWindowDestinationChange: OpenMeldBridge["onWindowDestinationChange"];
  onNavigationRequest: OpenMeldBridge["onNavigationRequest"];
  openExternal: OpenMeldBridge["openExternal"];
  setNotificationContext(input: DesktopNotificationContext): Promise<void>;
  showNotification(
    input: DesktopNotificationRequest
  ): Promise<DesktopNotificationResult>;
  testNotification(
    input: DesktopNotificationTest
  ): Promise<DesktopNotificationResult>;
  notificationFocused(): Promise<boolean>;
  onNotificationPoll(handler: () => void): () => void;
  onNotificationClick(
    handler: (input: DesktopNotificationActivation) => void
  ): () => void;
  platform(): Promise<DesktopPlatform>;
  session(): Promise<DesktopSession>;
  localComputer(): Promise<DesktopLocalComputer>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  connectComputer(
    input: DesktopComputerConnectionRequest
  ): Promise<DesktopComputerConnectionResult>;
  disconnectComputer(input: DesktopComputerDisconnectRequest): Promise<boolean>;
  onConnectionProgress(
    handler: (progress: DesktopComputerConnectionProgress) => void
  ): () => void;
  onSessionChanged(handler: () => void): () => void;
};
