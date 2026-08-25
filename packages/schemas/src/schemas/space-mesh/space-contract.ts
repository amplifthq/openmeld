import * as z from "zod/v4";
import { trimmedStringFromUnknown } from "../protocol/shared";
import { spaceAuthorityOrderSchema } from "./authority-order";
import { spaceDispatchPolicySchema } from "./dispatch-policy";
import {
  spaceAllowedActionsSchema,
  spacePublicationModeSchema,
} from "./publication-policy";
import { resultArchivePolicySchema } from "./result-archive-policy";
import { spaceNoteSchema } from "./space-note";

const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const spaceBriefModeSchema = z.enum(["default", "none"]);

export const spaceContractFieldsSchema = z.strictObject({
  dispatchPolicy: spaceDispatchPolicySchema,
  publicationMode: spacePublicationModeSchema,
  allowedActions: spaceAllowedActionsSchema,
  resultArchivePolicy: resultArchivePolicySchema,
  spaceNote: spaceNoteSchema.optional(),
  authorityOrder: spaceAuthorityOrderSchema,
  entryBrief: spaceBriefModeSchema,
  dispatchBrief: spaceBriefModeSchema,
});

export const spaceContractSchema = z.strictObject({
  version: z.number().int().finite().positive(),
  updatedAt: isoDateTimeSchema,
  updatedBy: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  dispatchPolicy: spaceDispatchPolicySchema,
  publicationMode: spacePublicationModeSchema,
  allowedActions: spaceAllowedActionsSchema,
  resultArchivePolicy: resultArchivePolicySchema,
  spaceNote: spaceNoteSchema.optional(),
  authorityOrder: spaceAuthorityOrderSchema,
  entryBrief: spaceBriefModeSchema,
  dispatchBrief: spaceBriefModeSchema,
});
