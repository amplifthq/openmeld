import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WINDOW_IPC } from "../src/shared/ipc-contract";

vi.mock("../src/main/pilot", () => ({ initializeDesktopPilot: () => null }));

const electronMock = vi.hoisted(() => {
  const desktopVersion = "0.1.0-preview.0";
  const trayInstances: Array<{
    image: unknown;
    on: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
    setToolTip: ReturnType<typeof vi.fn>;
  }> = [];
  const windowInstances: Array<{
    center: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    options: Record<string, unknown> | undefined;
    setSize: ReturnType<typeof vi.fn>;
    webContents: {
      mainFrame: { url: string };
      isDestroyed: () => boolean;
      on: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
    };
    show: ReturnType<typeof vi.fn>;
  }> = [];

  class MockBrowserWindow {
    webContents = {
      mainFrame: {
        url: pathToFileURL(
          resolve(import.meta.dirname, "../src/renderer/index.html")
        ).href,
      },
      isDestroyed: () => false,
      on: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    once = vi.fn();
    on = vi.fn();
    isDestroyed = vi.fn(() => false);
    isMinimized = vi.fn(() => false);
    restore = vi.fn();
    center = vi.fn();
    show = vi.fn();
    setSize = vi.fn();
    focus = vi.fn();
    hide = vi.fn();
    loadFile = vi.fn(() => Promise.resolve());
    loadURL = vi.fn((url: string) => {
      this.webContents.mainFrame.url = url;
      return Promise.resolve();
    });
    options: Record<string, unknown> | undefined;

    constructor(options?: Record<string, unknown>) {
      this.options = options;
      windowInstances.push(this);
    }
  }

  class MockTray {
    on = vi.fn();
    setContextMenu = vi.fn();
    setTitle = vi.fn();
    setToolTip = vi.fn();
    image: unknown;

    constructor(image: unknown) {
      this.image = image;
      trayInstances.push(this);
    }
  }

  const app = {
    dock: { setIcon: vi.fn() },
    enableSandbox: vi.fn(),
    getVersion: vi.fn(() => desktopVersion),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setAboutPanelOptions: vi.fn(),
    setName: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  };

  const menu = {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  };

  const appIcon = {
    isEmpty: vi.fn(() => false),
  };
  const resizedTrayIcon = {
    setTemplateImage: vi.fn(),
  };
  const trayIcon = {
    isEmpty: vi.fn(() => false),
    resize: vi.fn(() => resizedTrayIcon),
  };

  const nativeImage = {
    createEmpty: vi.fn(() => ({ empty: true })),
    createFromDataURL: vi.fn((dataUrl: string) => ({
      dataUrl,
      setTemplateImage: vi.fn(),
    })),
    createFromPath: vi.fn((iconPath: string) =>
      iconPath.includes("tray-icon.png") ? trayIcon : appIcon
    ),
  };

  return {
    app,
    appIcon,
    BrowserWindow: MockBrowserWindow,
    desktopVersion,
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })),
    },
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    Menu: menu,
    nativeImage,
    resizedTrayIcon,
    shell: { openExternal: vi.fn() },
    Tray: MockTray,
    trayIcon,
    trayInstances,
    windowInstances,
  };
});

