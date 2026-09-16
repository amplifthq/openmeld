import type { IpcRendererEvent } from "electron";
import { expect, it, vi } from "vitest";
import { type OpenMeldBridge, WINDOW_IPC } from "../src/shared/ipc-contract";
import type { DesktopPilotBridge } from "../src/shared/pilot-bridge";

const electron = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  listeners: new Map<
    string,
    (event: IpcRendererEvent, value: unknown) => void
  >(),
}));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, bridge: unknown) =>
      electron.exposed.set(name, bridge),
  },
  ipcRenderer: {
    on: (
      channel: string,
      listener: (event: IpcRendererEvent, value: unknown) => void
    ) => electron.listeners.set(channel, listener),
  },
}));

it("delivers early native Settings intent to the shared renderer once, including after remount", async () => {
  await import("../src/preload/preload");
  const receive = electron.listeners.get(WINDOW_IPC.navigateDestination);
  if (!receive) {
    throw new Error("Missing destination subscription");
  }
  const event = {} as IpcRendererEvent;
  receive(event, "settings");
  receive(event, "settings");
  const bridge = electron.exposed.get("openmeldDesktop") as DesktopPilotBridge;
  const open = vi.fn();
  const unsubscribe = bridge.onWindowDestinationChange(open);
  expect(open.mock.calls).toEqual([["settings"]]);
  receive(event, "settings");
  expect(open.mock.calls).toEqual([["settings"], ["settings"]]);
  unsubscribe();
  receive(event, "settings");
  receive(event, "untrusted-destination");
  const next = vi.fn();
  bridge.onWindowDestinationChange(next)();
  expect(next.mock.calls).toEqual([["settings"]]);
  // Both renderer families consume the same intent, not two pending stores.
  const legacy = electron.exposed.get("openmeld") as OpenMeldBridge;
  const stale = vi.fn();
  legacy.onWindowDestinationChange(stale)();
  expect(stale).not.toHaveBeenCalled();
});
