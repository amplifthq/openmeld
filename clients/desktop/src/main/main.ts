import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BellIcon,
  DesktopIcon,
  DesktopTowerIcon,
  GearSixIcon,
  PowerIcon,
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
import { installedCommandEnvironment } from "./installed-environment";
import { createDesktopHandlers, type DesktopHandlers } from "./ipc-handlers";
import { initializeDesktopPilot } from "./pilot";
import type {
  DesktopTrayContext,
  DesktopTrayPresentation,
} from "./pilot-notifications";
import { createPilotServiceHandlers } from "./pilot-service";
import { registerOpenMeldIpcHandlers } from "./register-ipc";
import { assertTrustedRenderer } from "./renderer-trust";
import { registerAppUpdater } from "./update/register-app-updater";

// Keep the native window at the full Desktop workspace size from launch so the
// app shell never flashes through a compact splash-sized frame.
const APP_WIDTH = 1040;
const APP_HEIGHT = 720;
const APP_MIN_WIDTH = 960;
const APP_MIN_HEIGHT = 640;
const APP_NAME = "OpenMeld";
const TRAY_PREVIEW_HEADLINE_MAX_LENGTH = 34;
const TRAY_PREVIEW_BODY_MAX_LENGTH = 38;
const TRAY_PREVIEW_FALLBACK_HEADLINE_MAX_LENGTH = 22;
const TRAY_PREVIEW_FALLBACK_BODY_MAX_LENGTH = 18;
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
let quitIntent: "none" | "ordinary" | "updater-install" = "none";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayUnreadTitle = "";
let trayContext: DesktopTrayContext | null = null;
let trayMenuOpen = false;
let trayMenuRefreshPending = false;
let trayPresentation: DesktopTrayPresentation = { status: "loading" };
const pilot = initializeDesktopPilot(
  () => mainWindow,
  (count) => {
    if (process.platform === "darwin") {
      const title = count !== null && count > 0 ? String(count) : "";
      trayUnreadTitle = count !== null && count > 99 ? "99+" : title;
      tray?.setTitle(trayUnreadTitle);
    }
  },
  (presentation) => {
    trayPresentation = presentation;
    updateTrayMenu();
  },
  (context) => {
    trayContext = context;
    updateTrayMenu();
  }
);
let appUpdater: ReturnType<typeof registerAppUpdater> | null = null;

