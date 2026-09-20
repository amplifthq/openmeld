import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENMELD_IPC, WINDOW_IPC } from "../src/shared/ipc-contract";
import { type DesktopPilotBridge, PILOT_IPC } from "../src/shared/pilot-bridge";
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
  it("validates Disconnect feedback without changing the legacy boolean method", async () => {
    await import("../src/preload/preload");
    const bridge = exposeInMainWorld.mock.calls.find(
      ([name]) => name === "openmeldDesktop"
    )?.[1] as DesktopPilotBridge;
    const request = { expectedAccount: "account-a" };
    const result = {
      status: "unconfirmed",
      code: "desktop.disconnect.unconfirmed",
      message: "Check the connection before trying again.",
      diagnosticId: "operation-a",
    };
    invoke.mockResolvedValueOnce(result);
    await expect(
      bridge.disconnectComputerWithFeedback?.(request)
    ).resolves.toEqual(result);
    expect(invoke).toHaveBeenLastCalledWith(
      PILOT_IPC.disconnectComputerWithFeedback,
      request
    );
    invoke.mockResolvedValueOnce({
      ...result,
      token: "must-not-cross-the-bridge",
    });
    await expect(
      bridge.disconnectComputerWithFeedback?.(request)
    ).rejects.toThrow();
    invoke.mockResolvedValueOnce(false);
    await expect(bridge.disconnectComputer(request)).resolves.toBe(false);
    expect(invoke).toHaveBeenLastCalledWith(
      PILOT_IPC.disconnectComputer,
      request
    );
  });

  it("shares one operation channel while filtering rich records from legacy observers", async () => {
    await import("../src/preload/preload");
    const bridge = exposeInMainWorld.mock.calls.find(
      ([name]) => name === "openmeldDesktop"
    )?.[1] as DesktopPilotBridge;
    const operation = {
      kind: "disconnect",
      operationId: "operation-a",
      request: { expectedAccount: "account-a" },
      status: "pending",
      phase: "waiting_for_confirmation",
      result: null,
    };
    invoke.mockResolvedValueOnce(operation);
    await expect(bridge.computerOperationCurrent?.()).resolves.toEqual(
      operation
    );
    expect(invoke).toHaveBeenLastCalledWith(
      PILOT_IPC.connectionOperationCurrent
    );
    invoke.mockResolvedValueOnce(operation);
    await expect(bridge.connectionOperationCurrent()).resolves.toBeNull();
    invoke.mockResolvedValueOnce({ ...operation, phase: "invented_phase" });
    await expect(bridge.computerOperationCurrent?.()).resolves.toBeNull();
    const rich = vi.fn();
    const stopRich = bridge.onComputerOperation?.(rich);
    const richListener = on.mock.calls.findLast(
      ([channel]) => channel === PILOT_IPC.connectionOperation
    )?.[1];
    const legacy = vi.fn();
    const stopLegacy = bridge.onConnectionOperation(legacy);
    const legacyListener = on.mock.calls.findLast(
      ([channel]) => channel === PILOT_IPC.connectionOperation
    )?.[1];
    richListener({}, operation);
    richListener({}, { ...operation, token: "must-not-cross-the-bridge" });
    legacyListener({}, operation);
    expect(rich).toHaveBeenCalledExactlyOnceWith(operation);
    expect(legacy).not.toHaveBeenCalled();
    stopRich?.();
    stopLegacy();
    expect(removeListener).toHaveBeenCalledWith(
      PILOT_IPC.connectionOperation,
      richListener
    );
    expect(removeListener).toHaveBeenCalledWith(
      PILOT_IPC.connectionOperation,
      legacyListener
    );
  });

  it("retains only the latest notification until subscription and clears it on session change", async () => {
    await import("../src/preload/preload");
    const bridge = exposeInMainWorld.mock.calls.find(
      ([name]) => name === "openmeldDesktop"
    )?.[1] as DesktopPilotBridge;
    const click = on.mock.calls.find(
      ([channel]) => channel === PILOT_IPC.notificationClick
    )?.[1];
    const sessionChanged = on.mock.calls.find(
      ([channel]) => channel === PILOT_IPC.sessionChanged
    )?.[1];
    const activation = {
      userId: "user-a",
      organizationId: "org-a",
      organizationSlug: "workspace",
      itemId: "item-a",
      sourceTarget: { kind: "space", spaceId: "space-a", signalId: "signal-a" },
    };
    click({}, activation);
    click({}, { ...activation, itemId: "item-b" });
    const handler = vi.fn();
    const unsubscribe = bridge.onNotificationClick(handler);
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      ...activation,
      itemId: "item-b",
    });
    unsubscribe();
    click({}, activation);
    sessionChanged({});
    bridge.onNotificationClick(handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("exposes a payload-free session invalidation and removes its exact listener", async () => {
    await import("../src/preload/preload");
    const bridge = exposeInMainWorld.mock.calls.find(
      ([name]) => name === "openmeldDesktop"
    )?.[1] as DesktopPilotBridge;
    const changed = vi.fn();
    const unsubscribe = bridge.onSessionChanged(changed);
    const listener = on.mock.calls.findLast(
      ([channel]) => channel === PILOT_IPC.sessionChanged
    )?.[1];
    listener({}, { token: "must-not-cross-the-bridge" });
    expect(changed.mock.calls).toEqual([[]]);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(
      PILOT_IPC.sessionChanged,
      listener
    );
  });

  it("validates Space stream close details before delivering them", async () => {
    await import("../src/preload/preload");
    const bridge = exposeInMainWorld.mock.calls.find(
      ([name]) => name === "openmeldDesktop"
    )?.[1] as DesktopPilotBridge;
    const handler = vi.fn();
    const unsubscribe = bridge.onSpaceStream(handler);
    const listener = on.mock.calls.find(
      ([channel]) => channel === PILOT_IPC.spaceStreamEvent
    )?.[1];
    const close = {
      id: "10000000-0000-4000-8000-000000000001",
      type: "close",
      code: 1008,
      reason: "space_access_changed",
    };

    listener({}, close);
    listener({}, { id: close.id, type: "close" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(close);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(
      PILOT_IPC.spaceStreamEvent,
      listener
    );
  });
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
      "onNavigationRequest",
      "onWindowDestinationChange",
      "openDesktopDownloadPage",
      "openExternal",
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
      startService(expectedAccount?: string): Promise<unknown>;
      updateCli(): Promise<unknown>;
      updateService(): Promise<unknown>;
      getDesktopSettings(): Promise<unknown>;
      getDesktopUpdateStatus(): Promise<unknown>;
      getAgents(): Promise<unknown>;
      openDesktopDownloadPage(): Promise<unknown>;
      openNodeDownloadPage(): Promise<unknown>;
      openExternal(url: string): Promise<unknown>;
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
    await openmeld.startService("account-a");
    await openmeld.updateCli();
    await openmeld.updateService();
    await openmeld.getDesktopSettings();
    await openmeld.getDesktopUpdateStatus();
    await openmeld.getAgents();
    await openmeld.openDesktopDownloadPage();
    await openmeld.openNodeDownloadPage();
    await openmeld.openExternal("https://example.com/docs");
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
      [OPENMELD_IPC.startService, "account-a"],
      [OPENMELD_IPC.updateCli],
      [OPENMELD_IPC.updateService],
      [OPENMELD_IPC.getDesktopSettings],
      [OPENMELD_IPC.getDesktopUpdateStatus],
      [OPENMELD_IPC.getAgents],
      [OPENMELD_IPC.openDesktopDownloadPage],
      [OPENMELD_IPC.openNodeDownloadPage],
      [OPENMELD_IPC.openExternal, "https://example.com/docs"],
      [OPENMELD_IPC.openWeb, LOCAL_AGENTS_GUIDE_PATH],
      [OPENMELD_IPC.setAgentEnabled, "codex", true],
      [OPENMELD_IPC.setServiceAutoStart, true],
      [OPENMELD_IPC.setOpenAtLogin, true],
      [OPENMELD_IPC.signOutOnThisMac],
      [WINDOW_IPC.quitDesktop],
    ]);
  });

  it("retains early destination intent for the shared renderer and unsubscribes consumers", async () => {
    await import("../src/preload/preload");
    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    const openmeld = bridge as {
      onWindowDestinationChange(
        handler: (destination: string) => void
      ): () => void;
    };
    const handler = vi.fn();

    const listener = on.mock.calls.find(
      ([channel]) => channel === WINDOW_IPC.navigateDestination
    )?.[1] as ((_event: unknown, destination: unknown) => void) | undefined;

    expect(on).toHaveBeenCalledWith(
      WINDOW_IPC.navigateDestination,
      expect.any(Function)
    );

    listener?.({}, "settings");
    listener?.({}, "settings");
    listener?.({}, "unknown");

    const shared = exposeInMainWorld.mock.calls.find(
      ([name]) => name === "openmeldDesktop"
    )?.[1] as DesktopPilotBridge;
    const unsubscribe = shared.onWindowDestinationChange(handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("settings");

    unsubscribe();
    listener?.({}, "settings");
    expect(handler).toHaveBeenCalledTimes(1);
    const next = vi.fn();
    openmeld.onWindowDestinationChange(next)();
    expect(next.mock.calls).toEqual([["settings"]]);
    const stale = vi.fn();
    shared.onWindowDestinationChange(stale)();
    expect(stale).not.toHaveBeenCalled();
  });

  it("retains one early Router navigation and stops delivery after unsubscribe", async () => {
    await import("../src/preload/preload");
    const bridge = exposeInMainWorld.mock.calls.find(
      ([name]) => name === "openmeldDesktop"
    )?.[1] as DesktopPilotBridge;
    const listener = on.mock.calls.find(
      ([channel]) => channel === WINDOW_IPC.navigateHref
    )?.[1] as ((_event: unknown, href: unknown) => void) | undefined;
    const handler = vi.fn();

    listener?.({}, "https://evil.example/o/acme");
    listener?.({}, "/o/acme/agents?profileId=agent-1#activity");
    const unsubscribe = bridge.onNavigationRequest(handler);

    expect(handler).toHaveBeenCalledExactlyOnceWith(
      "/o/acme/agents?profileId=agent-1#activity"
    );
    unsubscribe();
    listener?.({}, "/o/acme/spaces/space-1");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
