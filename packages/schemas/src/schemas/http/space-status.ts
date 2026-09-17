import * as z from "zod/v4";
import {
  agentProfileIdSchema,
  openMeldRuntimeProfileIdSchema,
} from "../protocol/profile";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import { spaceDispatchPolicySchema } from "../space-mesh/dispatch-policy";
import {
  spaceAllowedActionsSchema,
  spacePublicationModeSchema,
} from "../space-mesh/publication-policy";
import { resultArchivePolicySchema } from "../space-mesh/result-archive-policy";
import { spaceAccessModeSchema } from "./space-access-mode";
import { spaceMembersSummarySchema } from "./space-members";
import { spaceOrganizationVisibilitySchema } from "./space-meta";
import { spaceRouteParamsSchema } from "./space-route-params";

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const optionalTrimmedStringSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());

export const SPACE_STATUS_PREVIEW_MAX_UTF16_UNITS = 240 as const;

export function boundSpaceStatusPreviewText(text: string): string {
  if (text.length <= SPACE_STATUS_PREVIEW_MAX_UTF16_UNITS) {
    return text;
  }
  let truncated = text
    .slice(0, SPACE_STATUS_PREVIEW_MAX_UTF16_UNITS - 1)
    .trimEnd();
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd8_00 && finalCodeUnit <= 0xdb_ff) {
    truncated = truncated.slice(0, -1).trimEnd();
  }
  return `${truncated}…`;
}

export const spaceStatusLatestVisibleUpdateSchema = z.object({
  signalId: nonEmptyTrimmedStringFromUnknown,
  signalType: z.enum(["signal.text", "signal.status", "signal.system_notice"]),
  createdAt: isoDateTimeSchema,
  actorProfileId: openMeldRuntimeProfileIdSchema,
  actorName: optionalTrimmedStringSchema,
  previewText: nonEmptyTrimmedStringFromUnknown.transform(
    boundSpaceStatusPreviewText
  ),
});

export const spaceStatusMembersSummarySchema = spaceMembersSummarySchema.extend(
  {
    liveHumanCount: z.number().int().min(0),
    liveAgentCount: z.number().int().min(0),
  }
);

export const getSpaceStatusInputSchema = spaceRouteParamsSchema;

export const getSpaceStatusResponseSchema = z.object({
  spaceId: nonEmptyTrimmedStringFromUnknown,
  generatedAt: isoDateTimeSchema,
  centerAgentProfileId: agentProfileIdSchema.optional(),
  name: optionalTrimmedStringSchema,
  spacePurpose: optionalTrimmedStringSchema,
  directMessageConvertedAt: isoDateTimeSchema.optional(),
  organizationVisibility: spaceOrganizationVisibilitySchema.optional(),
  ownerUserIds: z.array(z.string().min(1)).optional(),
  allowGuests: z.boolean().optional(),
  accessMode: spaceAccessModeSchema,
  passwordProtected: z.boolean(),
  dispatchPolicy: spaceDispatchPolicySchema,
  publicationMode: spacePublicationModeSchema,
  allowedActions: spaceAllowedActionsSchema,
  resultArchivePolicy: resultArchivePolicySchema,
  entryBrief: z.enum(["default", "none"]),
  dispatchBrief: z.enum(["default", "none"]),
  members: spaceStatusMembersSummarySchema,
  latestVisibleUpdate: spaceStatusLatestVisibleUpdateSchema.optional(),
});
