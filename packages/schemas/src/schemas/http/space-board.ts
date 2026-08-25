import * as z from "zod/v4";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { spaceRouteParamsSchema } from "./space-route-params";

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedNonEmptyStringSchema =
  trimmedNonEmptyStringSchema.nullable();

export const spaceBoardOutcomeSchema = z.enum([
  "replied",
  "failed",
  "stopped",
  "timed_out",
]);

export const spaceBoardSpaceSchema = z.strictObject({
  id: trimmedNonEmptyStringSchema,
  name: trimmedNonEmptyStringSchema,
  purpose: nullableTrimmedNonEmptyStringSchema,
  guide: nullableTrimmedNonEmptyStringSchema,
});

export const spaceBoardMembersSchema = z.strictObject({
  totalCount: z.number().int().min(0),
  humanCount: z.number().int().min(0),
  agentCount: z.number().int().min(0),
  centerAgentPresent: z.boolean(),
});

export const spaceBoardAgentProfileSchema = z.strictObject({
  profileId: openMeldRuntimeProfileIdSchema,
  profileName: nullableTrimmedNonEmptyStringSchema,
});

export const spaceBoardRoomProjectionSchema = z.strictObject({
  space: spaceBoardSpaceSchema,
  members: spaceBoardMembersSchema,
  agentProfiles: z.array(spaceBoardAgentProfileSchema),
});

export const spaceBoardWorkingExecutionSchema =
  spaceBoardAgentProfileSchema.extend({
    startedAt: isoDateTimeSchema,
  });

export const spaceBoardRecentOutcomeSchema =
  spaceBoardAgentProfileSchema.extend({
    at: isoDateTimeSchema,
    outcome: spaceBoardOutcomeSchema,
  });

export const getSpaceBoardInputSchema = spaceRouteParamsSchema;

export const spaceBoardResponseSchema = z.strictObject({
  space: spaceBoardSpaceSchema,
  members: spaceBoardMembersSchema,
  workingNow: z.array(spaceBoardWorkingExecutionSchema),
  recentOutcomes: z.array(spaceBoardRecentOutcomeSchema).max(10),
});
