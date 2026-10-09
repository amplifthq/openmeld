import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./schemas/daemon/profile-identity";

export const spacePreferencesSchema = z.strictObject({
  automaticWakeEnabled: z.boolean(),
});
export const spacePreferencesRpcSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  automaticWakeEnabled: z.boolean().optional(),
});
export type SpacePreferences = z.infer<typeof spacePreferencesSchema>;
export type SpacePreferencesRpc = z.infer<typeof spacePreferencesRpcSchema>;
