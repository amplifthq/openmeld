import { hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DesktopInboxAttention,
  DesktopUpdaterState,
} from "@openmeld/schemas";
import {
  ArrowClockwiseIcon,
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
import { isDesktopAppHref } from "../shared/navigation";
import { desktopUpdaterPresentation } from "../shared/updater-presentation";
import type { CliProblem, ServiceView } from "../shared/view-types";
import {
  normalizeExternalBrowserUrl,
  resolveDesktopDownloadPageUrl,
  resolveDesktopWebUrl,
} from "./desktop-environment";
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
import {
  createTrayTemplateImage,
  hasTrayUnreadDot,
  trayAttentionTitle,
} from "./tray-image";
import { createDesktopUpdateInboxReporter } from "./update/desktop-update-inbox-reporter";
import { registerAppUpdater } from "./update/register-app-updater";

// Keep the native window at the full Desktop workspace size from launch so the
// app shell never flashes through a compact splash-sized frame.
const APP_WIDTH = 1040;
const APP_HEIGHT = 720;
const APP_MIN_WIDTH = 960;
const APP_MIN_HEIGHT = 640;
const APP_NAME = "OpenMeld";
// These UTF-16 text budgets keep native auto-layout compact without claiming a
// pixel width. Truncation always retreats to a complete grapheme boundary.
const TRAY_PREVIEW_SOURCE_TEXT_BUDGET = 22;
const TRAY_PREVIEW_BODY_TEXT_BUDGET = 32;
const NATIVE_MENU_GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
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
let trayAttention: DesktopInboxAttention | null = null;
let trayContext: DesktopTrayContext | null = null;
let trayMenuOpen = false;
let trayMenuRefreshPending = false;
let trayPresentation: DesktopTrayPresentation = { status: "loading" };
let trayUpdaterState: DesktopUpdaterState | null = null;
const pilot = initializeDesktopPilot(
  () => mainWindow,
  (attention) => {
    trayAttention = attention;
    updateTrayImage();
    updateTrayMenu();
  },
  (presentation) => {
    trayPresentation = presentation;
    updateTrayMenu();
  },
  (context) => {
    trayContext = context;
    updateTrayMenu();
  },
  invalidateOpenTrayMenu
);
let appUpdater: ReturnType<typeof registerAppUpdater> | null = null;
let inboxUpdateReporter:
  | ReturnType<typeof createDesktopUpdateInboxReporter>
  | undefined;

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
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform !== "darwin"
      ? { titleBarOverlay: { height: 38 } }
      : {}),
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
    const browserUrl = resolveBrowserHandoffUrl(url);
    if (browserUrl) {
      openExternalBrowserUrl(browserUrl);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    const href = resolveInAppNavigationHref(url);
    if (href) {
      window.webContents.send(WINDOW_IPC.navigateHref, href);
      return;
    }
    const browserUrl = resolveBrowserHandoffUrl(url);
    if (browserUrl) {
      openExternalBrowserUrl(browserUrl);
    }
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
  try {
    runBackgroundTask(shell.openExternal(normalizeExternalBrowserUrl(value)));
  } catch {
    return;
  }
}

function resolveInAppNavigationHref(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    const origin = `${url.protocol}//${url.host}`;
    if (
      origin !== "openmeld-desktop://app" &&
      (!pilot || url.origin !== pilot.webOrigin)
    ) {
      return null;
    }
    const href = `${url.pathname}${url.search}${url.hash}`;
    return isDesktopAppHref(href) ? href : null;
  } catch {
    return null;
  }
}

