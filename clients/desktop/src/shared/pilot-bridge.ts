import type {
  DesktopComputerConnectionRequest,
  DesktopComputerConnectionResult,
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
  platform(): Promise<DesktopPlatform>;
  session(): Promise<DesktopSession>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  connectComputer(
    input: DesktopComputerConnectionRequest
  ): Promise<DesktopComputerConnectionResult>;
  onSessionChanged(handler: () => void): () => void;
};
