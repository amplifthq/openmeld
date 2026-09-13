import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ArrowClockwiseIcon,
  DesktopIcon,
  GearSixIcon,
  GlobeIcon,
  PlayCircleIcon,
  PowerIcon,
  StopCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react/ssr";
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type DesktopWindowDestination,
  WINDOW_IPC,
} from "../shared/ipc-contract";
import type { CliProblem, ServiceView } from "../shared/view-types";
import { resolveDesktopDownloadPageUrl } from "./desktop-environment";
import { createDesktopHandlers, type DesktopHandlers } from "./ipc-handlers";
import { initializeDesktopPilot } from "./pilot";
import { createPilotServiceHandlers } from "./pilot-service";
import { registerOpenMeldIpcHandlers } from "./register-ipc";
import { assertTrustedRenderer } from "./renderer-trust";
import { readDesktopUpdateStatus } from "./update/desktop-update";

// Keep the native window at the full Desktop workspace size from launch so the
// app shell never flashes through a compact splash-sized frame.
const APP_WIDTH = 1040;
const APP_HEIGHT = 720;
const APP_MIN_WIDTH = 960;
const APP_MIN_HEIGHT = 640;
const APP_NAME = "OpenMeld Desktop";
const APP_ICON_PATH = join(import.meta.dirname, "../../resources/icon.png");
const TRAY_ICON_PATH = join(
  import.meta.dirname,
  "../../resources/tray-icon.png"
);
// Matches the OpenMeld dark `--background` so the native window chrome and the
// rendered content read as one continuous surface (no light flash, no seam).
const WINDOW_BACKGROUND = "#111110";
const TRAY_MENU_ICON_COLOR = "#d4d4d4";
const TRAY_MENU_ICON_SIZE = 16;

app.enableSandbox();
app.setName(APP_NAME);

let handlers: DesktopHandlers;
let ipcDisposer: (() => void) | null = null;
let isQuitting = false;
let mainWindow: BrowserWindow | null = null;
const pilot = initializeDesktopPilot(() => mainWindow);
let tray: Tray | null = null;
let latestServiceView: ServiceView | null = null;

type SyncTrayOptions = {
  showProblem: boolean;
};

type ConfirmTrayActionInput = {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
};

function createMainWindow(
  initialDestination?: DesktopWindowDestination
): BrowserWindow {
  const appIcon = createAppIcon();
  const options: BrowserWindowConstructorOptions = {
    width: APP_WIDTH,
    height: APP_HEIGHT,
    minWidth: APP_MIN_WIDTH,
    minHeight: APP_MIN_HEIGHT,
    show: false,
    title: APP_NAME,
    backgroundColor: WINDOW_BACKGROUND,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      ...(pilot ? { session: pilot.getSession() } : {}),
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (appIcon) {
    options.icon = appIcon;
  }

  const window = new BrowserWindow(options);
  pilot?.observeWindow(window.webContents);

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    window.hide();
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  runBackgroundTask(
    loadRenderer(window).then(() => {
      if (initialDestination) {
        sendWindowDestination(window, initialDestination);
      }
    })
  );
  return window;
}

function configureAppIdentity(): void {
  app.setName(APP_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
  });
  // Packaged builds use the bundle's icns, which macOS auto-masks into the
  // rounded dock/Finder icon. Calling setIcon with the square png would override
  // that and show a square dock icon. Dev has no bundled icns, so it still needs
  // setIcon — otherwise the dock shows Electron's default icon.
  if (process.platform === "darwin" && !app.isPackaged) {
    const appIcon = createAppIcon();
    if (appIcon) {
      app.dock?.setIcon(appIcon);
    }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenu()));
}

function createApplicationMenu(): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") {
    template.push({
      label: APP_NAME,
      submenu: [
        { label: `About ${APP_NAME}`, role: "about" },
        { type: "separator" },
        {
          accelerator: "Command+,",
          click: showSettingsWindow,
          label: "Settings...",
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { label: `Hide ${APP_NAME}`, role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          accelerator: "Command+Q",
          click: quitDesktop,
          label: `Quit ${APP_NAME}`,
        },
      ],
    });
  }
  template.push(
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          click: () => runTrayAction(() => handlers.openWeb()),
          label: "Open OpenMeld Web App",
        },
      ],
    }
  );
  if (pilot?.diagnosticsEnabled) {
    template.push({
      label: "Developer",
      submenu: [
        {
          label: "Reopen Developer Tools",
          accelerator: "Alt+CommandOrControl+I",
          click: () => {
            const contents = mainWindow?.webContents;
            if (!contents || contents.isDestroyed()) {
              return;
            }
            // Recreate a closed/minimized inspector without reloading the app.
            contents.closeDevTools();
            contents.openDevTools({ mode: "detach", activate: true });
          },
        },
      ],
    });
  }
  return template;
}

