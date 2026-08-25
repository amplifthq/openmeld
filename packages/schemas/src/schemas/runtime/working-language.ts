import * as z from "zod/v4";

export const WORKING_LANGUAGE_TAG_MAX_CHARS = 64;

export const workingLanguageTagSchema = z
  .string()
  .trim()
  .min(2)
  .max(WORKING_LANGUAGE_TAG_MAX_CHARS)
  .transform((value, context) => {
    try {
      const [canonical] = Intl.getCanonicalLocales(value);
      if (!canonical) {
        throw new TypeError("A language tag is required.");
      }
      return canonical;
    } catch {
      context.addIssue({
        code: "custom",
        message: "Expected a valid BCP 47 language tag.",
      });
      return z.NEVER;
    }
  });

export const organizationWorkingLanguageModeSchema = z.enum([
  "automatic",
  "selected",
]);

export const workingLanguageGuidanceSchema = z.strictObject({
  languageTag: workingLanguageTagSchema,
  mode: organizationWorkingLanguageModeSchema,
});
