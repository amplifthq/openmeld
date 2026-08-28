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

export const spaceStatusLatestVisibleUpdateSchema = z.object({
  signalId: nonEmptyTrimmedStringFromUnknown,
  signalType: z.enum(["signal.text", "signal.status", "signal.system_notice"]),
  createdAt: isoDateTimeSchema,
  actorProfileId: openMeldRuntimeProfileIdSchema,
  actorName: optionalTrimmedStringSchema,
  previewText: nonEmptyTrimmedStringFromUnknown,
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
