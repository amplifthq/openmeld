import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type DesktopUpdaterState,
  desktopUpdaterActionSchema,
  desktopUpdaterRestartReplySchema,
} from "@openmeld/schemas";
import {
  app,
  type BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
} from "electron";
import { PILOT_IPC } from "../../shared/pilot-bridge";
import { desktopUpdaterPresentation } from "../../shared/updater-presentation";
import type { DesktopUpdateView } from "../../shared/view-types";
import { createAppUpdater } from "./app-updater";
import { readMacAppBundlePath } from "./mac-bundle-path";
import { installRenamedMacBundle } from "./mac-update-install";
import { createNativeDesktopUpdater } from "./native-updater";

function readNativeUpdater(enabled: boolean) {
  if (!enabled) {
    return null;
  }
  try {
    return createNativeDesktopUpdater({ resourcesPath: process.resourcesPath });
  } catch (error) {
    console.warn("[desktop.update_configuration_unavailable]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

export function registerAppUpdater(input: {
  enabled: boolean;
  inboxSource?: {
    identity: Pick<DesktopUpdaterState, "installationId" | "lane">;
    observe: (state: DesktopUpdaterState) => Promise<void>;
  };
  authorize: (event: IpcMainInvokeEvent) => void;
  getWindow: () => BrowserWindow | null;
  setInstalling: (value: boolean) => void;
}) {
  const unavailable: DesktopUpdaterState = {
    status: "unavailable",
    currentVersion: app.getVersion(),
    version: null,
    percent: null,
    errorStage: null,
  };
  let pending: {
    requestId: string;
    complete: (saved: boolean) => void;
  } | null = null;
  const withIdentity = (state: DesktopUpdaterState): DesktopUpdaterState => ({
    ...state,
    ...input.inboxSource?.identity,
  });
  const observe = (state: DesktopUpdaterState) => {
    try {
      input.inboxSource
        ?.observe(state)
        .catch((error: unknown) =>
          console.warn("[openmeld.desktop.inbox_observer_failed]", { error })
        );
    } catch (error) {
      console.warn("[openmeld.desktop.inbox_observer_failed]", { error });
    }
  };
  const native = readNativeUpdater(input.enabled);
  const controller = native
    ? createAppUpdater({
        ...native,
        currentVersion: app.getVersion(),
        currentAppBundle: readMacAppBundlePath(app.getPath("exe")),
        installRenamedMacBundle,
        installReceiptPath: join(
          app.getPath("userData"),
          "desktop-update-install-receipt.txt"
        ),
        quitApp: () => {
          app.quit();
        },
        processId: process.pid,
        setInstalling: input.setInstalling,
        publish: (state) => {
          input
            .getWindow()
            ?.webContents.send(PILOT_IPC.updaterChanged, withIdentity(state));
          observe(state);
        },
        prepareRestart: () =>
          new Promise<boolean>((resolve) => {
            const window = input.getWindow();
            if (
              !window ||
              window.isDestroyed() ||
              window.webContents.isDestroyed()
            ) {
              resolve(false);
              return;
            }
            const requestId = randomUUID();
            const timeout = setTimeout(() => complete(false), 10_000);
            const complete = (saved: boolean) => {
              clearTimeout(timeout);
              pending = null;
              resolve(saved);
            };
            pending = { requestId, complete };
            window.webContents.send(PILOT_IPC.updaterPrepare, { requestId });
          }),
      })
    : null;
  ipcMain.handle(PILOT_IPC.updaterState, (event) => {
    input.authorize(event);
    return withIdentity(controller?.snapshot() ?? unavailable);
  });
  ipcMain.handle(PILOT_IPC.updaterAction, (event, value: unknown) => {
    input.authorize(event);
    const action = desktopUpdaterActionSchema.parse(value);
    return controller?.act(action);
  });
  ipcMain.handle(PILOT_IPC.updaterPrepared, (event, value: unknown) => {
    input.authorize(event);
    const reply = desktopUpdaterRestartReplySchema.parse(value);
    if (pending?.requestId === reply.requestId) {
      pending.complete(reply.saved);
    }
  });
  let menuOpen = false;
  if (controller) {
    observe(controller.snapshot());
    setInterval(
      () => {
        controller.act("check").catch(console.error);
      },
      6 * 60 * 60 * 1000
    ).unref();
  }
  return {
    async legacyStatus(): Promise<DesktopUpdateView> {
      await controller?.act("check");
      const state = controller?.snapshot() ?? unavailable;
      return {
        status: state.version ? "available" : "idle",
        checked: state.status !== "unavailable" && state.status !== "error",
        currentVersion: state.currentVersion,
        latestVersion: state.version,
        minimumSupportedVersion: null,
        downloadPageUrl: "https://openmeld.ai/desktop",
        message: null,
        macosArm64: null,
        problem:
          state.status === "error"
            ? {
                code: `desktop_update.${state.errorStage}_failed`,
                message: desktopUpdaterPresentation(state).message,
              }
            : null,
      };
    },
    check: () => controller?.act("check"),
    async showNative() {
      if (menuOpen) {
        return;
      }
      menuOpen = true;
      try {
        await controller?.act("check");
        const state = controller?.snapshot() ?? unavailable;
        const { message, action, label } = desktopUpdaterPresentation(state);
        const actionable = action && action !== "check";
        const result = await dialog.showMessageBox({
          type: "info",
          message,
          buttons: actionable ? [label ?? "Update", "Later"] : ["OK"],
          cancelId: actionable ? 1 : 0,
          defaultId: 0,
        });
        if (result.response === 0 && actionable) {
          await controller?.act(action);
        }
      } finally {
        menuOpen = false;
      }
    },
  };
}
