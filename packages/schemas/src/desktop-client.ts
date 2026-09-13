import { z } from "zod/v4";

export const DESKTOP_APP_ORIGIN = "openmeld-desktop://app";
export const DESKTOP_AUTH_SCHEME = "sh.openmeld.desktop.dev";
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
});

export const desktopPlatformSchema = desktopWebBuildSchema.extend({
  platform: z.literal("desktop"),
  webOrigin: z.string().url(),
  lane: z.enum(["dev-local", "canary"]),
});
export type DesktopPlatform = z.infer<typeof desktopPlatformSchema>;
