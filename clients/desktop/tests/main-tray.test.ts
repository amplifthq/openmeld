import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WINDOW_IPC } from "../src/shared/ipc-contract";

const inboxTitle = vi.hoisted(() => ({
  activate: vi.fn(),
  setContext: null as ((context: unknown) => void) | null,
  invalidateScope: null as (() => void) | null,
  setPresentation: null as ((presentation: unknown) => void) | null,
  update: null as ((count: number | null) => void) | null,
  initial: null as number | null,
}));
vi.mock("../src/main/pilot", () => ({
  initializeDesktopPilot: (
    _getWindow: unknown,
    update: (count: number | null) => void,
    setPresentation: (presentation: unknown) => void,
    setContext: (context: unknown) => void,
    invalidateScope: () => void
  ) => {
    inboxTitle.update = update;
    inboxTitle.setPresentation = setPresentation;
    inboxTitle.setContext = setContext;
    inboxTitle.invalidateScope = invalidateScope;
    update(inboxTitle.initial);
    return {
      activateNotification: inboxTitle.activate,
      auth: {},
      diagnosticsEnabled: false,
      dispose: vi.fn(),
      getSession: vi.fn(() => undefined),
      install: vi.fn(),
      installedTarget: undefined,
      observeWindow: vi.fn(),
      rendererUrl: "http://desktop.localhost:3200/desktop-shell",
      webOrigin: "https://openmeld.ai",
    };
  },
}));