function createAppIcon() {
  const image = nativeImage.createFromPath(APP_ICON_PATH);
  return image.isEmpty() ? undefined : image;
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  await window.loadURL(resolveRendererUrl());
}

function resolveRendererUrl(): string {
  if (pilot) {
    return pilot.rendererUrl;
  }
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL;
  }
  return pathToFileURL(join(import.meta.dirname, "../renderer/index.html"))
    .href;
}

function authorizeRenderer(event: IpcMainInvokeEvent): void {
  assertTrustedRenderer(
    event,
    mainWindow?.webContents ?? null,
    resolveRendererUrl()
  );
}

function showStatusWindow(): void {
  showDesktopWindow();
}

function showSettingsWindow(): void {
  showDesktopWindow("settings");
}

function showDesktopWindow(destination?: DesktopWindowDestination): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow(destination);
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  if (destination) {
    sendWindowDestination(mainWindow, destination);
  }
}

function sendWindowDestination(
  window: BrowserWindow,
  destination: DesktopWindowDestination
): void {
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send(WINDOW_IPC.navigateDestination, destination);
}

function createTray(): Tray {
  const nextTray = new Tray(createTrayImage());
  tray = nextTray;
  updateTrayMenu();
  runBackgroundTask(refreshTrayStatus(), { showError: false });
  return nextTray;
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }
  tray.setToolTip(resolveTrayTooltip());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: resolveTrayStatusLabel(),
        enabled: false,
      },
      {
        label: resolveTrayDesktopVersionLabel(),
        enabled: false,
      },
      { type: "separator" },
      trayActionItem({
        icon: "desktop",
        label: "Open OpenMeld Desktop",
        click: showStatusWindow,
      }),
      trayActionItem({
        icon: "web",
        label: "Open OpenMeld Web App",
        click: () => {
          runTrayAction(() => handlers.openWeb());
        },
      }),
      { type: "separator" },
      trayActionItem({
        icon: "settings",
        label: "Open Settings",
        click: showSettingsWindow,
      }),
      { type: "separator" },
      ...serviceMenuItems(),
      { type: "separator" },
      trayActionItem({
        icon: "quit",
        label: "Quit OpenMeld Desktop",
        click: quitDesktop,
      }),
    ])
  );
}

/**
 * The service controls are binary: a running service only offers Stop (plus
 * Reconnect), a stopped service only offers Start, and a service that isn't
 * installed (or whose status / CLI can't be read) only offers Set Up. This
 * mirrors the GUI's per-state screens — we never show both Start and Stop.
 */
function serviceMenuItems(): MenuItemConstructorOptions[] {
  if (pilot) {
    return [];
  }
  const setupItem: MenuItemConstructorOptions = {
    icon: createTrayMenuIcon("setup"),
    label: resolveSetupComputerLabel(),
    click: () => runServiceTrayAction(() => handlers.setupComputer()),
  };
  const cliMissing = latestServiceView?.problem?.kind === "spawn_failed";
  if (cliMissing) {
    return [setupItem];
  }
  switch (latestServiceView?.lifecycle) {
    case "running":
      return [
        trayActionItem({
          icon: "reconnect",
          label: setupItem.label ?? resolveSetupComputerLabel(),
          click: () =>
            runConfirmedServiceTrayAction(
              {
                title: "Reconnect this computer?",
                message: "Reconnect This Computer",
                detail:
                  "This reruns setup for this Mac and may restart OpenMeld Service. It will not sign you out.",
                confirmLabel: "Reconnect This Computer",
              },
              () => handlers.setupComputer()
            ),
        }),
        trayActionItem({
          icon: "stop",
          label: "Stop OpenMeld Service",
          click: () =>
            runConfirmedServiceTrayAction(
              {
                title: "Stop OpenMeld Service?",
                message: "Stop OpenMeld Service on this Mac",
                detail:
                  "This Mac cannot receive local Wake work until OpenMeld Service is started again.",
                confirmLabel: "Stop OpenMeld Service",
              },
              () => handlers.stopService()
            ),
        }),
      ];
    case "stopped":
      return [
        trayActionItem({
          icon: "start",
          label: "Start OpenMeld Service",
          click: () => runServiceTrayAction(() => handlers.startService()),
        }),
      ];
    default:
      // not_installed / unknown / unread — Set Up is the only safe action.
      return [setupItem];
  }
}

