import type {
  DesktopComputerConnectionRequest,
  DesktopComputerConnectionResult,
  DesktopNotificationContext,
  DesktopNotificationReference,
  DesktopNotificationRequest,
  DesktopNotificationResult,
  DesktopNotificationTest,
  DesktopPlatform,
  DesktopSession,
  DesktopSpaceStreamBridge,
} from "@openmeld/schemas";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: Window requires interface merging.
  interface Window {
    openmeldDesktop: DesktopPilotBridge;
  }
}

export const PILOT_IPC = {
  notificationContext: "desktop:notification-context",
  notificationShow: "desktop:notification-show",
  notificationTest: "desktop:notification-test",
  notificationClick: "desktop:notification-click",
  notificationFocused: "desktop:notification-focused",
  notificationPoll: "desktop:notification-poll",
  platform: "desktop:platform",
  session: "desktop:session",
  signIn: "desktop:sign-in",
  signOut: "desktop:sign-out",
  connectComputer: "desktop:connect-computer",
  sessionChanged: "desktop:session-changed",
  spaceStreamOpen: "desktop:space-stream-open",
  spaceStreamClose: "desktop:space-stream-close",
  spaceStreamPing: "desktop:space-stream-ping",
  spaceStreamEvent: "desktop:space-stream-event",
} as const;
export type DesktopPilotBridge = DesktopSpaceStreamBridge & {
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
    handler: (input: DesktopNotificationReference) => void
  ): () => void;
  platform(): Promise<DesktopPlatform>;
  session(): Promise<DesktopSession>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  connectComputer(
    input: DesktopComputerConnectionRequest
  ): Promise<DesktopComputerConnectionResult>;
  onSessionChanged(handler: () => void): () => void;
};
