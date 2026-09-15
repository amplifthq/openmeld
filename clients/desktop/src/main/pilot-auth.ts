import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { electronClient, handleDeepLink } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import {
  DESKTOP_AUTH_SCHEME,
  type DesktopInstalledTarget,
  desktopSessionSchema,
} from "@openmeld/schemas";
import {
  type BetterAuthClientPlugin,
  createAuthClient,
} from "better-auth/client";
import { app, type BrowserWindow } from "electron";

export function createPilotAuth(
  webOrigin: string,
  getWindow: () => BrowserWindow | null,
  onSessionChanged: () => void,
  installedTarget?: DesktopInstalledTarget
) {
  let signInError: string | null = null;
  const authScheme = installedTarget?.authScheme ?? DESKTOP_AUTH_SCHEME;
  const sessionNotifications: BetterAuthClientPlugin = {
    id: "desktop-session-notifications",
    fetchPlugins: [
      {
        id: "desktop-session-notifications",
        name: "Desktop session notifications",
        hooks: {
          onSuccess(context) {
            const pathname = new URL(context.request.url).pathname;
            if (pathname === "/api/auth/electron/token") {
              onSessionChanged();
            }
          },
        },
      },
    ],
  };
  const electronOptions = {
    protocol: authScheme,
    ...(installedTarget ? { clientID: installedTarget.clientId } : {}),
    signInURL: new URL("/desktop-sign-in", webOrigin).href,
    storage: storage({
      configName: `desktop-auth-${createHash("sha256").update(webOrigin).digest("hex").slice(0, 16)}`,
    }),
    userImageProxy: { enabled: false },
  };
  const client = createAuthClient({
    baseURL: webOrigin,
    fetchOptions: { redirect: "manual" },
    plugins: [
      electronClient(electronOptions),
      // Better Fetch awaits success hooks in plugin order. The Electron
      // plugin has persisted/cleared its cookie before this signal is emitted.
      sessionNotifications,
    ],
  });
  // The application owns all IPC authorization and CSP; do not install the
  // vendor's unrestricted bridge handlers or global response-header hook.
  // Electron permits one privileged-scheme registration. The application
  // registers page and auth schemes together; SDK setup would overwrite it.
  client.setupMain({ bridges: false, csp: false, scheme: false, getWindow });
  const registered =
    process.defaultApp && process.argv[1]
      ? app.setAsDefaultProtocolClient(authScheme, process.execPath, [
          resolve(process.argv[1]),
        ])
      : app.setAsDefaultProtocolClient(authScheme);
  if (!registered) {
    throw new Error("Desktop sign-in callback registration failed");
  }
  const acceptReturn = async (url: string) => {
    try {
      await handleDeepLink({
        $fetch: client.$fetch,
        options: electronOptions,
        url,
        getWindow,
      });
    } catch {
      // PKCE verifiers are vendor-owned and process-local. Never recover a
      // stale/replayed callback by persisting a verifier or exposing its token.
      signInError =
        "This sign-in could not be completed. Sign in with your browser again.";
      onSessionChanged();
    }
  };
  if (app.requestSingleInstanceLock()) {
    app.on("open-url", (event, url) => {
      event.preventDefault();
      return acceptReturn(url);
    });
    app.on("second-instance", (_event, argv) => {
      const window = getWindow();
      if (window?.isMinimized()) {
        window.restore();
      }
      window?.focus();
      if (process.platform !== "darwin") {
        const url = argv.find((arg) => arg.startsWith(`${authScheme}:`));
        if (url) {
          return acceptReturn(url);
        }
      }
    });
    app.whenReady().then(() => {
      if (process.platform !== "darwin") {
        const url = process.argv.find((arg) =>
          arg.startsWith(`${authScheme}:`)
        );
        if (url) {
          return acceptReturn(url);
        }
      }
    });
  } else {
    app.quit();
  }
  return {
    signIn: () => {
      signInError = null;
      return client.requestAuth();
    },
    async cloudRequest(
      path: string,
      request: { method: string; headers: Headers; body?: ArrayBuffer }
    ): Promise<Response> {
      let raw: Response | undefined;
      // The pinned Electron patch persists response cookies in onResponse,
      // before status handling. Await the SDK before returning the raw clone;
      // business errors retain their status/body and never reach the renderer
      // with credentials. The SDK remains the only cookie writer.
      await client.$fetch(path, {
        baseURL: webOrigin,
        method: request.method,
        redirect: "manual",
        retry: 0,
        headers: Object.fromEntries(request.headers),
        body: request.body,
        onResponse({ response }) {
          raw = response.clone();
        },
      });
      if (!raw) {
        throw new Error("OpenMeld did not return a response.");
      }
      if (raw.status === 401) {
        // Invalidate the existing account fence after SDK cookie handling.
        // The fence rereads identity; an HTTP status is not identity truth.
        onSessionChanged();
      }
      return raw;
    },
    async session() {
      if (signInError) {
        const message = signInError;
        signInError = null;
        throw new Error(message);
      }
      const result = await client.getSession({
        query: { disableCookieCache: true },
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Desktop sign-in is unavailable."
        );
      }
      const user = result.data?.user;
      return desktopSessionSchema.parse({
        user: user ? { id: user.id, email: user.email, name: user.name } : null,
      });
    },
    cookie: () => client.getCookie(),
    async signOut() {
      try {
        const result = await client.signOut();
        if (result.error) {
          throw new Error(result.error.message ?? "Desktop sign-out failed.");
        }
      } finally {
        // The vendor clears its local cookie before sending sign-out, even
        // if the server request fails. Refresh identity without claiming success.
        onSessionChanged();
      }
    },
  };
}
export type PilotAuth = ReturnType<typeof createPilotAuth>;
