import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_UPDATE_OBSERVATION_PATH,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopComputerConnectionProgress,
  type DesktopComputerDisconnectResult,
  type DesktopComputerOperation,
  type DesktopInboxAttention,
  type DesktopInstalledTarget,
  desktopAuthIdentity,
  desktopComputerConnectionRequestSchema,
  desktopComputerDisconnectRequestSchema,
  desktopInstalledTargetSchema,
  desktopPlatformSchema,
  desktopUpdateObservationResponseSchema,
  desktopUpdateObservationSchema,
} from "@openmeld/schemas";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  protocol,
  type Session,
  session,
  type WebContents,
} from "electron";
import { PILOT_IPC } from "../shared/pilot-bridge";
import {
  createComputerConnection,
  createComputerDisconnection,
} from "./computer-connection";
import { checkDesktopCompatibility } from "./desktop-compatibility";
import {
  resolveDesktopEnvPreset,
  resolveDesktopWebUrl,
} from "./desktop-environment";
import { applyDesktopDevelopmentContext } from "./development-context";
import { installedCommandEnvironment } from "./installed-environment";
import {
  createLocalComputerReader,
  createLocalServiceAuthenticationReader,
} from "./local-computer";
import { createPilotAccountStreams } from "./pilot-account-stream";
import { resolvePilotAssets } from "./pilot-assets";
import { createPilotAuth } from "./pilot-auth";
import { observePilotWindow } from "./pilot-diagnostics";
import { createPilotNotifications } from "./pilot-notifications";
import { createPilotSpaceStreams } from "./pilot-space-stream";
import { installPilotTransport } from "./pilot-transport";
import {
  configureDesktopCredentialStorage,
  configureInstalledUserData,
  configurePilotUserData,
} from "./pilot-user-data";
import { createTransportDiagnostics } from "./transport-diagnostics";

declare const __OPENMELD_DESKTOP_WEB_BUILD__: string;
declare const __OPENMELD_DESKTOP_DEVELOPMENT_CONTEXT__: unknown;
declare const __OPENMELD_DESKTOP_PRIVATE_PACKAGE__: boolean;
declare const __OPENMELD_DESKTOP_INSTALLED_TARGET__: DesktopInstalledTarget | null;
const developmentContext =
  typeof __OPENMELD_DESKTOP_DEVELOPMENT_CONTEXT__ === "undefined"
    ? null
    : __OPENMELD_DESKTOP_DEVELOPMENT_CONTEXT__;

