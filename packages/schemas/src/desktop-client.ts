import { z } from "zod/v4";

export const DESKTOP_APP_ORIGIN = "openmeld-desktop://app";
export const DESKTOP_AUTH_SCHEME = "sh.openmeld.desktop.dev";
export const DESKTOP_INSTALLED_AUTH_SCHEME = "sh.openmeld.desktop";
export const DESKTOP_TEST_AUTH_SCHEME = "sh.openmeld.desktop.test";
export const DESKTOP_CONTRACT_HEADER = "x-openmeld-desktop-contract";
export const DESKTOP_CONTRACT_VERSION = "1";
export const DESKTOP_COMPATIBILITY_PATH = "/v1/desktop/compatibility";
export const desktopCompatibilitySchema = z.strictObject({
  contractVersion: z.literal(DESKTOP_CONTRACT_VERSION),
});
export const desktopInstalledTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("production"),
    webOrigin: z.literal("https://openmeld.ai"),
    authScheme: z.literal(DESKTOP_INSTALLED_AUTH_SCHEME),
    clientId: z.literal("openmeld-desktop"),
    appId: z.literal("sh.openmeld.desktop"),
    dataDirectory: z.literal("OpenMeld Desktop"),
  }),
  z.strictObject({
    kind: z.literal("disposable"),
    webOrigin: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.origin === value &&
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost"))
      );
    }),
    authScheme: z.literal(DESKTOP_TEST_AUTH_SCHEME),
    clientId: z.literal("openmeld-desktop-test"),
    appId: z.literal("sh.openmeld.desktop.test"),
    dataDirectory: z.literal("OpenMeld Desktop Test"),
  }),
]);
export type DesktopInstalledTarget = z.infer<
  typeof desktopInstalledTargetSchema
>;

/** Fixed client identities select protocols, never a caller-provided URL. */
export function desktopAuthIdentity(
  production: boolean,
  developmentTarget?: string
) {
  const target = developmentTarget?.trim() || undefined;
  if (production) {
    if (target) {
      throw new Error(
        "Desktop development Auth targets are not allowed in production."
      );
    }
    return {
      clientId: "openmeld-desktop",
      authScheme: DESKTOP_INSTALLED_AUTH_SCHEME,
    };
  }
  if (!target || target === "private") {
    return { clientId: "electron", authScheme: DESKTOP_AUTH_SCHEME };
  }
  if (target === "disposable") {
    return {
      clientId: "openmeld-desktop-test",
      authScheme: DESKTOP_TEST_AUTH_SCHEME,
    };
  }
  throw new Error("Unknown Desktop development Auth target.");
}
export const DESKTOP_WEB_BUILD_HEADER = "x-openmeld-desktop-web-build";

export const desktopSessionSchema = z.strictObject({
  user: z
    .strictObject({
      id: z.string().min(1),
      email: z.string(),
      name: z.string(),
    })
    .nullable(),
});
export type DesktopSession = z.infer<typeof desktopSessionSchema>;

export const desktopWebBuildSchema = z.strictObject({
  webBuild: z.string().regex(/^[a-f0-9]{64}$/u),
  installedTarget: desktopInstalledTargetSchema.optional(),
});

export const desktopPlatformSchema = desktopWebBuildSchema.extend({
  platform: z.literal("desktop"),
  webOrigin: z.string().url(),
  lane: z.enum(["dev-local", "canary", "prod"]),
});
export type DesktopPlatform = z.infer<typeof desktopPlatformSchema>;

export const desktopSpaceStreamIdSchema = z.string().uuid();
export const desktopSpaceStreamInputSchema = z.strictObject({
  id: desktopSpaceStreamIdSchema,
  spaceId: z.string().min(1).max(256),
  profileId: z.string().min(1).max(256),
});
export type DesktopSpaceStreamInput = z.infer<
  typeof desktopSpaceStreamInputSchema
>;
export const desktopSpaceStreamEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ id: desktopSpaceStreamIdSchema, type: z.literal("open") }),
  z.strictObject({
    id: desktopSpaceStreamIdSchema,
    type: z.literal("message"),
    data: z.string(),
  }),
  z.strictObject({ id: desktopSpaceStreamIdSchema, type: z.literal("error") }),
  z.strictObject({ id: desktopSpaceStreamIdSchema, type: z.literal("close") }),
]);
export type DesktopSpaceStreamEvent = z.infer<
  typeof desktopSpaceStreamEventSchema
>;

export type DesktopSpaceStreamBridge = {
  spaceStreamOpen(input: DesktopSpaceStreamInput): Promise<void>;
  spaceStreamClose(id: string): Promise<void>;
  spaceStreamPing(id: string): Promise<void>;
  onSpaceStream(handler: (event: DesktopSpaceStreamEvent) => void): () => void;
};