const desktopMock = vi.hoisted(() => {
  const runningServiceView = {
    installed: true,
    lifecycle: "running",
    problem: null,
    running: true,
    autoStart: true,
    cliVersion: null,
    runtimeProjection: null,
  };
  const handlers = {
    getAuthStatus: vi.fn(),
    getAgents: vi.fn(),
    getDesktopSettings: vi.fn(),
    getServiceStatus: vi.fn(),
    installCli: vi.fn(),
    installService: vi.fn(),
    updateService: vi.fn(),
    openDesktopDownloadPage: vi.fn(),
    openNodeDownloadPage: vi.fn(),
    openWeb: vi.fn(),
    setAgentEnabled: vi.fn(),
    setOpenAtLogin: vi.fn(),
    setServiceAutoStart: vi.fn(),
    setupComputer: vi.fn(),
    signIn: vi.fn(),
    signOutOnThisMac: vi.fn(),
    startService: vi.fn(),
    stopService: vi.fn(),
    upgradeCli: vi.fn(),
  };
  function resetHandlers() {
    handlers.getAuthStatus.mockReset();
    handlers.getAgents.mockReset();
    handlers.getDesktopSettings.mockReset();
    handlers.getServiceStatus.mockReset();
    handlers.installCli.mockReset();
    handlers.installService.mockReset();
    handlers.openDesktopDownloadPage.mockReset();
    handlers.openNodeDownloadPage.mockReset();
    handlers.updateService.mockReset();
    handlers.openWeb.mockReset();
    handlers.setAgentEnabled.mockReset();
    handlers.setOpenAtLogin.mockReset();
    handlers.setServiceAutoStart.mockReset();
    handlers.setupComputer.mockReset();
    handlers.signIn.mockReset();
    handlers.signOutOnThisMac.mockReset();
    handlers.startService.mockReset();
    handlers.stopService.mockReset();
    handlers.upgradeCli.mockReset();

    handlers.getAuthStatus.mockResolvedValue({
      email: "felix@openmeld.invalid",
      problem: null,
      signedIn: true,
    });
    handlers.getDesktopSettings.mockResolvedValue({
      openAtLogin: false,
      problem: null,
    });
    handlers.getServiceStatus.mockResolvedValue({ ...runningServiceView });
    handlers.installCli.mockResolvedValue({ ...runningServiceView });
    handlers.setupComputer.mockResolvedValue({ ...runningServiceView });
    handlers.startService.mockResolvedValue({ ...runningServiceView });
    handlers.stopService.mockResolvedValue({ ...runningServiceView });
    handlers.updateService.mockResolvedValue({ ...runningServiceView });
    handlers.upgradeCli.mockResolvedValue({ ...runningServiceView });
    handlers.signIn.mockResolvedValue({
      email: "felix@openmeld.invalid",
      problem: null,
      signedIn: true,
    });
    handlers.signOutOnThisMac.mockResolvedValue({
      auth: { email: null, problem: null, signedIn: false },
      logout: {
        cleanup: { message: null, status: "finished" },
        localSession: "cleared",
        problem: null,
      },
      service: { ...runningServiceView, lifecycle: "stopped", running: false },
    });
  }
  return { handlers, resetHandlers, runningServiceView };
});

vi.mock("electron", () => electronMock);

vi.mock("../src/main/ipc-handlers", () => ({
  createDesktopHandlers: vi.fn(() => desktopMock.handlers),
}));

vi.mock("../src/main/register-ipc", () => ({
  registerOpenMeldIpcHandlers: vi.fn(() => vi.fn()),
}));

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  "platform"
);

function setTestPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
}

function restoreTestPlatform(): void {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, "platform", originalPlatformDescriptor);
  }
}

async function importMain(): Promise<void> {
  await import("../src/main/main");
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  restoreTestPlatform();
  desktopMock.resetHandlers();
  electronMock.trayInstances.length = 0;
  electronMock.windowInstances.length = 0;
  electronMock.app.enableSandbox.mockClear();
  electronMock.app.dock.setIcon.mockClear();
  electronMock.app.getVersion.mockClear();
  electronMock.app.on.mockClear();
  electronMock.app.quit.mockClear();
  electronMock.app.requestSingleInstanceLock.mockReset();
  electronMock.app.requestSingleInstanceLock.mockReturnValue(true);
  electronMock.app.setAboutPanelOptions.mockClear();
  electronMock.app.setName.mockClear();
  electronMock.app.whenReady.mockClear();
  electronMock.ipcMain.handle.mockClear();
  electronMock.dialog.showErrorBox.mockClear();
  electronMock.dialog.showMessageBox.mockClear();
  electronMock.dialog.showMessageBox.mockResolvedValue({ response: 1 });
  electronMock.Menu.buildFromTemplate.mockClear();
  electronMock.Menu.setApplicationMenu.mockClear();
  electronMock.appIcon.isEmpty.mockClear();
  electronMock.trayIcon.isEmpty.mockClear();
  electronMock.trayIcon.resize.mockClear();
  electronMock.resizedTrayIcon.setTemplateImage.mockClear();
  electronMock.nativeImage.createEmpty.mockClear();
  electronMock.nativeImage.createFromDataURL.mockClear();
  electronMock.nativeImage.createFromPath.mockClear();
});

