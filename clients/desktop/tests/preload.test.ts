import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENMELD_IPC, WINDOW_IPC } from "../src/shared/ipc-contract";
import { LOCAL_AGENTS_GUIDE_PATH } from "../src/shared/web-paths";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

afterEach(() => {
  exposeInMainWorld.mockClear();
  invoke.mockClear();
  on.mockClear();
  removeListener.mockClear();
  vi.resetModules();
});

describe("preload bridge", () => {
  it("exposes only the OpenMeld bridge methods on window.openmeld", async () => {
    await import("../src/preload/preload");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(2);
    const [name, bridge] = exposeInMainWorld.mock.calls[0] ?? [];

    expect(name).toBe("openmeld");
    expect(Object.keys(bridge as Record<string, unknown>).sort()).toEqual([
      "enterApp",
      "getAgents",
      "getAuthStatus",
      "getDesktopSettings",
      "getDesktopUpdateStatus",
      "getServiceStatus",
      "installCli",
      "installService",
      "onWindowDestinationChange",
      "openDesktopDownloadPage",
      "openNodeDownloadPage",
      "openWeb",
      "quitDesktop",
      "setAgentEnabled",
      "setOpenAtLogin",
      "setServiceAutoStart",
      "setupComputer",
      "signIn",
      "signOutOnThisMac",
      "startService",
      "stopService",
      "updateCli",
      "updateService",
    ]);
  });

  it("maps bridge methods to fixed IPC channels", async () => {
    await import("../src/preload/preload");
    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    const openmeld = bridge as {
      getServiceStatus(): Promise<unknown>;
      installService(): Promise<unknown>;
      installCli(): Promise<unknown>;
      startService(): Promise<unknown>;
      updateCli(): Promise<unknown>;
      updateService(): Promise<unknown>;
      getDesktopSettings(): Promise<unknown>;
      getDesktopUpdateStatus(): Promise<unknown>;
      getAgents(): Promise<unknown>;
      openDesktopDownloadPage(): Promise<unknown>;
      openNodeDownloadPage(): Promise<unknown>;
      openWeb(path?: string): Promise<unknown>;
      quitDesktop(): Promise<unknown>;
      setAgentEnabled(agentId: string, enabled: boolean): Promise<unknown>;
      setServiceAutoStart(enabled: boolean): Promise<unknown>;
      setOpenAtLogin(enabled: boolean): Promise<unknown>;
      signOutOnThisMac(): Promise<unknown>;
    };

    await openmeld.getServiceStatus();
    await openmeld.installCli();
    await openmeld.installService();
    await openmeld.startService();
    await openmeld.updateCli();
    await openmeld.updateService();
    await openmeld.getDesktopSettings();
    await openmeld.getDesktopUpdateStatus();
    await openmeld.getAgents();
    await openmeld.openDesktopDownloadPage();
    await openmeld.openNodeDownloadPage();
    await openmeld.openWeb(LOCAL_AGENTS_GUIDE_PATH);
    await openmeld.setAgentEnabled("codex", true);
    await openmeld.setServiceAutoStart(true);
    await openmeld.setOpenAtLogin(true);
    await openmeld.signOutOnThisMac();
    await openmeld.quitDesktop();

    expect(invoke.mock.calls).toEqual([
      [OPENMELD_IPC.getServiceStatus],
      [OPENMELD_IPC.installCli],
      [OPENMELD_IPC.installService],
      [OPENMELD_IPC.startService],
      [OPENMELD_IPC.updateCli],
      [OPENMELD_IPC.updateService],
      [OPENMELD_IPC.getDesktopSettings],
      [OPENMELD_IPC.getDesktopUpdateStatus],
      [OPENMELD_IPC.getAgents],
      [OPENMELD_IPC.openDesktopDownloadPage],
      [OPENMELD_IPC.openNodeDownloadPage],
      [OPENMELD_IPC.openWeb, LOCAL_AGENTS_GUIDE_PATH],
      [OPENMELD_IPC.setAgentEnabled, "codex", true],
      [OPENMELD_IPC.setServiceAutoStart, true],
      [OPENMELD_IPC.setOpenAtLogin, true],
      [OPENMELD_IPC.signOutOnThisMac],
      [WINDOW_IPC.quitDesktop],
    ]);
  });

  it("subscribes to fixed window destination events from main", async () => {
    await import("../src/preload/preload");
    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    const openmeld = bridge as {
      onWindowDestinationChange(
        handler: (destination: string) => void
      ): () => void;
    };
    const handler = vi.fn();

    const unsubscribe = openmeld.onWindowDestinationChange(handler);
    const listener = on.mock.calls[0]?.[1] as
      | ((_event: unknown, destination: unknown) => void)
      | undefined;

    expect(on).toHaveBeenCalledWith(
      WINDOW_IPC.navigateDestination,
      expect.any(Function)
    );

    listener?.({}, "settings");
    listener?.({}, "unknown");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("settings");

    unsubscribe();

    expect(removeListener).toHaveBeenCalledWith(
      WINDOW_IPC.navigateDestination,
      listener
    );
  });
});
