import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENMELD_IPC } from "../src/shared/ipc-contract";
import type { AuthSignOutView, ServiceView } from "../src/shared/view-types";
import { LOCAL_AGENTS_GUIDE_PATH } from "../src/shared/web-paths";

const handle = vi.fn();
const removeHandler = vi.fn();

vi.mock("electron", () => ({
  ipcMain: { handle, removeHandler },
}));

afterEach(() => {
  handle.mockClear();
  removeHandler.mockClear();
  vi.resetModules();
});

describe("registerOpenMeldIpcHandlers", () => {
  it("registers the local sign-out channel", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const signOutView = {
      auth: { email: null, problem: null, signedIn: false },
      service: {
        autoStart: true,
        cliVersion: null,
        installed: true,
        lifecycle: "stopped",
        problem: null,
        running: false,
        runtimeProjection: null,
      },
      logout: {
        cleanup: { message: null, status: "finished" },
        localSession: "cleared",
        problem: null,
      },
    } satisfies AuthSignOutView;
    const signOutOnThisMac = vi.fn(() => Promise.resolve(signOutView));

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac,
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const signOutHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.signOutOnThisMac
    )?.[1] as (() => Promise<unknown>) | undefined;

    await signOutHandler?.();

    expect(signOutOnThisMac).toHaveBeenCalledTimes(1);
  });

  it("registers CLI and service update channels", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const installCli = vi.fn();
    const updateService = vi.fn();
    const upgradeCli = vi.fn();

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli,
        updateService,
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli,
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const updateServiceHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.updateService
    )?.[1] as (() => Promise<unknown>) | undefined;
    const installCliHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.installCli
    )?.[1] as (() => Promise<unknown>) | undefined;
    const updateCliHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.updateCli
    )?.[1] as (() => Promise<unknown>) | undefined;

    await installCliHandler?.();
    await updateServiceHandler?.();
    await updateCliHandler?.();

    expect(installCli).toHaveBeenCalledTimes(1);
    expect(updateService).toHaveBeenCalledTimes(1);
    expect(upgradeCli).toHaveBeenCalledTimes(1);
  });

  it("registers the Node.js download helper channel", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const openNodeDownloadPage = vi.fn(() => Promise.resolve());

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage,
      },
      vi.fn()
    );

    const openHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.openNodeDownloadPage
    )?.[1] as (() => Promise<unknown>) | undefined;

    await openHandler?.();

    expect(openNodeDownloadPage).toHaveBeenCalledTimes(1);
  });

  it("forwards only site-local paths through the open Web channel", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const openWeb = vi.fn(() => Promise.resolve());

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb,
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const openHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.openWeb
    )?.[1] as
      | ((_event: unknown, path?: unknown) => Promise<unknown>)
      | undefined;

    await openHandler?.({}, LOCAL_AGENTS_GUIDE_PATH);
    expect(() => openHandler?.({}, "https://example.com")).toThrow(
      "path must start with a single /"
    );
    expect(() => openHandler?.({}, "//example.com")).toThrow(
      "path must start with a single /"
    );

    expect(openWeb).toHaveBeenCalledWith(LOCAL_AGENTS_GUIDE_PATH);
    expect(openWeb).toHaveBeenCalledTimes(1);
  });

  it("registers Desktop update awareness channels", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const getDesktopUpdateStatus = vi.fn(() =>
      Promise.resolve({
        status: "idle" as const,
        checked: true,
        currentVersion: "0.1.0-preview.0",
        latestVersion: "0.1.0-preview.0",
        minimumSupportedVersion: null,
        downloadPageUrl: "https://openmeld.invalid/desktop",
        message: null,
        macosArm64: null,
        problem: null,
      })
    );
    const openDesktopDownloadPage = vi.fn(() => Promise.resolve());

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus,
        openDesktopDownloadPage,
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const statusHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.getDesktopUpdateStatus
    )?.[1] as (() => Promise<unknown>) | undefined;
    const openHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.openDesktopDownloadPage
    )?.[1] as (() => Promise<unknown>) | undefined;

    await statusHandler?.();
    await openHandler?.();

    expect(getDesktopUpdateStatus).toHaveBeenCalledTimes(1);
    expect(openDesktopDownloadPage).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed agent toggle payloads", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const setAgentEnabled = vi.fn();

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled,
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const toggleHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.setAgentEnabled
    )?.[1] as
      | ((
          _event: unknown,
          agentId: unknown,
          enabled: unknown
        ) => Promise<unknown>)
      | undefined;

    expect(toggleHandler).toBeDefined();
    expect(() => toggleHandler?.({}, {}, true)).toThrow(
      "agentId must be a non-empty string"
    );
    expect(() => toggleHandler?.({}, "codex", "true")).toThrow(
      "enabled must be a boolean"
    );

    expect(setAgentEnabled).not.toHaveBeenCalled();
  });

  it("forwards valid agent toggle payloads unchanged", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const setAgentEnabled = vi.fn(() =>
      Promise.resolve({ agents: [], problem: null })
    );

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled,
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const toggleHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.setAgentEnabled
    )?.[1] as
      | ((
          _event: unknown,
          agentId: unknown,
          enabled: unknown
        ) => Promise<unknown>)
      | undefined;

    await toggleHandler?.({}, "codex", true);

    expect(setAgentEnabled).toHaveBeenCalledWith("codex", true);
  });

  it("fails closed on malformed open-at-login payloads", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const setOpenAtLogin = vi.fn();

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart: vi.fn(),
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin,
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const settingsHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.setOpenAtLogin
    )?.[1] as
      | ((_event: unknown, enabled: unknown) => Promise<unknown>)
      | undefined;

    expect(settingsHandler).toBeDefined();
    expect(() => settingsHandler?.({}, "true")).toThrow(
      "enabled must be a boolean"
    );
    expect(setOpenAtLogin).not.toHaveBeenCalled();
  });

  it("fails closed on malformed service autostart payloads", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const setServiceAutoStart = vi.fn();

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart,
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const settingsHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.setServiceAutoStart
    )?.[1] as
      | ((_event: unknown, enabled: unknown) => Promise<unknown>)
      | undefined;

    expect(settingsHandler).toBeDefined();
    expect(() => settingsHandler?.({}, "true")).toThrow(
      "enabled must be a boolean"
    );
    expect(setServiceAutoStart).not.toHaveBeenCalled();
  });

  it("forwards valid service autostart payloads unchanged", async () => {
    const { registerOpenMeldIpcHandlers } = await import(
      "../src/main/register-ipc"
    );
    const serviceView: ServiceView = {
      autoStart: true,
      cliVersion: null,
      installed: true,
      lifecycle: "running",
      problem: null,
      running: true,
      runtimeProjection: null,
    };
    const setServiceAutoStart = vi.fn(() =>
      Promise.resolve({ service: serviceView, problem: null })
    );

    registerOpenMeldIpcHandlers(
      {
        getAuthStatus: vi.fn(),
        signIn: vi.fn(),
        signOutOnThisMac: vi.fn(),
        getServiceStatus: vi.fn(),
        installService: vi.fn(),
        installCli: vi.fn(),
        updateService: vi.fn(),
        startService: vi.fn(),
        stopService: vi.fn(),
        upgradeCli: vi.fn(),
        setServiceAutoStart,
        setupComputer: vi.fn(),
        getAgents: vi.fn(),
        setAgentEnabled: vi.fn(),
        openWeb: vi.fn(),
        getDesktopSettings: vi.fn(),
        setOpenAtLogin: vi.fn(),
        getDesktopUpdateStatus: vi.fn(),
        openDesktopDownloadPage: vi.fn(),
        openNodeDownloadPage: vi.fn(),
      },
      vi.fn()
    );

    const settingsHandler = handle.mock.calls.find(
      ([channel]) => channel === OPENMELD_IPC.setServiceAutoStart
    )?.[1] as
      | ((_event: unknown, enabled: unknown) => Promise<unknown>)
      | undefined;

    await settingsHandler?.({}, true);

    expect(setServiceAutoStart).toHaveBeenCalledWith(true);
  });
});