function trayActionItem(
  item: MenuItemConstructorOptions & { icon: TrayMenuIconName }
): MenuItemConstructorOptions {
  const icon = createTrayMenuIcon(item.icon);
  return icon ? { ...item, icon } : { ...item, icon: undefined };
}

type TrayMenuIconName =
  | "desktop"
  | "quit"
  | "reconnect"
  | "settings"
  | "setup"
  | "start"
  | "stop"
  | "web";

type TrayMenuIconComponent = ComponentType<{
  color?: string;
  size?: number;
  weight?: "regular";
}>;

const TRAY_MENU_ICONS = {
  desktop: DesktopIcon,
  quit: PowerIcon,
  reconnect: ArrowClockwiseIcon,
  settings: GearSixIcon,
  setup: WrenchIcon,
  start: PlayCircleIcon,
  stop: StopCircleIcon,
  web: GlobeIcon,
} satisfies Record<TrayMenuIconName, TrayMenuIconComponent>;

function createTrayMenuIcon(name: TrayMenuIconName) {
  if (process.platform !== "darwin") {
    return undefined;
  }
  const Icon = TRAY_MENU_ICONS[name];
  const svg = renderToStaticMarkup(
    createElement(Icon, {
      color: TRAY_MENU_ICON_COLOR,
      size: TRAY_MENU_ICON_SIZE,
      weight: "regular",
    })
  );
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  );
}

function runServiceTrayAction(mutate: () => Promise<ServiceView>): void {
  runTrayAction(async () => {
    syncTrayServiceView(await mutate(), { showProblem: true });
  });
}

function runConfirmedServiceTrayAction(
  confirm: ConfirmTrayActionInput,
  mutate: () => Promise<ServiceView>
): void {
  runTrayAction(async () => {
    if (!(await confirmTrayAction(confirm))) {
      return;
    }
    syncTrayServiceView(await mutate(), { showProblem: true });
  });
}

async function confirmTrayAction(
  input: ConfirmTrayActionInput
): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "warning",
    title: input.title,
    message: input.message,
    detail: input.detail,
    buttons: ["Cancel", input.confirmLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}

async function refreshTrayStatus(): Promise<void> {
  syncTrayServiceView(await handlers.getServiceStatus(), {
    showProblem: false,
  });
}

function syncTrayServiceView(
  view: ServiceView,
  options: SyncTrayOptions
): void {
  latestServiceView = view;
  updateTrayMenu();
  if (options.showProblem && view.problem) {
    showProblem(resolveProblemTitle(view.problem), view.problem);
  }
}

function runTrayAction(action: () => Promise<void>): void {
  runBackgroundTask(action());
}

