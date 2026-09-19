import { desktopVersionSchema } from "../../desktop-release";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { daemonServiceLaneSchema } from "../daemon/service-contract";

export const DESKTOP_UPDATE_OBSERVATION_PATH =
  "/v1/account/desktop-update-observations";
/** Only Main supplies installedVersion and a release validated by native updater. */
export const desktopUpdateObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedUserId: z.string().trim().min(1).max(256),
  installationId: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lane: daemonServiceLaneSchema,
  deviceName: z.string().trim().min(1).max(100),
  platform: z.enum(["darwin", "win32", "linux"]),
  installedVersion: desktopVersionSchema,
  // Omitted on startup: installation is known, update-feed applicability isn't.
  availableVersion: desktopVersionSchema.nullable().optional(),
});
export const desktopUpdateObservationResponseSchema = z.strictObject({
  accepted: z.boolean(),
  sequence: z.number().int().positive(),
});
export const desktopUpdateObservationRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  observation: desktopUpdateObservationSchema,
});