type SyncTrayOptions = {
  showProblem: boolean;
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
  window.maximize();
  pilot?.observeWindow(window.webContents);

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalBrowserUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.on("will-prevent-unload", () => {
    if (quitIntent === "ordinary") {
      quitIntent = "none";
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("close", (event) => {
    if (quitIntent !== "none") {
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

function openExternalBrowserUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return;
  }
  runBackgroundTask(shell.openExternal(url.href), { showError: false });
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
        {
          label: "Check for Updates…",
          click: () => {
            appUpdater?.showNative().catch(console.error);
          },
        },
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
          label: "Open web app",
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
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once("did-finish-load", () =>
      sendWindowDestination(window, destination)
    );
    return;
  }
  window.webContents.send(WINDOW_IPC.navigateDestination, destination);
}

function createTray(): Tray {
  const nextTray = new Tray(createTrayImage());
  tray = nextTray;
  if (process.platform === "darwin") {
    nextTray.setTitle(trayUnreadTitle);
  }
  updateTrayMenu();
  runBackgroundTask(refreshTrayStatus(), { showError: false });
  return nextTray;
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }
  if (trayMenuOpen) {
    trayMenuRefreshPending = true;
    return;
  }
  tray.setToolTip(resolveTrayTooltip());
  const menu = Menu.buildFromTemplate(createTrayMenuTemplate());
  if ("on" in menu && typeof menu.on === "function") {
    menu.on("menu-will-show", () => {
      trayMenuOpen = true;
    });
    menu.on("menu-will-close", () => {
      trayMenuOpen = false;
      if (trayMenuRefreshPending) {
        trayMenuRefreshPending = false;
        updateTrayMenu();
      }
    });
  }
  tray.setContextMenu(menu);
}

function createTrayMenuTemplate(): MenuItemConstructorOptions[] {
  const preview = trayPreviewMenuItems(trayPresentation);
  const unreadCount = trayContext?.unreadCount;
  const computer = trayContext?.computer;
  const computerStatus = computer?.statusLabel ?? "Checking…";
  const nativeMenuCapabilities = resolveNativeMenuCapabilities();
  return [
    ...preview,
    trayActionItem({
      icon: "inbox",
      label: "Open Inbox",
      ...(unreadCount && unreadCount > 0
        ? { sublabel: `${unreadCount} unread` }
        : {}),
      click: () => showDesktopWindow("inbox"),
    }),
    { type: "separator" },
    trayActionItem({
      icon: "desktop",
      label: "Open App",
      click: showStatusWindow,
    }),
    trayActionItem({
      icon: "computer",
      label: nativeMenuCapabilities.badge
        ? "Computer"
        : `Computer — ${computerStatus}`,
      accessibilityLabel: `Computer, ${computerStatus}`,
      ...(nativeMenuCapabilities.badge
        ? { badge: { type: "none" as const, content: computerStatus } }
        : {}),
      enabled: computer?.available ?? Boolean(pilot),
      click: () => showDesktopWindow("computer"),
    }),
    trayActionItem({
      icon: "settings",
      label: "Settings…",
      click: showSettingsWindow,
    }),
    { type: "separator" },
    trayActionItem({
      icon: "quit",
      label: "Quit OpenMeld",
      click: quitDesktop,
    }),
  ];
}

function trayPreviewMenuItems(
  presentation: DesktopTrayPresentation
): MenuItemConstructorOptions[] {
  if (presentation.status === "ready") {
    const item = presentation.item;
    const reference = item.reference;
    const source = item.contextLabel
      ? `${item.title} · ${item.contextLabel}`
      : item.title;
    const headline = `${truncateNativeMenuText(
      source,
      TRAY_PREVIEW_HEADLINE_MAX_LENGTH
    )} · ${formatRelativeTime(item.occurredAt)}`;
    const preview = truncateNativeMenuText(
      item.preview,
      TRAY_PREVIEW_BODY_MAX_LENGTH
    );
    const supportsSublabel = resolveNativeMenuCapabilities().sublabel;
    return [
      { label: "Latest unread", enabled: false },
      {
        label: supportsSublabel
          ? headline
          : `${truncateNativeMenuText(
              headline,
              TRAY_PREVIEW_FALLBACK_HEADLINE_MAX_LENGTH
            )} — ${truncateNativeMenuText(
              item.preview,
              TRAY_PREVIEW_FALLBACK_BODY_MAX_LENGTH
            )}`,
        ...(supportsSublabel ? { sublabel: preview } : {}),
        toolTip: item.preview,
        click: () => {
          showDesktopWindow();
          runBackgroundTask(
            pilot?.activateNotification(reference) ?? Promise.resolve()
          );
        },
      },
    ];
  }
  if (presentation.status === "empty") {
    return [];
  }
  const label = {
    loading: "Loading notifications…",
    no_unread_messages: "No unread messages",
    signed_out: "Sign in to view notifications",
    unavailable: "Notifications unavailable",
  }[presentation.status];
  return [{ label, enabled: false }];
}

function trayActionItem(
  item: MenuItemConstructorOptions & { icon: TrayMenuIconName }
): MenuItemConstructorOptions {
  const icon = createTrayMenuIcon(item.icon);
  return icon ? { ...item, icon } : { ...item, icon: undefined };
}

type TrayMenuIconName = "computer" | "desktop" | "inbox" | "quit" | "settings";

type TrayMenuIconComponent = ComponentType<{
  color?: string;
  size?: number;
  weight?: "regular";
}>;

const TRAY_MENU_ICONS = {
  computer: DesktopTowerIcon,
  desktop: DesktopIcon,
  inbox: BellIcon,
  quit: PowerIcon,
  settings: GearSixIcon,
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

async function refreshTrayStatus(): Promise<void> {
  syncTrayServiceView(await handlers.getServiceStatus(), {
    showProblem: false,
  });
}

function syncTrayServiceView(
  view: ServiceView,
  options: SyncTrayOptions
): void {
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
    dialog.showErrorBox(APP_NAME, message);
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
    return "OpenMeld could not find the OpenMeld command-line tool.";
  }
  return "OpenMeld could not update the service.";
}

function resolveTrayTooltip(): string {
  return APP_NAME;
}

function resolveNativeMenuCapabilities(): {
  badge: boolean;
  sublabel: boolean;
} {
  if (
    process.platform !== "darwin" ||
    typeof process.getSystemVersion !== "function"
  ) {
    return { badge: false, sublabel: false };
  }
  const [major = 0, minor = 0] = process
    .getSystemVersion()
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return {
    badge: major >= 14,
    sublabel: major > 14 || (major === 14 && minor >= 4),
  };
}

function truncateNativeMenuText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatRelativeTime(value: string): string {
  const occurredAt = Date.parse(value);
  if (!Number.isFinite(occurredAt)) {
    return "now";
  }
  const elapsedMs = Math.max(0, Date.now() - occurredAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

function quitDesktop(): void {
  if (quitIntent !== "updater-install") {
    quitIntent = "ordinary";
  }
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
    if (quitIntent !== "updater-install") {
      quitIntent = "ordinary";
    }
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
      const updater = registerAppUpdater({
        enabled:
          app.isPackaged &&
          process.platform === "darwin" &&
          pilot?.installedTarget?.kind === "production",
        authorize: authorizeRenderer,
        getWindow: () => mainWindow,
        setInstalling: (value) => {
          quitIntent = value ? "updater-install" : "none";
        },
      });
      appUpdater = updater;
      const commandDeps = pilot?.installedTarget
        ? installedCommandEnvironment(
            pilot.installedTarget,
            app.getPath("userData")
          )
        : undefined;
      handlers = createDesktopHandlers({
        commandDeps,
        openExternal: shell.openExternal,
        desktopSettings: {
          getOpenAtLogin: () => app.getLoginItemSettings().openAtLogin,
          setOpenAtLogin: (openAtLogin) => {
            app.setLoginItemSettings({ openAtLogin });
          },
        },
        desktopUpdate: {
          getStatus: updater.legacyStatus,
          openDownloadPage: async () => {
            await shell.openExternal(
              resolveDesktopDownloadPageUrl({
                env: commandDeps?.env ?? process.env,
              })
            );
          },
        },
      });
      configureAppIdentity();
      if (pilot) {
        handlers = createPilotServiceHandlers(
          handlers,
          pilot.auth,
          commandDeps
        );
      }
      ipcDisposer = registerOpenMeldIpcHandlers(
        createWindowIpcHandlers(handlers),
        authorizeRenderer
      );
      ipcMain.handle(WINDOW_IPC.enterApp, (event) => {
        authorizeRenderer(event);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window && !window.isDestroyed()) {
          window.maximize();
        }
      });
      ipcMain.handle(WINDOW_IPC.quitDesktop, (event) => {
        authorizeRenderer(event);
        quitDesktop();
      });
      createTray();
      showStatusWindow();
      appUpdater.check()?.catch(console.error);
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