function runBackgroundTask(
  task: Promise<unknown>,
  options: { showError?: boolean } = {}
): void {
  task.catch((error: unknown) => {
    if (options.showError === false) {
      console.error("[openmeld-desktop.background_task_failed]", error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("OpenMeld Desktop", message);
  });
}

function showProblem(title: string, problem: CliProblem): void {
  const request = problem.requestId
    ? `\n\nRequest ID: ${problem.requestId}`
    : "";
  dialog.showErrorBox(title, `${problem.message}${request}`);
}

function resolveProblemTitle(problem: CliProblem): string {
  if (problem.kind === "spawn_failed") {
    return "OpenMeld Desktop could not find the OpenMeld command-line tool.";
  }
  return "OpenMeld Desktop could not update the service.";
}

function resolveTrayStatusLabel(): string {
  if (latestServiceView?.problem?.kind === "spawn_failed") {
    return "OpenMeld Command-Line Tool: Not Available";
  }
  switch (latestServiceView?.lifecycle) {
    case "running":
      return "OpenMeld Service: Running";
    case "stopped":
      return "OpenMeld Service: Stopped";
    case "not_installed":
      return "OpenMeld Service: Not Installed";
    case "unknown":
      return "OpenMeld Service: Status Unavailable";
    default:
      return "OpenMeld Service: Checking Status";
  }
}

function resolveTrayDesktopVersionLabel(): string {
  return `OpenMeld Desktop: v${app.getVersion()}`;
}

function resolveTrayTooltip(): string {
  return resolveTrayStatusLabel().replace(": ", " - ");
}

function resolveSetupComputerLabel(): string {
  return latestServiceView?.lifecycle === "running"
    ? "Reconnect This Computer"
    : "Set Up This Computer";
}

function quitDesktop(): void {
  isQuitting = true;
  app.quit();
}

function createTrayImage() {
  const image = nativeImage.createFromPath(TRAY_ICON_PATH);
  const resizedImage = image.isEmpty()
    ? createAppIcon()
    : image.resize({ height: 18 });
  resizedImage?.setTemplateImage(true);
  return resizedImage ?? nativeImage.createEmpty();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  app.on("second-instance", showStatusWindow);

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    // Keep the tray app alive. The OpenMeld Service is managed by the OS service
    // manager and is independent of the GUI window lifecycle.
  });

  app.on("activate", showStatusWindow);

  bootstrapApp();
} else {
  quitDesktop();
}

function bootstrapApp(): void {
  runBackgroundTask(
    app.whenReady().then(() => {
      pilot?.install(authorizeRenderer);
      handlers = createDesktopHandlers({
        openExternal: shell.openExternal,
        desktopSettings: {
          getOpenAtLogin: () => app.getLoginItemSettings().openAtLogin,
          setOpenAtLogin: (openAtLogin) => {
            app.setLoginItemSettings({ openAtLogin });
          },
        },
        desktopUpdate: {
          getStatus: () =>
            readDesktopUpdateStatus({
              currentVersion: app.getVersion(),
              env: process.env,
            }),
          openDownloadPage: async () => {
            await shell.openExternal(
              resolveDesktopDownloadPageUrl({ env: process.env })
            );
          },
        },
      });
      configureAppIdentity();
      if (pilot) {
        handlers = createPilotServiceHandlers(handlers, pilot.auth);
      }
      ipcDisposer = registerOpenMeldIpcHandlers(
        createWindowIpcHandlers(handlers),
        authorizeRenderer
      );
      ipcMain.handle(WINDOW_IPC.enterApp, (event) => {
        authorizeRenderer(event);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window && !window.isDestroyed()) {
          window.setSize(APP_WIDTH, APP_HEIGHT, true);
          window.center();
        }
      });
      ipcMain.handle(WINDOW_IPC.quitDesktop, (event) => {
        authorizeRenderer(event);
        quitDesktop();
      });
      createTray();
      showStatusWindow();
    })
  );
}

function createWindowIpcHandlers(
  baseHandlers: DesktopHandlers
): DesktopHandlers {
  return {
    ...baseHandlers,
    async getServiceStatus() {
      const view = await baseHandlers.getServiceStatus();
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async installService() {
      const view = await baseHandlers.installService();
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async installCli() {
      const view = await baseHandlers.installCli();
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async updateService() {
      const view = await baseHandlers.updateService();
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async startService(expectedAccount) {
      const view = await baseHandlers.startService(expectedAccount);
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async stopService(expectedAccount) {
      const view = await baseHandlers.stopService(expectedAccount);
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async upgradeCli() {
      const view = await baseHandlers.upgradeCli();
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async setServiceAutoStart(enabled) {
      const view = await baseHandlers.setServiceAutoStart(enabled);
      syncTrayServiceView(view.service, { showProblem: false });
      return view;
    },
    async setupComputer() {
      const view = await baseHandlers.setupComputer();
      syncTrayServiceView(view, { showProblem: false });
      return view;
    },
    async signOutOnThisMac() {
      const view = await baseHandlers.signOutOnThisMac();
      syncTrayServiceView(view.service, { showProblem: false });
      return view;
    },
  };
}

app.on("will-quit", () => {
  pilot?.dispose();
  ipcDisposer?.();
  ipcDisposer = null;
  ipcMain.removeHandler(WINDOW_IPC.enterApp);
  ipcMain.removeHandler(WINDOW_IPC.quitDesktop);
});
