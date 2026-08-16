import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/runtime/working-language");

export type OrganizationWorkingLanguageMode = z.infer<
  Schemas["organizationWorkingLanguageModeSchema"]
>;
export type WorkingLanguageGuidance = z.infer<
  Schemas["workingLanguageGuidanceSchema"]
>;
export type WorkingLanguageTag = z.infer<Schemas["workingLanguageTagSchema"]>;
