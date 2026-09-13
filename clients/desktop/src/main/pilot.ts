import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_AUTH_SCHEME,
  desktopPlatformSchema,
  desktopWebBuildSchema,
} from "@openmeld/schemas";
import {
  app,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  protocol,
  type Session,
  session,
  type WebContents,
} from "electron";
import { PILOT_IPC } from "../shared/pilot-bridge";
import {
  resolveDesktopEnvPreset,
  resolveDesktopWebUrl,
} from "./desktop-environment";
import { createPilotAuth } from "./pilot-auth";
import { observePilotWindow } from "./pilot-diagnostics";
import { createPilotSpaceStreams } from "./pilot-space-stream";
import { installPilotTransport } from "./pilot-transport";
import { configurePilotUserData } from "./pilot-user-data";

declare const __OPENMELD_DESKTOP_WEB_BUILD__: string;

export function initializeDesktopPilot(getWindow: () => BrowserWindow | null) {
  if (process.env.OPENMELD_DESKTOP_PILOT !== "1") {
    return null;
  }
  const lane = resolveDesktopEnvPreset();
  const webOrigin = new URL(resolveDesktopWebUrl()).origin;
  const hostname = new URL(webOrigin).hostname;
  if (
    lane === "prod" ||
    !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost")
    )
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
  });
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_AUTH_SCHEME,
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
  configurePilotUserData(app, process.env);
  const auth = createPilotAuth(webOrigin, getWindow, () => {
    streams.closeAll();
    const owner = getWindow()?.webContents;
    if (owner && !owner.isDestroyed()) {
      owner.send(PILOT_IPC.sessionChanged);
    }
  });
  const streams = createPilotSpaceStreams({
    webOrigin,
    webBuild: platform.webBuild,
    cookie: auth.cookie,
  });
  const sharedAssets = process.env.OPENMELD_DESKTOP_RENDERER_DIR;
  if (sharedAssets) {
    const rendererBuild = desktopWebBuildSchema.parse(
      JSON.parse(
        readFileSync(resolve(sharedAssets, "desktop-build.json"), "utf8")
      )
    );
    if (rendererBuild.webBuild !== platform.webBuild) {
      throw new Error(
        "Desktop page files do not match this native build. Rebuild both from the same source."
      );
    }
  }
  let transportSession: Session | undefined;
  let disposeTransport: (() => void) | undefined;
  const diagnosticsEnabled =
    !app.isPackaged && process.env.OPENMELD_DESKTOP_DIAGNOSTICS === "1";
  return {
    auth,
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
      transportSession = session.fromPartition("openmeld-desktop-pilot", {
        cache: false,
      });
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
        }
      );
      const handlers = {
        [PILOT_IPC.platform]: () => platform,
        [PILOT_IPC.session]: auth.session,
        [PILOT_IPC.signIn]: () => {
          streams.closeAll();
          return auth.signIn();
        },
        [PILOT_IPC.signOut]: () => {
          streams.closeAll();
          return auth.signOut();
        },
      };
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
        streams.open(raw, (value) => {
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
