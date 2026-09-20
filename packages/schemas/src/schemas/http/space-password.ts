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
  .pipe(
    z.string().superRefine((password, context) => {
      // Keep the existing UTF-16 length contract used by CLI and Core.
      if (password.length < SPACE_PASSWORD_MIN_LENGTH) {
        context.addIssue({
          code: "too_small",
          origin: "string",
          minimum: SPACE_PASSWORD_MIN_LENGTH,
          inclusive: true,
        });
      }
    })
  );

export const createSpacePasswordBodySchema = z.strictObject({
  password: spacePasswordSchema.optional(),
});

export const upsertSpacePasswordBodySchema = z.strictObject({
  password: spacePasswordSchema,
});

export const spacePasswordStateSchema = z.strictObject({
  passwordProtected: z.boolean(),
});
