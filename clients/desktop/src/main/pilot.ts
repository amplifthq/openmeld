import { join, resolve } from "node:path";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_AUTH_SCHEME,
  type DesktopInstalledTarget,
  desktopInstalledTargetSchema,
  desktopPlatformSchema,
} from "@openmeld/schemas";
import {
  app,
  type BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  protocol,
  type Session,
  session,
  type WebContents,
} from "electron";
import { PILOT_IPC } from "../shared/pilot-bridge";
import { createComputerConnection } from "./computer-connection";
import { checkDesktopCompatibility } from "./desktop-compatibility";
import {
  resolveDesktopEnvPreset,
  resolveDesktopWebUrl,
} from "./desktop-environment";
import { installedCommandEnvironment } from "./installed-environment";
import { resolvePilotAssets } from "./pilot-assets";
import { createPilotAuth } from "./pilot-auth";
import { observePilotWindow } from "./pilot-diagnostics";
import { createPilotSpaceStreams } from "./pilot-space-stream";
import { installPilotTransport } from "./pilot-transport";
import {
  configureInstalledUserData,
  configurePilotUserData,
} from "./pilot-user-data";

declare const __OPENMELD_DESKTOP_WEB_BUILD__: string;
declare const __OPENMELD_DESKTOP_PRIVATE_PACKAGE__: boolean;
declare const __OPENMELD_DESKTOP_INSTALLED_TARGET__: DesktopInstalledTarget | null;

