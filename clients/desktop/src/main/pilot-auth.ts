import { createHash } from "node:crypto";
import { electronClient } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import { DESKTOP_AUTH_SCHEME, desktopSessionSchema } from "@openmeld/schemas";
import { createAuthClient } from "better-auth/client";
import type { BrowserWindow } from "electron";

export function createPilotAuth(
  webOrigin: string,
  getWindow: () => BrowserWindow | null
) {
  const client = createAuthClient({
    baseURL: webOrigin,
    plugins: [
      electronClient({
        protocol: DESKTOP_AUTH_SCHEME,
        signInURL: new URL("/desktop-sign-in", webOrigin).href,
        storage: storage({
          configName: `desktop-auth-${createHash("sha256").update(webOrigin).digest("hex").slice(0, 16)}`,
        }),
        userImageProxy: { enabled: false },
      }),
    ],
  });
  // The application owns all IPC authorization and CSP; do not install the
  // vendor's unrestricted bridge handlers or global response-header hook.
  client.setupMain({ bridges: false, csp: false, scheme: true, getWindow });
  return {
    signIn: () => client.requestAuth(),
    async session() {
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
      const result = await client.signOut();
      if (result.error) {
        throw new Error(result.error.message ?? "Desktop sign-out failed.");
      }
    },
  };
}
export type PilotAuth = ReturnType<typeof createPilotAuth>;
