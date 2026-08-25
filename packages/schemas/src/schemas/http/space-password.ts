import * as z from "zod/v4";

export const SPACE_PASSWORD_MIN_LENGTH = 6;
export const SPACE_PASSWORD_RATE_LIMITED_ERROR_CODE =
  "space.password_rate_limited" as const;

export function normalizeSpacePasswordText(password: string): string {
  return password.trim();
}

export const spacePasswordSchema = z
  .string()
  .transform(normalizeSpacePasswordText)
  .pipe(z.string().min(SPACE_PASSWORD_MIN_LENGTH));

export const createSpacePasswordBodySchema = z.strictObject({
  password: spacePasswordSchema.optional(),
});

export const upsertSpacePasswordBodySchema = z.strictObject({
  password: spacePasswordSchema,
});

export const spacePasswordStateSchema = z.strictObject({
  passwordProtected: z.boolean(),
});
