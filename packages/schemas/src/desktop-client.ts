import * as z from "zod/v4";
import {
  DESKTOP_INSTALLED_AUTH_SCHEME,
  DESKTOP_TEST_AUTH_SCHEME,
} from "./desktop-auth-identity";
import { desktopWindowsBuildSchema } from "./desktop-release";
import { peopleComputerTargetSchema } from "./schemas/http/people-computers";

export const desktopSettingsViewSchema = z.strictObject({
  openAtLogin: z.boolean().nullable(),
  startInBackground: z.boolean().nullable(),
  problem: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
});
export type DesktopSettingsView = z.infer<typeof desktopSettingsViewSchema>;
export const desktopStartupToggleSchema = z.boolean();

export const desktopLocalComputerSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    accountId: z.string().min(1),
    target: peopleComputerTargetSchema,
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    message: z.string().min(1),
  }),
]);
export type DesktopLocalComputer = z.infer<typeof desktopLocalComputerSchema>;

export const DESKTOP_APP_ORIGIN = "openmeld-desktop://app";
export const DESKTOP_CONTRACT_HEADER = "x-openmeld-desktop-contract";
export const DESKTOP_CONTRACT_VERSION = "1";
export const DESKTOP_COMPATIBILITY_PATH = "/v1/desktop/compatibility";
export const desktopCompatibilitySchema = z.strictObject({
  contractVersion: z.literal(DESKTOP_CONTRACT_VERSION),
});
export const desktopInstalledTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("production"),
    // Existing installed builds retain the root-domain protocol entrypoint.
    webOrigin: z.enum(["https://app.openmeld.ai", "https://openmeld.ai"]),
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
export const desktopProductionSourceSchema = z.strictObject({
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  webBuild: z.string().regex(/^[a-f0-9]{64}$/u),
  target: desktopInstalledTargetSchema.refine(
    (target) => target.kind === "production"
  ),
  windows: desktopWindowsBuildSchema.optional(),
});

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
  z.strictObject({
    id: desktopSpaceStreamIdSchema,
    type: z.literal("close"),
    code: z.number().int().min(0).max(65_535),
    reason: z.string(),
  }),
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

export const desktopAccountStreamInputSchema = z.strictObject({
  id: desktopSpaceStreamIdSchema,
  organizationId: z.string().min(1).max(256),
});
export type DesktopAccountStreamInput = z.infer<
  typeof desktopAccountStreamInputSchema
>;
export type DesktopAccountStreamEvent = DesktopSpaceStreamEvent;
export type DesktopAccountStreamBridge = {
  accountStreamOpen?(input: DesktopAccountStreamInput): Promise<void>;
  accountStreamClose?(id: string): Promise<void>;
  accountStreamPing?(id: string): Promise<void>;
  onAccountStream?(
    handler: (event: DesktopAccountStreamEvent) => void
  ): () => void;
};