describe("main tray behavior", () => {
  it("quits duplicate desktop instances before creating another tray", async () => {
    electronMock.app.requestSingleInstanceLock.mockReturnValueOnce(false);

    await importMain();

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);
    expect(electronMock.trayInstances).toHaveLength(0);
    expect(electronMock.windowInstances).toHaveLength(0);
  });

  it("focuses the existing OpenMeld Desktop window when a duplicate instance starts", async () => {
    await importMain();

    const secondInstanceHandler = electronMock.app.on.mock.calls.find(
      ([event]) => event === "second-instance"
    )?.[1] as (() => void) | undefined;
    const window = electronMock.windowInstances.at(0);

    expect(secondInstanceHandler).toBeDefined();
    expect(window).toBeDefined();

    secondInstanceHandler?.();

    expect(window?.show).toHaveBeenCalled();
    expect(window?.focus).toHaveBeenCalled();
  });

  it("creates the status window at the Desktop workspace size", async () => {
    await importMain();

    const window = electronMock.windowInstances.at(0);

    expect(window?.options).toMatchObject({
      width: 1040,
      height: 720,
      minWidth: 960,
      minHeight: 640,
    });
  });

  it("applies OpenMeld Desktop identity to native app, menu, and window surfaces", async () => {
    setTestPlatform("darwin");

    await importMain();

    const window = electronMock.windowInstances.at(0);
    const applicationMenu = electronMock.Menu.setApplicationMenu.mock.calls.at(
      0
    )?.[0] as Array<{
      label?: string;
      submenu?: Array<{ label?: string }>;
    }>;

    expect(electronMock.app.setName).toHaveBeenCalledWith("OpenMeld Desktop");
    expect(electronMock.app.setAboutPanelOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationName: "OpenMeld Desktop",
        applicationVersion: electronMock.desktopVersion,
        version: electronMock.desktopVersion,
      })
    );
    expect(electronMock.app.dock.setIcon).toHaveBeenCalledWith(
      electronMock.appIcon
    );
    expect(window?.options).toMatchObject({
      icon: electronMock.appIcon,
      title: "OpenMeld Desktop",
    });
    expect(applicationMenu.at(0)).toEqual(
      expect.objectContaining({ label: "OpenMeld Desktop" })
    );
    expect(applicationMenu.at(0)?.submenu?.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "About OpenMeld Desktop",
        "Settings...",
        "Quit OpenMeld Desktop",
      ])
    );
  });

  it("opens OpenMeld Desktop only from the explicit tray menu item", async () => {
    await importMain();

    const tray = electronMock.trayInstances.at(0);

    expect(tray).toBeDefined();
    expect(tray?.on).not.toHaveBeenCalledWith("click", expect.any(Function));

    const menuTemplate = tray?.setContextMenu.mock.calls.at(0)?.[0] as
      | Array<{ label?: string; click?: () => void }>
      | undefined;

    expect((menuTemplate ?? []).flatMap((item) => item.label ?? [])).toEqual(
      expect.arrayContaining([
        "Open OpenMeld Desktop",
        "Open OpenMeld Web App",
        "Open Settings",
      ])
    );
  });

  it("uses the generated OpenMeld logo resource for the menu bar tray icon", async () => {
    await importMain();

    const tray = electronMock.trayInstances.at(0);

    expect(electronMock.nativeImage.createFromPath).toHaveBeenCalledWith(
      expect.stringContaining("resources/tray-icon.png")
    );
    expect(electronMock.trayIcon.resize).toHaveBeenCalledWith({ height: 18 });
    expect(electronMock.resizedTrayIcon.setTemplateImage).toHaveBeenCalledWith(
      true
    );
    expect(tray?.image).toBe(electronMock.resizedTrayIcon);
    expect(tray?.setTitle).not.toHaveBeenCalled();
  });

  it("opens Settings from the tray menu", async () => {
    await importMain();

    trayMenuItem("Open Settings")?.click?.();

    const window = electronMock.windowInstances.at(0);
    expect(window).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window?.webContents.send).toHaveBeenCalledWith(
      WINDOW_IPC.navigateDestination,
      "settings"
    );
  });

  it("blocks renderer-created windows and renderer-initiated navigation", async () => {
    await importMain();

    const window = electronMock.windowInstances.at(0);

    expect(window?.webContents.setWindowOpenHandler).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const windowOpenHandler = window?.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as (() => { action: "deny" }) | undefined;

    expect(windowOpenHandler?.()).toEqual({ action: "deny" });
    expect(window?.webContents.on).toHaveBeenCalledWith(
      "will-navigate",
      expect.any(Function)
    );

    const navigationEvent = { preventDefault: vi.fn() };
    const navigationHandler = window?.webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate"
    )?.[1] as ((event: typeof navigationEvent) => void) | undefined;

    navigationHandler?.(navigationEvent);

    expect(navigationEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  function trayMenuLabels(): string[] {
    return (trayMenuTemplate() ?? []).flatMap((item) =>
      item.label ? [item.label] : []
    );
  }

  function trayMenuTemplate():
    | Array<{
        click?: () => void;
        enabled?: boolean;
        icon?: unknown;
        label?: string;
        type?: string;
      }>
    | undefined {
    const tray = electronMock.trayInstances.at(0);
    return tray?.setContextMenu.mock.calls.at(-1)?.[0] as
      | Array<{
          click?: () => void;
          enabled?: boolean;
          icon?: unknown;
          label?: string;
          type?: string;
        }>
      | undefined;
  }

  function trayMenuItem(label: string): { click?: () => void } | undefined {
    return trayMenuTemplate()?.find((item) => item.label === label);
  }

  it("shows Desktop version information and groups tray actions", async () => {
    await importMain();

    expect(trayMenuLabels()).toEqual([
      "OpenMeld Service: Running",
      `OpenMeld Desktop: v${electronMock.desktopVersion}`,
      "Open OpenMeld Desktop",
      "Open OpenMeld Web App",
      "Open Settings",
      "Reconnect This Computer",
      "Stop OpenMeld Service",
      "Quit OpenMeld Desktop",
    ]);

    const menuTemplate = trayMenuTemplate();
    expect(menuTemplate?.map((item) => item.type ?? item.label)).toEqual([
      "OpenMeld Service: Running",
      `OpenMeld Desktop: v${electronMock.desktopVersion}`,
      "separator",
      "Open OpenMeld Desktop",
      "Open OpenMeld Web App",
      "separator",
      "Open Settings",
      "separator",
      "Reconnect This Computer",
      "Stop OpenMeld Service",
      "separator",
      "Quit OpenMeld Desktop",
    ]);
    expect(menuTemplate?.at(0)).toEqual(
      expect.objectContaining({ enabled: false })
    );
    expect(menuTemplate?.at(1)).toEqual(
      expect.objectContaining({ enabled: false })
    );
  });

  it("adds native icons to every clickable tray action", async () => {
    setTestPlatform("darwin");

    await importMain();

    const clickableItems = trayMenuTemplate()?.filter((item) => item.click);

    expect(clickableItems).toHaveLength(6);
    for (const item of clickableItems ?? []) {
      expect(item.icon).toBeTruthy();
    }
    expect(electronMock.nativeImage.createFromDataURL).toHaveBeenCalled();
    expect(
      electronMock.nativeImage.createFromDataURL.mock.calls.every(([dataUrl]) =>
        String(dataUrl).startsWith("data:image/svg+xml;charset=utf-8,")
      )
    ).toBe(true);
    expect(
      electronMock.nativeImage.createFromDataURL.mock.calls.every(([dataUrl]) =>
        String(dataUrl).includes("%23d4d4d4")
      )
    ).toBe(true);
  });

  it("offers Reconnect + Stop (not Start) while the service is running", async () => {
    await importMain();

    const labels = trayMenuLabels();

    expect(labels).toEqual(
      expect.arrayContaining([
        "Reconnect This Computer",
        "Stop OpenMeld Service",
      ])
    );
    // Binary menu: a running service never also offers Start.
    expect(labels).not.toContain("Start OpenMeld Service");
    expect(labels).not.toContain("Install OpenMeld Service");
    expect(labels.some((label) => label.endsWith("..."))).toBe(false);
  });

  it("offers only Start (not Stop) while the service is stopped", async () => {
    desktopMock.handlers.getServiceStatus.mockResolvedValueOnce({
      installed: true,
      lifecycle: "stopped",
      problem: null,
      running: false,
      autoStart: true,
      cliVersion: null,
      runtimeProjection: null,
    });

    await importMain();

    const labels = trayMenuLabels();

    expect(labels).toContain("Start OpenMeld Service");
    expect(labels).not.toContain("Stop OpenMeld Service");
  });

  it("starts OpenMeld Service from the tray without native confirmation", async () => {
    desktopMock.handlers.getServiceStatus.mockResolvedValueOnce({
      installed: true,
      lifecycle: "stopped",
      problem: null,
      running: false,
      autoStart: true,
      cliVersion: null,
      runtimeProjection: null,
    });

    await importMain();

    trayMenuItem("Start OpenMeld Service")?.click?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(electronMock.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(desktopMock.handlers.startService).toHaveBeenCalledTimes(1);
  });

  it("confirms Stop OpenMeld Service before the tray stops local execution capacity", async () => {
    await importMain();

    trayMenuItem("Stop OpenMeld Service")?.click?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["Cancel", "Stop OpenMeld Service"],
        detail:
          "This Mac cannot receive local Wake work until OpenMeld Service is started again.",
        message: "Stop OpenMeld Service on this Mac",
        title: "Stop OpenMeld Service?",
      })
    );
    expect(desktopMock.handlers.stopService).toHaveBeenCalledTimes(1);
  });

  it("does not stop OpenMeld Service from the tray when confirmation is cancelled", async () => {
    electronMock.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });

    await importMain();

    trayMenuItem("Stop OpenMeld Service")?.click?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(electronMock.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(desktopMock.handlers.stopService).not.toHaveBeenCalled();
  });

  it("confirms Reconnect This Computer before tray setup runs", async () => {
    await importMain();

    trayMenuItem("Reconnect This Computer")?.click?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["Cancel", "Reconnect This Computer"],
        detail:
          "This reruns setup for this Mac and may restart OpenMeld Service. It will not sign you out.",
        message: "Reconnect This Computer",
        title: "Reconnect this computer?",
      })
    );
    expect(desktopMock.handlers.setupComputer).toHaveBeenCalledTimes(1);
  });

  it("offers only Set Up while the service is not installed", async () => {
    desktopMock.handlers.getServiceStatus.mockResolvedValueOnce({
      installed: false,
      lifecycle: "not_installed",
      problem: null,
      running: false,
      autoStart: null,
      cliVersion: null,
      runtimeProjection: null,
    });

    await importMain();

    const labels = trayMenuLabels();

    expect(labels).toContain("Set Up This Computer");
    expect(labels).not.toContain("Start OpenMeld Service");
    expect(labels).not.toContain("Stop OpenMeld Service");
  });

  it("quits the desktop app from the tray menu", async () => {
    await importMain();

    const tray = electronMock.trayInstances.at(0);
    const menuTemplate = tray?.setContextMenu.mock.calls.at(-1)?.[0] as
      | Array<{ label?: string; click?: () => void }>
      | undefined;
    const quitItem = menuTemplate?.find(
      (item) => item.label === "Quit OpenMeld Desktop"
    );

    quitItem?.click?.();

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);
  });

  it("quits the desktop app through the allowlisted window IPC", async () => {
    await importMain();

    const quitHandler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === "window:quit-desktop"
    )?.[1] as ((event: IpcMainInvokeEvent) => void) | undefined;

    expect(quitHandler).toBeDefined();

    const sender = electronMock.windowInstances[0]?.webContents;
    expect(() =>
      quitHandler?.({
        sender,
        senderFrame: null,
      } as unknown as IpcMainInvokeEvent)
    ).toThrow();
    expect(electronMock.app.quit).not.toHaveBeenCalled();
    quitHandler?.({
      sender,
      senderFrame: sender?.mainFrame,
    } as unknown as IpcMainInvokeEvent);

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);
  });

  it("labels CLI spawn failure as command-line tool unavailable", async () => {
    const spawnProblem = {
      code: "desktop.spawn_failed",
      kind: "spawn_failed",
      message: "failed to launch openmeld: spawn openmeld ENOENT",
      requestId: null,
    };
    desktopMock.handlers.getServiceStatus.mockResolvedValueOnce({
      installed: null,
      lifecycle: "unknown",
      problem: spawnProblem,
      running: null,
      autoStart: null,
      cliVersion: null,
      runtimeProjection: null,
    });

    await importMain();

    const tray = electronMock.trayInstances.at(0);
    const menuTemplate = tray?.setContextMenu.mock.calls.at(-1)?.[0] as
      | Array<{ label?: string }>
      | undefined;

    expect(menuTemplate?.at(0)?.label).toBe(
      "OpenMeld Command-Line Tool: Not Available"
    );
    expect(tray?.setToolTip).toHaveBeenLastCalledWith(
      "OpenMeld Command-Line Tool - Not Available"
    );
  });

  it("shows a specific dialog title for tray action spawn failures", async () => {
    const spawnProblem = {
      code: "desktop.spawn_failed",
      kind: "spawn_failed",
      message: "failed to launch openmeld: spawn openmeld ENOENT",
      requestId: null,
    };
    desktopMock.handlers.setupComputer.mockResolvedValueOnce({
      installed: null,
      lifecycle: "unknown",
      problem: spawnProblem,
      running: null,
      autoStart: null,
      cliVersion: null,
      runtimeProjection: null,
    });

    await importMain();

    const tray = electronMock.trayInstances.at(0);
    const menuTemplate = tray?.setContextMenu.mock.calls.at(-1)?.[0] as
      | Array<{ label?: string; click?: () => void }>
      | undefined;
    const setupItem = menuTemplate?.find(
      (item) => item.label === "Reconnect This Computer"
    );

    setupItem?.click?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      "OpenMeld Desktop could not find the OpenMeld command-line tool.",
      "failed to launch openmeld: spawn openmeld ENOENT"
    );
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalledWith(
      "OpenMeld Desktop could not update the service.",
      expect.any(String)
    );
  });
});