const updaterMock = vi.hoisted(() => ({
  setInstalling: undefined as ((value: boolean) => void) | undefined,
  controller: {
    check: vi.fn<() => Promise<void> | undefined>(() => undefined),
    legacyStatus: vi.fn(async () => ({
      status: "idle" as const,
      checked: false,
      currentVersion: "0.1.1",
      latestVersion: null,
      minimumSupportedVersion: null,
      downloadPageUrl: "https://openmeld.ai/desktop",
      message: null,
      macosArm64: null,
      problem: null,
    })),
    showNative: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/main/update/register-app-updater", () => ({
  registerAppUpdater: vi.fn(
    (input: { setInstalling: (value: boolean) => void }) => {
      updaterMock.setInstalling = input.setInstalling;
      return updaterMock.controller;
    }
  ),
}));

const electronMock = vi.hoisted(() => {
  const desktopVersion = "0.1.0-preview.0";
  const trayInstances: Array<{
    image: unknown;
    on: ReturnType<typeof vi.fn>;
    closeContextMenu: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
    setToolTip: ReturnType<typeof vi.fn>;
  }> = [];
  const windowInstances: Array<{
    center: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    options: Record<string, unknown> | undefined;
    hide: ReturnType<typeof vi.fn>;
    maximize: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
    webContents: {
      mainFrame: { url: string };
      isDestroyed: () => boolean;
      isLoadingMainFrame: ReturnType<typeof vi.fn>;
      once: ReturnType<typeof vi.fn>;
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
      isLoadingMainFrame: vi.fn(() => false),
      once: vi.fn(),
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
    maximize = vi.fn();
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
    closeContextMenu = vi.fn();
    setContextMenu = vi.fn();
    setTitle = vi.fn();
    setToolTip = vi.fn();
    image: unknown;

    constructor(image: unknown) {
      this.image = image;
      trayInstances.push(this);
    }
  }

  class MockMenu extends Array<unknown> {
    on = vi.fn();
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
    buildFromTemplate: vi.fn((template: unknown[]) => {
      const built = new MockMenu();
      built.push(...template);
      return built;
    }),
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
    openExternal: vi.fn(),
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
const originalSystemVersionDescriptor = Object.getOwnPropertyDescriptor(
  process,
  "getSystemVersion"
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
  if (originalSystemVersionDescriptor) {
    Object.defineProperty(
      process,
      "getSystemVersion",
      originalSystemVersionDescriptor
    );
  } else {
    Reflect.deleteProperty(process, "getSystemVersion");
  }
}

function setTestSystemVersion(version: string): void {
  Object.defineProperty(process, "getSystemVersion", {
    configurable: true,
    value: () => version,
  });
}

async function importMain(): Promise<void> {
  await import("../src/main/main");
  await Promise.resolve();
}

beforeEach(() => {
  inboxTitle.activate.mockReset();
  inboxTitle.initial = null;
  inboxTitle.invalidateScope = null;
  inboxTitle.setContext = null;
  inboxTitle.setPresentation = null;
  inboxTitle.update = null;
  vi.resetModules();
  restoreTestPlatform();
  setTestSystemVersion("14.4");
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
  updaterMock.setInstalling = undefined;
  updaterMock.controller.check.mockClear();
  updaterMock.controller.legacyStatus.mockClear();
  updaterMock.controller.showNative.mockClear();
  electronMock.ipcMain.handle.mockClear();
  electronMock.dialog.showErrorBox.mockClear();
  electronMock.dialog.showMessageBox.mockClear();
  electronMock.dialog.showMessageBox.mockResolvedValue({ response: 1 });
  electronMock.shell.openExternal.mockReset();
  electronMock.shell.openExternal.mockResolvedValue(undefined);
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
  it("applies unread counts received before tray creation and updates the native title", async () => {
    setTestPlatform("darwin");
    inboxTitle.initial = 7;
    await importMain();
    const tray = electronMock.trayInstances[0];
    expect(tray?.setTitle).toHaveBeenLastCalledWith("7");
    for (const [count, title] of [
      [100, "99+"],
      [0, ""],
      [3, "3"],
      [null, ""],
    ] as const) {
      inboxTitle.update?.(count);
      expect(tray?.setTitle).toHaveBeenLastCalledWith(title);
    }
  });

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

  it("opens the Desktop window maximized within the current screen", async () => {
    await importMain();

    const window = electronMock.windowInstances.at(0);

    expect(window?.options).toMatchObject({
      width: 1040,
      height: 720,
      minWidth: 960,
      minHeight: 640,
    });
    expect(window?.maximize).toHaveBeenCalledOnce();
  });

  it("applies OpenMeld identity to native app, menu, and window surfaces", async () => {
    setTestPlatform("darwin");

    await importMain();

    const window = electronMock.windowInstances.at(0);
    const applicationMenu = electronMock.Menu.setApplicationMenu.mock.calls.at(
      0
    )?.[0] as Array<{
      label?: string;
      submenu?: Array<{ label?: string }>;
    }>;

    expect(electronMock.app.setName).toHaveBeenCalledWith("OpenMeld");
    expect(electronMock.app.setAboutPanelOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationName: "OpenMeld",
        applicationVersion: electronMock.desktopVersion,
        version: electronMock.desktopVersion,
      })
    );
    expect(electronMock.app.dock.setIcon).toHaveBeenCalledWith(
      electronMock.appIcon
    );
    expect(window?.options).toMatchObject({
      icon: electronMock.appIcon,
      title: "OpenMeld",
    });
    expect(applicationMenu.at(0)).toEqual(
      expect.objectContaining({ label: "OpenMeld" })
    );
    expect(applicationMenu.at(0)?.submenu?.map((item) => item.label)).toEqual(
      expect.arrayContaining(["About OpenMeld", "Settings...", "Quit OpenMeld"])
    );
  });

  it("opens OpenMeld only from the explicit tray menu item", async () => {
    await importMain();

    const tray = electronMock.trayInstances.at(0);

    expect(tray).toBeDefined();
    expect(tray?.on).not.toHaveBeenCalledWith("click", expect.any(Function));

    const menuTemplate = tray?.setContextMenu.mock.calls.at(0)?.[0] as
      | Array<{ label?: string; click?: () => void }>
      | undefined;

    expect((menuTemplate ?? []).flatMap((item) => item.label ?? [])).toEqual(
      expect.arrayContaining(["Open App", "Open Inbox", "Settings…"])
    );
  });

  it("uses the generated OpenMeld logo resource for the menu bar tray icon", async () => {
    setTestPlatform("darwin");
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
    expect(tray?.setTitle).toHaveBeenLastCalledWith("");
  });

  it("restores the window and delivers Settings after its document loads", async () => {
    await importMain();
    const window = electronMock.windowInstances.at(0);
    if (!window) {
      throw new Error("Missing window");
    }
    window.isMinimized.mockReturnValue(true);
    window.webContents.isLoadingMainFrame.mockReturnValue(true);
    trayMenuItem("Settings…")?.click?.();
    expect(window.restore).toHaveBeenCalled();
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.send).not.toHaveBeenCalled();
    const loaded = window.webContents.once.mock.calls.find(
      ([event]) => event === "did-finish-load"
    )?.[1];
    if (!loaded) {
      throw new Error("Missing load listener");
    }
    window.webContents.isLoadingMainFrame.mockReturnValue(false);
    loaded();
    expect(window.webContents.send).toHaveBeenCalledWith(
      WINDOW_IPC.navigateDestination,
      "settings"
    );
  });

  it("opens ordinary external links in the system browser without creating an Electron window", async () => {
    await importMain();

    const window = electronMock.windowInstances.at(0);

    expect(window?.webContents.setWindowOpenHandler).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const windowOpenHandler = window?.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as
      | ((details: { url: string }) => { action: "deny" })
      | undefined;

    expect(
      windowOpenHandler?.({ url: "https://example.com/docs?q=1#section" })
    ).toEqual({ action: "deny" });
    await Promise.resolve();
    expect(electronMock.shell.openExternal).toHaveBeenCalledOnce();
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      "https://example.com/docs?q=1#section"
    );
  });

  it.each([
    "not a URL",
    "javascript:alert(1)",
    "file:///tmp/private",
    "data:text/html,unsafe",
    "https://user:password@example.com/private",
  ])("denies unsafe external link %s", async (url) => {
    await importMain();

    const window = electronMock.windowInstances.at(0);
    const windowOpenHandler = window?.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as
      | ((details: { url: string }) => { action: "deny" })
      | undefined;

    expect(windowOpenHandler?.({ url })).toEqual({ action: "deny" });
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled();
  });

  it("opens a requested internal new-window target as its configured Web equivalent", async () => {
    await importMain();
    const window = electronMock.windowInstances.at(0);
    const windowOpenHandler = window?.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as (details: { url: string }) => { action: "deny" };

    expect(
      windowOpenHandler({
        url: "openmeld-desktop://app/o/team/agents?profileId=agent-%E4%B8%AD#activity",
      })
    ).toEqual({ action: "deny" });
    await Promise.resolve();
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      "https://openmeld.ai/o/team/agents?profileId=agent-%E4%B8%AD#activity"
    );
  });

  it("reports a rejected system-browser handoff without allowing a new window", async () => {
    const failure = new Error("Browser unavailable");
    electronMock.shell.openExternal.mockRejectedValueOnce(failure);
    await importMain();

    const window = electronMock.windowInstances.at(0);
    const windowOpenHandler = window?.webContents.setWindowOpenHandler.mock
      .calls[0]?.[0] as
      | ((details: { url: string }) => { action: "deny" })
      | undefined;

    expect(windowOpenHandler?.({ url: "http://example.com/support" })).toEqual({
      action: "deny",
    });
    await vi.waitFor(() =>
      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        "OpenMeld",
        failure.message
      )
    );
  });

  it("continues blocking renderer-initiated document navigation", async () => {
    await importMain();

    const window = electronMock.windowInstances.at(0);
    expect(window?.webContents.on).toHaveBeenCalledWith(
      "will-navigate",
      expect.any(Function)
    );

    const navigationEvent = { preventDefault: vi.fn() };
    const navigationHandler = window?.webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate"
    )?.[1] as
      | ((event: typeof navigationEvent, url: string) => void)
      | undefined;

    navigationHandler?.(
      navigationEvent,
      "openmeld-desktop://app/o/team/agents?profileId=agent-1#activity"
    );

    expect(navigationEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(window?.webContents.send).toHaveBeenCalledWith(
      WINDOW_IPC.navigateHref,
      "/o/team/agents?profileId=agent-1#activity"
    );
  });

  it("routes an ordinary trusted Web app URL internally but keeps API paths out of Router", async () => {
    await importMain();
    const window = electronMock.windowInstances.at(0);
    const navigationHandler = window?.webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate"
    )?.[1] as
      | ((event: { preventDefault(): void }, url: string) => void)
      | undefined;
    const event = { preventDefault: vi.fn() };

    navigationHandler?.(
      event,
      "https://openmeld.ai/o/team/spaces/space-1?message=signal-1#thread"
    );
    expect(window?.webContents.send).toHaveBeenCalledWith(
      WINDOW_IPC.navigateHref,
      "/o/team/spaces/space-1?message=signal-1#thread"
    );

    navigationHandler?.(event, "openmeld-desktop://app/");
    expect(window?.webContents.send).toHaveBeenLastCalledWith(
      WINDOW_IPC.navigateHref,
      "/"
    );

    navigationHandler?.(
      event,
      "https://openmeld.ai/api/oauth/start?token=secret"
    );
    await Promise.resolve();
    expect(window?.webContents.send).toHaveBeenCalledTimes(2);
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      "https://openmeld.ai/api/oauth/start?token=secret"
    );
  });

  function trayMenuLabels(): string[] {
    return Array.from(trayMenuTemplate() ?? []).flatMap((item) =>
      item.label ? [item.label] : []
    );
  }

  function trayMenuTemplate():
    | Array<{
        accessibilityLabel?: string;
        badge?: { content?: string; type?: string };
        click?: () => void;
        enabled?: boolean;
        icon?: unknown;
        label?: string;
        sublabel?: string;
        type?: string;
      }>
    | undefined {
    const tray = electronMock.trayInstances.at(0);
    return tray?.setContextMenu.mock.calls.at(-1)?.[0] as
      | Array<{
          accessibilityLabel?: string;
          badge?: { content?: string; type?: string };
          click?: () => void;
          enabled?: boolean;
          icon?: unknown;
          label?: string;
          sublabel?: string;
          type?: string;
        }>
      | undefined;
  }

  function trayMenuItem(label: string): { click?: () => void } | undefined {
    return trayMenuTemplate()?.find((item) => item.label === label);
  }

  it("shows the compact product menu without version, Web, or service controls", async () => {
    setTestPlatform("darwin");
    await importMain();

    expect(trayMenuLabels()).toEqual([
      "Loading notifications…",
      "Open Inbox",
      "Open App",
      "Computer",
      "Settings…",
      "Quit OpenMeld",
    ]);
    expect(
      Array.from(trayMenuTemplate() ?? []).map(
        (item) => item.type ?? item.label
      )
    ).toEqual([
      "Loading notifications…",
      "Open Inbox",
      "separator",
      "Open App",
      "Computer",
      "Settings…",
      "separator",
      "Quit OpenMeld",
    ]);
    expect(trayMenuLabels()).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("v0."),
        "Open Web App",
        "Start OpenMeld Service",
        "Stop OpenMeld Service",
      ])
    );
  });

  it("adds native icons to every clickable tray action", async () => {
    setTestPlatform("darwin");

    await importMain();

    const clickableItems = trayMenuTemplate()?.filter((item) => item.click);

    expect(clickableItems).toHaveLength(5);
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

  it("omits the notification row when there is nothing new", async () => {
    setTestPlatform("darwin");
    await importMain();

    inboxTitle.setPresentation?.({ status: "empty" });

    expect(trayMenuLabels()).toEqual([
      "Open Inbox",
      "Open App",
      "Computer",
      "Settings…",
      "Quit OpenMeld",
    ]);
  });

  it("keeps the Computer status on the same native menu row", async () => {
    setTestPlatform("darwin");
    setTestSystemVersion("14.4");
    await importMain();

    inboxTitle.setContext?.({
      computer: { available: true, statusLabel: "Checking…" },
      unreadCount: 0,
    });

    expect(trayMenuItem("Computer")).toEqual(
      expect.objectContaining({
        accessibilityLabel: "Computer, Checking…",
        badge: { type: "none", content: "Checking…" },
      })
    );
  });

  it("keeps Computer status and preview text visible before macOS 14.4", async () => {
    setTestPlatform("darwin");
    setTestSystemVersion("13.6");
    await importMain();
    inboxTitle.setContext?.({
      computer: { available: true, statusLabel: "Connected" },
      unreadCount: 1,
    });
    inboxTitle.setPresentation?.({
      item: {
        contextLabel: "",
        occurredAt: new Date().toISOString(),
        preview: "p".repeat(19),
        reference: {
          itemId: "item-1",
          organizationId: "org-1",
          organizationSlug: "acme",
          userId: "user-1",
        },
        title: "L".repeat(23),
      },
      status: "ready",
    });

    expect(trayMenuItem("Computer — Connected")).toBeTruthy();
    expect(
      trayMenuItem(`${"L".repeat(21)}… · now — ${"p".repeat(17)}…`)
    ).toBeTruthy();
  });

  it("renders and activates one exact unread preview", async () => {
    setTestPlatform("darwin");
    await importMain();
    inboxTitle.setContext?.({
      computer: { available: true, statusLabel: "Connected" },
      unreadCount: 3,
    });
    inboxTitle.setPresentation?.({
      item: {
        contextLabel: "Design review",
        occurredAt: new Date().toISOString(),
        preview: "Please check the latest layout.",
        reference: {
          itemId: "item_1",
          organizationId: "org_1",
          organizationSlug: "acme",
          userId: "user_1",
        },
        title: "Morgan",
      },
      status: "ready",
    });

    const preview = trayMenuTemplate()?.find((item) =>
      item.label?.startsWith("Morgan · Design review ·")
    );
    preview?.click?.();

    expect(inboxTitle.activate).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "item_1" })
    );
    expect(trayMenuItem("Open Inbox")).toEqual(
      expect.objectContaining({ click: expect.any(Function) })
    );
  });

  it("closes an open tray menu immediately when its account scope is invalidated", async () => {
    await importMain();
    const tray = electronMock.trayInstances.at(0);
    const openMenu = tray?.setContextMenu.mock.calls.at(-1)?.[0] as
      | { on: ReturnType<typeof vi.fn> }
      | undefined;
    const willShow = openMenu?.on.mock.calls.find(
      ([event]) => event === "menu-will-show"
    )?.[1] as (() => void) | undefined;

    willShow?.();
    inboxTitle.invalidateScope?.();

    expect(tray?.closeContextMenu).toHaveBeenCalledOnce();
  });

  it("keeps native preview text within its budgets at grapheme boundaries", async () => {
    setTestPlatform("darwin");
    await importMain();
    const cases = [
      {
        name: "short text",
        preview: "Short preview",
        title: "Short title",
        expectedLabel: "Short title · now",
        expectedSublabel: "Short preview",
      },
      {
        name: "exact budgets",
        preview: "p".repeat(32),
        title: "T".repeat(30),
        expectedLabel: `${"T".repeat(30)} · now`,
        expectedSublabel: "p".repeat(32),
      },
      {
        name: "long English text",
        preview: `${"p".repeat(16)}\n${"p".repeat(17)}`,
        title: "T".repeat(31),
        expectedLabel: `${"T".repeat(29)}… · now`,
        expectedSublabel: `${"p".repeat(16)} ${"p".repeat(14)}…`,
      },
      {
        name: "long Chinese text",
        preview: "文".repeat(33),
        title: "标".repeat(31),
        expectedLabel: `${"标".repeat(29)}… · now`,
        expectedSublabel: `${"文".repeat(31)}…`,
      },
      {
        name: "ordinary emoji on the truncation boundary",
        preview: `${"b".repeat(30)}😀x`,
        title: `${"a".repeat(28)}😀x`,
        expectedLabel: `${"a".repeat(28)}… · now`,
        expectedSublabel: `${"b".repeat(30)}…`,
      },
      {
        name: "family emoji crossing the truncation boundary",
        preview: `${"f".repeat(30)}👨‍👩‍👧‍👦x`,
        title: "Family update",
        expectedLabel: "Family update · now",
        expectedSublabel: `${"f".repeat(30)}…`,
      },
    ];

    for (const testCase of cases) {
      inboxTitle.setPresentation?.({
        item: {
          contextLabel: "",
          occurredAt: new Date().toISOString(),
          preview: testCase.preview,
          reference: {
            itemId: `item-${testCase.name}`,
            organizationId: "org-1",
            organizationSlug: "acme",
            userId: "user-1",
          },
          title: testCase.title,
        },
        status: "ready",
      });

      const preview = trayMenuTemplate()?.find(
        (item) => item.sublabel !== undefined
      );
      expect(preview?.label, testCase.name).toBe(testCase.expectedLabel);
      expect(preview?.sublabel, testCase.name).toBe(testCase.expectedSublabel);
      expect(preview?.label?.length, testCase.name).toBeLessThanOrEqual(36);
      expect(preview?.sublabel?.length, testCase.name).toBeLessThanOrEqual(32);
      expect(preview?.sublabel, testCase.name).not.toContain("\n");
    }
  });

  it("quits the desktop app from the tray menu", async () => {
    await importMain();

    const tray = electronMock.trayInstances.at(0);
    const window = electronMock.windowInstances.at(0);
    const menuTemplate = tray?.setContextMenu.mock.calls.at(-1)?.[0] as
      | Array<{ label?: string; click?: () => void }>
      | undefined;
    const quitItem = menuTemplate?.find(
      (item) => item.label === "Quit OpenMeld"
    );

    quitItem?.click?.();

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);
    const close = window?.on.mock.calls.find(
      ([event]) => event === "close"
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;
    const closeEvent = { preventDefault: vi.fn() };
    close?.(closeEvent);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window?.hide).not.toHaveBeenCalled();
  });

  it("restores close-to-hide after a page blocks an ordinary quit", async () => {
    await importMain();

    const window = electronMock.windowInstances.at(0);
    trayMenuItem("Quit OpenMeld")?.click?.();
    const willPreventUnload = window?.webContents.on.mock.calls.find(
      ([event]) => event === "will-prevent-unload"
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;
    const unloadEvent = { preventDefault: vi.fn() };
    willPreventUnload?.(unloadEvent);

    expect(unloadEvent.preventDefault).not.toHaveBeenCalled();

    const close = window?.on.mock.calls.find(
      ([event]) => event === "close"
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;
    const closeEvent = { preventDefault: vi.fn() };
    close?.(closeEvent);

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(window?.hide).toHaveBeenCalledTimes(1);
  });

  it("keeps an accepted updater installation in quitting mode when unload is blocked", async () => {
    await importMain();

    const window = electronMock.windowInstances.at(0);
    updaterMock.setInstalling?.(true);
    const beforeQuit = electronMock.app.on.mock.calls.find(
      ([event]) => event === "before-quit"
    )?.[1] as (() => void) | undefined;
    beforeQuit?.();
    const willPreventUnload = window?.webContents.on.mock.calls.find(
      ([event]) => event === "will-prevent-unload"
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;
    const unloadEvent = { preventDefault: vi.fn() };
    willPreventUnload?.(unloadEvent);

    expect(unloadEvent.preventDefault).not.toHaveBeenCalled();

    const close = window?.on.mock.calls.find(
      ([event]) => event === "close"
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;
    const closeEvent = { preventDefault: vi.fn() };
    close?.(closeEvent);

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window?.hide).not.toHaveBeenCalled();
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
});