export function initializeDesktopPilot(
  getWindow: () => BrowserWindow | null,
  setInboxAttention: (attention: DesktopInboxAttention | null) => void,
  setTrayPresentation?: Parameters<
    typeof createPilotNotifications
  >[0]["setTrayPresentation"],
  setTrayContext?: Parameters<
    typeof createPilotNotifications
  >[0]["setTrayContext"],
  invalidateTrayScope?: Parameters<
    typeof createPilotNotifications
  >[0]["invalidateTrayScope"]
) {
  const installedTarget = __OPENMELD_DESKTOP_INSTALLED_TARGET__
    ? desktopInstalledTargetSchema.parse(__OPENMELD_DESKTOP_INSTALLED_TARGET__)
    : undefined;
  if (!installedTarget) {
    applyDesktopDevelopmentContext(developmentContext, process.env);
  }
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
      scheme:
        installedTarget?.authScheme ??
        desktopAuthIdentity(false, undefined, webOrigin).authScheme,
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
  configureDesktopCredentialStorage(app, {
    installed: Boolean(installedTarget),
    lane,
    platform: process.platform,
    webOrigin,
  });
  let sessionRevision = 0;
  const transportDiagnostics = createTransportDiagnostics({
    directory: join(app.getPath("userData"), "diagnostics"),
    version: app.getVersion(),
    webBuild: platform.webBuild,
  });
  let desktopUpdateAccountChanged: (() => void) | null = null;
  const auth = createPilotAuth(
    webOrigin,
    getWindow,
    () => {
      sessionRevision += 1;
      desktopUpdateAccountChanged?.();
      streams.closeAll();
      accountStreams.closeAll();
      notifications.clear();
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
    observe: transportDiagnostics.record,
  });
  const accountStreams = createPilotAccountStreams({
    webOrigin,
    webBuild: platform.webBuild,
    cookie: auth.cookie,
    installed: Boolean(installedTarget),
    ensureCompatible,
  });
  const commandDeps = installedTarget
    ? installedCommandEnvironment(installedTarget, app.getPath("userData"))
    : { env: process.env, openMeldBin: process.env.OPENMELD_BIN };
  const notifications = createPilotNotifications({
    auth,
    setInboxAttention,
    setTrayPresentation,
    setTrayContext,
    invalidateTrayScope,
    webOrigin,
    getWindow,
    webBuild: platform.webBuild,
    installed: Boolean(installedTarget),
    ensureCompatible,
    readLocalServiceAuthenticationRequired:
      createLocalServiceAuthenticationReader(auth, commandDeps),
  });
  const readLocalComputer = createLocalComputerReader(auth, commandDeps);
  let transportSession: Session | undefined;
  let disposeTransport: (() => void) | undefined;
  let notificationPoll: ReturnType<typeof setInterval> | undefined;
  const diagnosticsEnabled =
    (!app.isPackaged || Boolean(developmentContext)) &&
    !installedTarget &&
    process.env.OPENMELD_DESKTOP_DIAGNOSTICS === "1";
  return {
    activateNotification: notifications.activate,
    setDesktopUpdateAccountListener(listener: () => void) {
      desktopUpdateAccountChanged = listener;
    },
    async reportDesktopUpdateObservation(
      raw: import("@openmeld/schemas/types").DesktopUpdateObservation
    ) {
      const observation = desktopUpdateObservationSchema.parse(raw);
      await ensureCompatible();
      const response = await auth.cloudRequest(
        DESKTOP_UPDATE_OBSERVATION_PATH,
        {
          method: "PUT",
          headers: new Headers({
            "content-type": "application/json",
            origin: DESKTOP_APP_ORIGIN,
            [installedTarget
              ? DESKTOP_CONTRACT_HEADER
              : DESKTOP_WEB_BUILD_HEADER]: installedTarget
              ? DESKTOP_CONTRACT_VERSION
              : platform.webBuild,
          }),
          body: new TextEncoder().encode(JSON.stringify(observation)).buffer,
        }
      );
      if (!response.ok) {
        throw new Error(`Desktop observation rejected (${response.status})`);
      }
      return desktopUpdateObservationResponseSchema.parse(
        await response.json()
      );
    },
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
      desktopUpdateAccountChanged = null;
      clearInterval(notificationPoll);
      notifications.clear();
      disposeTransport?.();
    },
    observeWindow(contents: WebContents) {
      BrowserWindow.fromWebContents(contents)?.on(
        "focus",
        notifications.refreshVisibility
      );
      if (diagnosticsEnabled) {
        observePilotWindow(contents);
      }
    },
    rendererUrl: `${DESKTOP_APP_ORIGIN}/${sharedAssets ? "desktop-shell" : "pilot.html"}`,
    webOrigin,
    install(authorize: (event: IpcMainInvokeEvent) => void) {
      // Preserve the Inbox feed cadence without changing document visibility.
      notificationPoll = setInterval(() => {
        const owner = getWindow()?.webContents;
        if (owner && !owner.isDestroyed()) {
          owner.send(PILOT_IPC.notificationPoll);
        }
      }, 10_000);
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
          sessionGeneration: auth.sessionGeneration,
          fetch,
          installed: Boolean(installedTarget),
          cloudRequest: auth.cloudRequest,
          readLocalComputer,
          ensureCompatible,
          observe: transportDiagnostics.record,
        }
      );
      let latestConnectionProgress: DesktopComputerConnectionProgress | null =
        null;
      let latestConnectionOperation: DesktopComputerOperation | null = null;
      // Clearing presentation on sign-out does not cancel accepted native work.
      // Keep the same IPC owner exclusive until that work actually settles.
      let computerMutationPending = false;
      const publishConnectionOperation = (
        operation: DesktopComputerOperation | null
      ) => {
        latestConnectionOperation = operation;
        if (!operation) {
          return;
        }
        const owner = getWindow()?.webContents;
        if (owner && !owner.isDestroyed()) {
          try {
            owner.send(PILOT_IPC.connectionOperation, operation);
          } catch {
            // Losing a renderer does not cancel the operation it was observing.
          }
        }
      };
      const readLatestConnectionProgress = () => latestConnectionProgress;
      const handlers = {
        [PILOT_IPC.platform]: () => platform,
        [PILOT_IPC.localComputer]: readLocalComputer,
        [PILOT_IPC.session]: async () => {
          await ensureCompatible();
          return auth.session();
        },
        [PILOT_IPC.signIn]: () => {
          latestConnectionProgress = null;
          latestConnectionOperation = null;
          notifications.clear();
          streams.closeAll();
          accountStreams.closeAll();
          return auth.signIn();
        },
        [PILOT_IPC.signOut]: () => {
          latestConnectionProgress = null;
          latestConnectionOperation = null;
          notifications.clear();
          streams.closeAll();
          accountStreams.closeAll();
          return auth.signOut();
        },
      };
      const connectComputer = createComputerConnection({
        auth,
        sessionRevision: () => sessionRevision,
        commandDeps,
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
        onProgress: (progress) => {
          if (
            !latestConnectionOperation ||
            "kind" in latestConnectionOperation ||
            latestConnectionOperation.status !== "pending" ||
            latestConnectionOperation.request.expectedAccount !==
              progress.expectedAccount ||
            (latestConnectionOperation.progress &&
              (latestConnectionOperation.progress.operationId !==
                progress.operationId ||
                latestConnectionOperation.progress.sequence >=
                  progress.sequence))
          ) {
            return;
          }
          latestConnectionProgress = progress;
          publishConnectionOperation({
            ...latestConnectionOperation,
            progress,
          });
          const owner = getWindow()?.webContents;
          if (owner && !owner.isDestroyed()) {
            owner.send(PILOT_IPC.connectionProgress, progress);
          }
        },
      });
      const disconnectComputer = createComputerDisconnection({
        auth,
        commandDeps,
        sessionRevision: () => sessionRevision,
        onPhase: (phase) => {
          if (
            latestConnectionOperation &&
            "kind" in latestConnectionOperation &&
            latestConnectionOperation.status === "pending"
          ) {
            publishConnectionOperation({ ...latestConnectionOperation, phase });
          }
        },
        confirmDisconnect: async () => {
          const result = await dialog.showMessageBox({
            type: "warning",
            message: "Disconnect this Mac?",
            detail:
              "OpenMeld will finish active work, stop its Service, and sign this Mac out. The computer record stays in your account. Desktop stays signed in.",
            buttons: ["Cancel", "Disconnect this Mac"],
            defaultId: 0,
            cancelId: 0,
          });
          return result.response === 1;
        },
      });
      const handleDisconnect = async (
        event: IpcMainInvokeEvent,
        request: unknown
      ): Promise<DesktopComputerDisconnectResult> => {
        authorize(event);
        const intent = desktopComputerDisconnectRequestSchema.parse(request);
        if (computerMutationPending) {
          throw new Error(
            "A computer connection operation is already in progress."
          );
        }
        computerMutationPending = true;
        const operationId = randomUUID();
        latestConnectionProgress = null;
        // Replace retained connect success in its existing owner, not in a page
        // cache. Reopening the page cannot replay it after Disconnect.
        publishConnectionOperation({
          kind: "disconnect",
          operationId,
          request: intent,
          status: "pending",
          phase: "checking",
          result: null,
        });
        let result: DesktopComputerDisconnectResult;
        try {
          result = await disconnectComputer(intent);
        } catch {
          result = {
            status: "unconfirmed",
            code: "desktop.disconnect.unconfirmed",
            message:
              "Disconnect may have been accepted, but its final result could not be confirmed. Check the connection before trying again.",
          };
        } finally {
          computerMutationPending = false;
        }
        if (result.status !== "cancelled" && result.status !== "disconnected") {
          result = { ...result, diagnosticId: operationId };
        }
        if (
          latestConnectionOperation?.operationId === operationId &&
          "kind" in latestConnectionOperation
        ) {
          publishConnectionOperation({
            ...latestConnectionOperation,
            status: "settled",
            result,
          });
        }
        return result;
      };
      ipcMain.handle(
        PILOT_IPC.disconnectComputerWithFeedback,
        handleDisconnect
      );
      ipcMain.handle(
        PILOT_IPC.disconnectComputer,
        async (event, request: unknown) => {
          const result = await handleDisconnect(event, request);
          if (result.status === "cancelled") {
            return false;
          }
          if (result.status === "disconnected") {
            return true;
          }
          // Older renderers must never interpret a structured failure as truthy.
          throw new Error(result.message);
        }
      );
      ipcMain.handle(
        PILOT_IPC.connectComputer,
        async (event, request: unknown) => {
          authorize(event);
          const intent = desktopComputerConnectionRequestSchema.parse(request);
          if (computerMutationPending) {
            throw new Error("A computer connection is already in progress.");
          }
          computerMutationPending = true;
          const operationId = randomUUID();
          latestConnectionProgress = null;
          publishConnectionOperation({
            operationId,
            request: intent,
            status: "pending",
            progress: null,
            result: null,
            errorMessage: null,
          });
          try {
            const result = await connectComputer(intent);
            const settledProgress = readLatestConnectionProgress();
            if (latestConnectionOperation?.operationId === operationId) {
              publishConnectionOperation({
                operationId,
                request: intent,
                status: "settled",
                progress: settledProgress,
                result,
                errorMessage: null,
              });
            }
            return result;
          } catch (error) {
            const settledProgress = readLatestConnectionProgress();
            if (latestConnectionOperation?.operationId === operationId) {
              publishConnectionOperation({
                operationId,
                request: intent,
                status: "settled",
                progress: settledProgress,
                result: null,
                errorMessage:
                  error instanceof Error && error.message.trim()
                    ? error.message.trim()
                    : "This computer could not connect. Try again.",
              });
            }
            throw error;
          } finally {
            computerMutationPending = false;
          }
        }
      );
      ipcMain.handle(PILOT_IPC.connectionProgressCurrent, (event) => {
        authorize(event);
        return latestConnectionProgress;
      });
      ipcMain.handle(PILOT_IPC.connectionOperationCurrent, (event) => {
        authorize(event);
        return latestConnectionOperation;
      });
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, (event) => {
          authorize(event);
          return handler();
        });
      }
      const observedOwners = new WeakSet<WebContents>();
      ipcMain.handle(PILOT_IPC.notificationContext, (event, raw: unknown) => {
        authorize(event);
        return notifications.setContext(raw);
      });
      ipcMain.handle(PILOT_IPC.notificationShow, (event, raw: unknown) => {
        authorize(event);
        return notifications.show(raw);
      });
      ipcMain.handle(PILOT_IPC.notificationTest, (event, raw: unknown) => {
        authorize(event);
        return notifications.test(raw);
      });
      ipcMain.handle(PILOT_IPC.notificationFocused, (event) => {
        authorize(event);
        return (
          getWindow()?.isFocused() === true && getWindow()?.isVisible() === true
        );
      });
      ipcMain.handle(PILOT_IPC.spaceStreamOpen, (event, raw: unknown) => {
        authorize(event);
        const owner = event.sender;
        const frame = event.senderFrame;
        if (!observedOwners.has(owner)) {
          observedOwners.add(owner);
          const closeStreams = () => {
            streams.closeAll();
            accountStreams.closeAll();
          };
          owner.once("destroyed", closeStreams);
          owner.on("did-navigate", closeStreams);
          owner.on("render-process-gone", closeStreams);
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
      ipcMain.handle(PILOT_IPC.accountStreamOpen, (event, raw: unknown) => {
        authorize(event);
        const owner = event.sender;
        const frame = event.senderFrame;
        if (!observedOwners.has(owner)) {
          observedOwners.add(owner);
          owner.once("destroyed", () => {
            streams.closeAll();
            accountStreams.closeAll();
          });
          owner.on("did-navigate", () => {
            streams.closeAll();
            accountStreams.closeAll();
          });
          owner.on("render-process-gone", () => {
            streams.closeAll();
            accountStreams.closeAll();
          });
        }
        return accountStreams.open(raw, (value) => {
          if (
            !owner.isDestroyed() &&
            getWindow()?.webContents === owner &&
            owner.mainFrame === frame
          ) {
            owner.send(PILOT_IPC.accountStreamEvent, value);
          }
        });
      });
      ipcMain.handle(PILOT_IPC.accountStreamClose, (event, raw: unknown) => {
        authorize(event);
        accountStreams.close(raw);
      });
      ipcMain.handle(PILOT_IPC.accountStreamPing, (event, raw: unknown) => {
        authorize(event);
        accountStreams.ping(raw);
      });
    },
  };
}
