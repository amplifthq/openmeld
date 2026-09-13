import type { DesktopPlatform, DesktopSession } from "@openmeld/schemas";

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
} as const;
export type DesktopPilotBridge = {
  platform(): Promise<DesktopPlatform>;
  session(): Promise<DesktopSession>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};
