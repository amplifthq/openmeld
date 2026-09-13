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
