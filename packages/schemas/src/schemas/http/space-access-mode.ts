import * as z from "zod/v4";
import { spacePasswordSchema } from "./space-password";

export const SPACE_ACCESS_MODES = [
  "public",
  "members_only",
  "public_view_join_password",
  "protected",
] as const;

export function spaceAccessModeUsesPassword(
  accessMode: z.infer<typeof spaceAccessModeSchema>
): accessMode is "public_view_join_password" | "protected" {
  return (
    accessMode === "public_view_join_password" || accessMode === "protected"
  );
}

export const spaceAccessModeSchema = z.enum(SPACE_ACCESS_MODES);

export const setSpaceAccessModeBodySchema = z.strictObject({
  accessMode: spaceAccessModeSchema,
  password: spacePasswordSchema.optional(),
});

export const spaceAccessModeStateSchema = z.strictObject({
  spaceId: z.string().trim().min(1),
  accessMode: spaceAccessModeSchema,
  passwordProtected: z.boolean(),
});
