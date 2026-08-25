import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import {
  organizationWorkingLanguageModeSchema,
  workingLanguageTagSchema,
} from "../runtime/working-language";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const setOrganizationWorkingLanguagePreferenceBodySchema =
  z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("automatic") }),
    z.strictObject({
      languageTag: workingLanguageTagSchema,
      mode: z.literal("selected"),
    }),
  ]);

export const organizationWorkingLanguagePreferenceResponseSchema = z
  .strictObject({
    languageTag: workingLanguageTagSchema.nullable(),
    mode: organizationWorkingLanguageModeSchema,
    organizationId: boundedIdentifierSchema,
    revision: z.number().int().nonnegative(),
    updatedAt: isoDateTimeSchema.nullable(),
    updatedByUserId: boundedIdentifierSchema.nullable(),
  })
  .superRefine((preference, context) => {
    if (preference.mode === "selected") {
      if (!preference.languageTag) {
        context.addIssue({
          code: "custom",
          message: "A selected working language requires a language tag.",
          path: ["languageTag"],
        });
      }
      if (!(preference.updatedAt && preference.updatedByUserId)) {
        context.addIssue({
          code: "custom",
          message:
            "A selected working language requires update time and user attribution.",
          path: ["updatedByUserId"],
        });
      }
      if (preference.revision < 1) {
        context.addIssue({
          code: "custom",
          message: "A selected working language requires a positive revision.",
          path: ["revision"],
        });
      }
      return;
    }

    if (preference.updatedByUserId !== null) {
      context.addIssue({
        code: "custom",
        message:
          "An automatic working-language observation cannot be attributed to a settings user.",
        path: ["updatedByUserId"],
      });
    }
    const hasObservation = preference.languageTag !== null;
    if (hasObservation !== (preference.updatedAt !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "An automatic working-language observation and its timestamp must be present together.",
        path: ["updatedAt"],
      });
    }
    if (hasObservation !== preference.revision > 0) {
      context.addIssue({
        code: "custom",
        message:
          "An automatic working-language observation requires a positive revision.",
        path: ["revision"],
      });
    }
  });

const centerAgentWorkingLanguageToolContextShape = {
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentToolSpeakerSchema,
} as const;

export const centerAgentSetOrganizationWorkingLanguageToolRpcInputSchema =
  z.discriminatedUnion("mode", [
    z.strictObject({
      ...centerAgentWorkingLanguageToolContextShape,
      mode: z.literal("automatic"),
    }),
    z.strictObject({
      ...centerAgentWorkingLanguageToolContextShape,
      languageTag: workingLanguageTagSchema,
      mode: z.literal("selected"),
    }),
  ]);

export const centerAgentSetOrganizationWorkingLanguageToolResponseSchema =
  organizationWorkingLanguagePreferenceResponseSchema;