export function initializeDesktopPilot(getWindow: () => BrowserWindow | null) {
  const installedTarget = __OPENMELD_DESKTOP_INSTALLED_TARGET__
    ? desktopInstalledTargetSchema.parse(__OPENMELD_DESKTOP_INSTALLED_TARGET__)
    : undefined;
  const sharedAssets = resolvePilotAssets({
    privatePackage: __OPENMELD_DESKTOP_PRIVATE_PACKAGE__,
    resourcesPath: process.resourcesPath,
    webBuild: __OPENMELD_DESKTOP_WEB_BUILD__,
    env: process.env,
    installedTarget,
  });
  if (!installedTarget && process.env.OPENMELD_DESKTOP_PILOT !== "1") {
    return null;
  }
  const installedLane =
    installedTarget?.kind === "production" ? "prod" : "dev-local";
  const lane = installedTarget ? installedLane : resolveDesktopEnvPreset();
  const webOrigin =
    installedTarget?.webOrigin ?? new URL(resolveDesktopWebUrl()).origin;
  const hostname = new URL(webOrigin).hostname;
  if (
    !installedTarget &&
    (lane === "prod" ||
      !(
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".localhost")
      ))
  ) {
    throw new Error(
      "The Desktop pilot requires an aligned local development lane."
    );
  }
  const platform = desktopPlatformSchema.parse({
    platform: "desktop",
    lane,
    webOrigin,
    webBuild: __OPENMELD_DESKTOP_WEB_BUILD__,
    ...(installedTarget ? { installedTarget } : {}),
  });
  let compatibility: Promise<void> | undefined;
  const ensureCompatible = () => {
    if (!installedTarget) {
      return Promise.resolve();
    }
    compatibility ??= checkDesktopCompatibility(webOrigin).catch(
      (error: unknown) => {
        compatibility = undefined;
        throw error;
      }
    );
    return compatibility;
  };
  protocol.registerSchemesAsPrivileged([
    {
      scheme: installedTarget?.authScheme ?? DESKTOP_AUTH_SCHEME,
      privileges: { standard: false, secure: true },
    },
    {
      scheme: "openmeld-desktop",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
  if (installedTarget) {
    configureInstalledUserData(app, installedTarget);
  } else {
    configurePilotUserData(app, process.env);
  }
  const auth = createPilotAuth(
    webOrigin,
    getWindow,
    () => {
      streams.closeAll();
      const owner = getWindow()?.webContents;
      if (owner && !owner.isDestroyed()) {
        owner.send(PILOT_IPC.sessionChanged);
      }
    },
    installedTarget
  );
  const streams = createPilotSpaceStreams({
    webOrigin,
    webBuild: platform.webBuild,
    cookie: auth.cookie,
    installed: Boolean(installedTarget),
    ensureCompatible,
  });
  let transportSession: Session | undefined;
  let disposeTransport: (() => void) | undefined;
  const diagnosticsEnabled =
    !app.isPackaged && process.env.OPENMELD_DESKTOP_DIAGNOSTICS === "1";
  return {
    auth,
    installedTarget,
    diagnosticsEnabled,
    getSession() {
      if (!transportSession) {
        throw new Error("Desktop transport is not installed");
      }
      return transportSession;
    },
    dispose() {
      disposeTransport?.();
    },
    observeWindow(contents: WebContents) {
      if (diagnosticsEnabled) {
        observePilotWindow(contents);
      }
    },
    rendererUrl: `${DESKTOP_APP_ORIGIN}/${sharedAssets ? "desktop-shell" : "pilot.html"}`,
    install(authorize: (event: IpcMainInvokeEvent) => void) {
      transportSession = session.fromPartition(
        "persist:openmeld-desktop-pilot",
        {
          cache: false,
        }
      );
      disposeTransport = installPilotTransport(
        transportSession,
        () => getWindow()?.webContents ?? null,
        {
          assets: sharedAssets
            ? resolve(sharedAssets)
            : join(import.meta.dirname, "../renderer"),
          webOrigin,
          webBuild: platform.webBuild,
          cookie: auth.cookie,
          fetch,
          installed: Boolean(installedTarget),
          cloudRequest: auth.cloudRequest,
          ensureCompatible,
        }
      );
      const handlers = {
        [PILOT_IPC.platform]: () => platform,
        [PILOT_IPC.session]: async () => {
          await ensureCompatible();
          return auth.session();
        },
        [PILOT_IPC.signIn]: () => {
          streams.closeAll();
          return auth.signIn();
        },
        [PILOT_IPC.signOut]: () => {
          streams.closeAll();
          return auth.signOut();
        },
      };
      const connectComputer = createComputerConnection({
        auth,
        commandDeps: installedTarget
          ? installedCommandEnvironment(
              installedTarget,
              app.getPath("userData")
            )
          : { env: process.env, openMeldBin: process.env.OPENMELD_BIN },
        webOrigin,
        webBuild: platform.webBuild,
        installed: Boolean(installedTarget),
        ensureCompatible,
        confirmSwitch: async (previousAccount, nextAccount) => {
          const result = await dialog.showMessageBox({
            type: "warning",
            message: "Switch this computer's account?",
            detail: `This computer is connected as ${previousAccount}. Switching to ${nextAccount} changes the account used by its OpenMeld Service.`,
            buttons: ["Keep current account", "Switch account"],
            defaultId: 0,
            cancelId: 0,
          });
          return result.response === 1;
        },
      });
      ipcMain.handle(PILOT_IPC.connectComputer, (event, request: unknown) => {
        authorize(event);
        return connectComputer(request);
      });
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, (event) => {
          authorize(event);
          return handler();
        });
      }
      const observedOwners = new WeakSet<WebContents>();
      ipcMain.handle(PILOT_IPC.spaceStreamOpen, (event, raw: unknown) => {
        authorize(event);
        const owner = event.sender;
        const frame = event.senderFrame;
        if (!observedOwners.has(owner)) {
          observedOwners.add(owner);
          owner.once("destroyed", streams.closeAll);
          owner.on("did-navigate", streams.closeAll);
          owner.on("render-process-gone", streams.closeAll);
        }
        return streams.open(raw, (value) => {
          if (
            !owner.isDestroyed() &&
            getWindow()?.webContents === owner &&
            owner.mainFrame === frame
          ) {
            owner.send(PILOT_IPC.spaceStreamEvent, value);
          }
        });
      });
      ipcMain.handle(PILOT_IPC.spaceStreamClose, (event, raw: unknown) => {
        authorize(event);
        streams.close(raw);
      });
      ipcMain.handle(PILOT_IPC.spaceStreamPing, (event, raw: unknown) => {
        authorize(event);
        streams.ping(raw);
      });
    },
  };
}