function resolveBrowserHandoffUrl(value: string): string | null {
  const appHref = resolveInAppNavigationHref(value);
  if (appHref) {
    try {
      return resolveDesktopWebUrl({
        env: pilot?.installedTarget
          ? installedCommandEnvironment(
              pilot.installedTarget,
              app.getPath("userData")
            ).env
          : process.env,
        path: appHref,
      });
    } catch {
      return null;
    }
  }
  try {
    return normalizeExternalBrowserUrl(value);
  } catch {
    return null;
  }
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
          label: "Open Web App",
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
  updateTrayImage();
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

function invalidateOpenTrayMenu(): void {
  if (!trayMenuOpen) {
    return;
  }
  trayMenuOpen = false;
  trayMenuRefreshPending = false;
  tray?.closeContextMenu();
}

function createTrayMenuTemplate(): MenuItemConstructorOptions[] {
  const preview = trayPreviewMenuItems(trayPresentation);
  const updater = trayUpdaterMenuItems(trayUpdaterState);
  const unreadCount = trayContext?.unreadCount;
  const computer = trayContext?.computer;
  const computerStatus = computer?.statusLabel ?? "Checking…";
  const nativeMenuCapabilities = resolveNativeMenuCapabilities();
  return [
    ...preview,
    trayActionItem({
      icon: "inbox",
      label: "Open Inbox",
      ...(trayAttention || (unreadCount && unreadCount > 0)
        ? {
            sublabel: [
              ...(unreadCount && unreadCount > 0
                ? [`${unreadCount} unread`]
                : []),
              ...(trayAttention?.unreadMentionCount
                ? [
                    `${trayAttention.unreadMentionCount} ${trayAttention.unreadMentionCount === 1 ? "mention" : "mentions"}`,
                  ]
                : []),
              ...(trayAttention?.unresolvedActionCount
                ? [`${trayAttention.unresolvedActionCount} pending`]
                : []),
              ...(trayAttention?.unreadUrgentUpdateCount
                ? [`${trayAttention.unreadUrgentUpdateCount} urgent`]
                : []),
            ].join(" · "),
          }
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
    ...updater,
    { type: "separator" },
    trayActionItem({
      icon: "quit",
      label: "Quit OpenMeld",
      click: quitDesktop,
    }),
  ];
}

function trayUpdaterMenuItems(
  state: DesktopUpdaterState | null
): MenuItemConstructorOptions[] {
  const presentation = desktopUpdaterPresentation(state);
  if (!presentation.attention) {
    return [];
  }
  const label = (() => {
    if (state?.status === "downloading") {
      return "Downloading Update…";
    }
    if (state?.status === "downloaded") {
      return "Restart to Update…";
    }
    if (state?.status === "error") {
      return "Update Needs Attention…";
    }
    return "Update Available…";
  })();
  const nativeMenuCapabilities = resolveNativeMenuCapabilities();
  return [
    trayActionItem({
      icon: "updates",
      label,
      accessibilityLabel: `${presentation.headline}. ${presentation.description}`,
      ...(nativeMenuCapabilities.badge
        ? { badge: { type: "updates" as const, count: 1 } }
        : {}),
      click: () => appUpdater?.showNative().catch(console.error),
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
    const relativeTime = formatRelativeTime(item.occurredAt);
    const headline = `${truncateNativeMenuText(
      source,
      TRAY_PREVIEW_SOURCE_TEXT_BUDGET
    )} · ${relativeTime}`;
    const preview = truncateNativeMenuText(
      item.preview,
      TRAY_PREVIEW_BODY_TEXT_BUDGET
    );
    return [
      { label: "Latest unread", enabled: false },
      {
        // Native labels size the menu to their content. macOS sublabels can
        // wrap independently, so keep the preview in the single-line label.
        label: preview ? `${headline} — ${preview}` : headline,
        accessibilityLabel: `${source} · ${relativeTime} — ${item.preview}`,
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
    no_unread_messages: "No message preview available",
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

type TrayMenuIconName =
  | "computer"
  | "desktop"
  | "inbox"
  | "quit"
  | "settings"
  | "updates";

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
  updates: ArrowClockwiseIcon,
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
  const service = APP_NAME;
  const attention = formatTrayAttentionTooltip(trayAttention);
  return attention ? `${service}\n${attention}` : service;
}

function formatTrayAttentionTooltip(
  attention: DesktopInboxAttention | null
): string | null {
  if (!attention) {
    return null;
  }
  const details = [
    ...(attention.needsActionCount === undefined
      ? []
      : [
          `${attention.needsActionCount} needs action, ${attention.needsReviewCount ?? 0} needs review`,
        ]),
    ...(attention.unresolvedActionCount > 0
      ? [
          `${attention.unresolvedActionCount} pending ${attention.unresolvedActionCount === 1 ? "action or review" : "actions or reviews"}`,
        ]
      : []),
    ...(attention.unreadUrgentUpdateCount > 0
      ? [
          `${attention.unreadUrgentUpdateCount} unread priority ${attention.unreadUrgentUpdateCount === 1 ? "update" : "updates"}`,
        ]
      : []),
    ...(attention.unreadMentionCount > 0
      ? [
          `${attention.unreadMentionCount} unread ${attention.unreadMentionCount === 1 ? "mention" : "mentions"}`,
        ]
      : []),
    ...(attention.ordinaryUnreadCount > 0
      ? [
          `${attention.ordinaryUnreadCount} other unread ${attention.ordinaryUnreadCount === 1 ? "update" : "updates"}`,
        ]
      : []),
  ];
  return details.length > 0
    ? `Inbox - ${details.join(", ")}`
    : "Inbox - All caught up";
}

function resolveNativeMenuCapabilities(): {
  badge: boolean;
} {
  if (
    process.platform !== "darwin" ||
    typeof process.getSystemVersion !== "function"
  ) {
    return { badge: false };
  }
  const [major = 0] = process
    .getSystemVersion()
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return {
    badge: major >= 14,
  };
}

function truncateNativeMenuText(value: string, textBudget: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= textBudget) {
    return normalized;
  }
  if (textBudget <= 0) {
    return "";
  }
  if (textBudget === 1) {
    return "…";
  }

  const contentBudget = textBudget - 1;
  let truncationIndex = 0;
  for (const grapheme of NATIVE_MENU_GRAPHEME_SEGMENTER.segment(normalized)) {
    const nextIndex = grapheme.index + grapheme.segment.length;
    if (nextIndex > contentBudget) {
      break;
    }
    truncationIndex = nextIndex;
  }
  return `${normalized.slice(0, truncationIndex).trimEnd()}…`;
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

function createTrayImage(unread = false) {
  const image = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (process.platform === "darwin" && !image.isEmpty()) {
    return createTrayTemplateImage(image, unread);
  }
  const resizedImage = image.isEmpty()
    ? createAppIcon()
    : image.resize({ height: 18 });
  resizedImage?.setTemplateImage(true);
  return resizedImage ?? nativeImage.createEmpty();
}

function updateTrayImage(): void {
  if (!tray || process.platform !== "darwin") {
    return;
  }
  const title = trayAttentionTitle(trayAttention);
  const unread = hasTrayUnreadDot(trayAttention);
  // Native text keeps counts crisp and accessible; ordinary unread has no title.
  tray.setTitle(title, { fontType: "monospacedDigit" });
  tray.setImage(createTrayImage(unread));
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
      const nativeUpdatesEnabled =
        app.isPackaged &&
        (process.platform === "darwin" || process.platform === "win32") &&
        pilot?.installedTarget?.kind === "production";
      if (nativeUpdatesEnabled && pilot) {
        try {
          const currentPilot = pilot;
          inboxUpdateReporter = createDesktopUpdateInboxReporter({
            userData: app.getPath("userData"),
            lane: "prod",
            deviceName: hostname(),
            platform: process.platform === "win32" ? "win32" : "darwin",
            currentUserId: async () =>
              (await currentPilot.auth.session()).user?.id ?? null,
            send: currentPilot.reportDesktopUpdateObservation,
          });
          currentPilot.setDesktopUpdateAccountListener(
            inboxUpdateReporter.accountChanged
          );
        } catch (error) {
          console.warn("[openmeld.desktop.inbox_update_source_unavailable]", {
            error,
          });
        }
      }
      const updater = registerAppUpdater({
        enabled: nativeUpdatesEnabled,
        inboxSource: inboxUpdateReporter,
        authorize: authorizeRenderer,
        getWindow: () => mainWindow,
        onStateChanged: (state) => {
          trayUpdaterState = state;
          updateTrayMenu();
        },
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
  inboxUpdateReporter?.dispose();
  pilot?.dispose();
  ipcDisposer?.();
  ipcDisposer = null;
  ipcMain.removeHandler(WINDOW_IPC.enterApp);
  ipcMain.removeHandler(WINDOW_IPC.quitDesktop);
});
