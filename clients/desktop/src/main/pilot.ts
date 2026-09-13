import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DESKTOP_APP_ORIGIN,
  desktopPlatformSchema,
  desktopWebBuildSchema,
} from "@openmeld/schemas";
import {
  type BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  protocol,
} from "electron";
import { PILOT_IPC } from "../shared/pilot-bridge";
import {
  resolveDesktopEnvPreset,
  resolveDesktopWebUrl,
} from "./desktop-environment";
import { createPilotAuth } from "./pilot-auth";
import { createPilotProtocol } from "./pilot-protocol";

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
      scheme: "openmeld-desktop",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
  const auth = createPilotAuth(webOrigin, getWindow);
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
  return {
    auth,
    rendererUrl: `${DESKTOP_APP_ORIGIN}/${sharedAssets ? "desktop-shell" : "pilot.html"}`,
    install(authorize: (event: IpcMainInvokeEvent) => void) {
      protocol.handle(
        "openmeld-desktop",
        createPilotProtocol({
          assets: sharedAssets
            ? resolve(sharedAssets)
            : join(import.meta.dirname, "../renderer"),
          webOrigin,
          webBuild: platform.webBuild,
          cookie: auth.cookie,
          fetch,
        })
      );
      const handlers = {
        [PILOT_IPC.platform]: () => platform,
        [PILOT_IPC.session]: auth.session,
        [PILOT_IPC.signIn]: auth.signIn,
        [PILOT_IPC.signOut]: auth.signOut,
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, (event) => {
          authorize(event);
          return handler();
        });
      }
    },
  };
}
