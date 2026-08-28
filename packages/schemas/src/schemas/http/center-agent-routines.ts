import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { CENTER_AGENT_INTERACTION_CLIENT_MAX_CHARS } from "../protocol/center-agent-interaction-source";
import { MAX_PROFILE_NAME_LENGTH } from "../protocol/constants";
import { centerAgentVerifiedMemberToolSpeakerSchema } from "./center-agent-speaker";
import { spaceNameSchema } from "./space-name";

export const CENTER_AGENT_ROUTINE_NAME_MAX_CHARS = 120;
export const CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS = 20_000;
export const CENTER_AGENT_ROUTINE_CRON_EXPRESSION_MAX_CHARS = 256;
export const CENTER_AGENT_ROUTINE_TIMEZONE_MAX_CHARS = 128;
export const CENTER_AGENT_ROUTINE_SLACK_THREAD_LABEL_MAX_CHARS = 160;
export const CENTER_AGENT_ROUTINE_RUN_FAILURE_DETAIL_MAX_CHARS = 4000;
export const CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT = 100;
export const CENTER_AGENT_ROUTINE_TARGET_SPACE_LIST_MAX_ITEMS = 500;
export const CENTER_AGENT_ROUTINE_LIMIT = 50;
export const CENTER_AGENT_ROUTINE_ERROR_CODES = [
  "routine.center_agent_required",
  "routine.client_update_required",
  "routine.forbidden",
  "routine.member_actor_required",
  "routine.not_found",
  "routine.schedule.invalid_cron",
  "routine.schedule.invalid_reference_time",
  "routine.schedule.invalid_timezone",
  "routine.schedule.too_frequent",
  "routine.schedule.run_at_past",
  "routine.status_conflict",
  "routine.store_unavailable",
  "routine.target_space_not_found",
  "routine.target_space_org_mismatch",
  "routine.target_space_publication_unavailable",
  "routine.slack_thread_unavailable",
  "routine.total_limit_reached",
] as const;

export const CENTER_AGENT_ROUTINE_STATUSES = [
  "enabled",
  "paused",
  "completed",
] as const;
export const CENTER_AGENT_ROUTINE_RUN_STATUSES = [
  "claimed",
  "submitted",
  "completed",
  "failed",
  "skipped",
] as const;
export const CENTER_AGENT_ROUTINE_TARGET_SPACE_KINDS = [
  "space",
  "center_agent_dm",
] as const;
export const CENTER_AGENT_ROUTINE_DESTINATION_KINDS = [
  "space",
  "slack_thread",
] as const;
export const CENTER_AGENT_ROUTINE_AUTHORIZED_ACTIONS = [
  "organization_documents.save_approved_knowledge",
  "slack.publish_channel_report",
] as const;
export const CENTER_AGENT_ROUTINE_EXTERNAL_ACTION_POLICIES = [
  "standard",
  "read_only",
] as const;
export const CENTER_AGENT_ROUTINE_PRACTICAL_CONTRACT = "practical-v2" as const;
export const CENTER_AGENT_ROUTINE_MANAGEMENT_V1_CONTRACT =
  "management-v1" as const;
export const CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT =
  "management-v2" as const;

const trimmedIdentifierSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();
export const centerAgentRoutineRunScheduledForMsSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const nullableTrimmedTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();
const queryIntegerPattern = /^\d+$/u;
const querySignedIntegerPattern = /^-?\d+$/u;

export const centerAgentRoutineStatusSchema = z.enum(
  CENTER_AGENT_ROUTINE_STATUSES
);
export const centerAgentRoutineRunStatusSchema = z.enum(
  CENTER_AGENT_ROUTINE_RUN_STATUSES
);
export const centerAgentRoutineScheduleKindSchema = z.enum(["cron", "once"]);
export const centerAgentRoutineDestinationKindSchema = z.enum(
  CENTER_AGENT_ROUTINE_DESTINATION_KINDS
);
export const centerAgentRoutineAuthorizedActionSchema = z.enum(
  CENTER_AGENT_ROUTINE_AUTHORIZED_ACTIONS
);
export const centerAgentRoutineAuthorizedActionsSchema = z
  .array(centerAgentRoutineAuthorizedActionSchema)
  .max(CENTER_AGENT_ROUTINE_AUTHORIZED_ACTIONS.length);
export const centerAgentRoutineExternalActionPolicySchema = z.enum(
  CENTER_AGENT_ROUTINE_EXTERNAL_ACTION_POLICIES
);
export const centerAgentRoutineContractSchema = z.literal(
  CENTER_AGENT_ROUTINE_PRACTICAL_CONTRACT
);
export const centerAgentRoutineListContractSchema = z.enum([
  CENTER_AGENT_ROUTINE_PRACTICAL_CONTRACT,
  CENTER_AGENT_ROUTINE_MANAGEMENT_V1_CONTRACT,
  CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT,
]);
export const centerAgentRoutineTargetSpaceKindSchema = z.enum(
  CENTER_AGENT_ROUTINE_TARGET_SPACE_KINDS
);

export const centerAgentRoutineTargetSpaceSchema = z.strictObject({
  kind: centerAgentRoutineTargetSpaceKindSchema,
  name: spaceNameSchema,
  spaceId: trimmedIdentifierSchema,
});

export const centerAgentRoutineLastRunSummarySchema = z
  .strictObject({
    failureCode: nullableTrimmedTextSchema(256),
    failureDetail: nullableTrimmedTextSchema(
      CENTER_AGENT_ROUTINE_RUN_FAILURE_DETAIL_MAX_CHARS
    ),
    finishedAtMs: timestampMsSchema.nullable(),
    id: trimmedIdentifierSchema,
    publishedSignalId: nullableTrimmedTextSchema(256),
    scheduledFor: centerAgentRoutineRunScheduledForMsSchema,
    startedAtMs: timestampMsSchema.nullable(),
    status: centerAgentRoutineRunStatusSchema,
  })
  .superRefine(validateRoutineRunScheduledFor);

const routineScheduleShape = {
  cronExpression: nullableTrimmedTextSchema(
    CENTER_AGENT_ROUTINE_CRON_EXPRESSION_MAX_CHARS
  ),
  runAtMs: timestampMsSchema.nullable().default(null),
  scheduleKind: centerAgentRoutineScheduleKindSchema.default("cron"),
  timezone: nullableTrimmedTextSchema(CENTER_AGENT_ROUTINE_TIMEZONE_MAX_CHARS),
};

const routineDestinationShape = {
  destinationKind: centerAgentRoutineDestinationKindSchema.default("space"),
  slackChannelId: nullableTrimmedTextSchema(256).default(null),
  slackConversationId: nullableTrimmedTextSchema(512).default(null),
  slackTeamId: nullableTrimmedTextSchema(256).default(null),
  slackThreadLabel: nullableTrimmedTextSchema(
    CENTER_AGENT_ROUTINE_SLACK_THREAD_LABEL_MAX_CHARS
  ).default(null),
  slackThreadTs: nullableTrimmedTextSchema(256).default(null),
  targetSpaceId: trimmedIdentifierSchema.nullable().default(null),
};

const centerAgentRoutineShape = {
  canManage: z.boolean(),
  createdAtMs: timestampMsSchema,
  createdByUserId: trimmedIdentifierSchema,
  ...routineScheduleShape,
  ...routineDestinationShape,
  id: trimmedIdentifierSchema,
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS),
  lastRun: centerAgentRoutineLastRunSummarySchema.nullable(),
  name: z.string().trim().min(1).max(CENTER_AGENT_ROUTINE_NAME_MAX_CHARS),
  nextDueAt: timestampMsSchema.nullable(),
  organizationId: trimmedIdentifierSchema,
  status: centerAgentRoutineStatusSchema,
  updatedAtMs: timestampMsSchema,
  updatedByUserId: trimmedIdentifierSchema,
};

export const centerAgentRoutineSchema = z
  .strictObject(centerAgentRoutineShape)
  .superRefine(validateRoutineScheduleAndDestination);

export const centerAgentRoutineCapabilityStateSchema = z.strictObject({
  approvedKnowledge: z.boolean(),
  canRepair: z.boolean(),
  externalActionPolicy: centerAgentRoutineExternalActionPolicySchema,
  slackChannelReport: z.boolean(),
});

export const centerAgentRoutineCreationInteractionSourceSchema = z.strictObject(
  {
    client: z
      .string()
      .trim()
      .min(1)
      .max(CENTER_AGENT_INTERACTION_CLIENT_MAX_CHARS),
    kind: z.literal("local_agent"),
  }
);

export const centerAgentRoutineCreationAttributionSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(MAX_PROFILE_NAME_LENGTH).nullable(),
  interactionSource:
    centerAgentRoutineCreationInteractionSourceSchema.optional(),
});

const centerAgentRoutineManagementV1Shape = {
  ...centerAgentRoutineShape,
  capabilityState: centerAgentRoutineCapabilityStateSchema,
};

export const centerAgentRoutineManagementV1Schema = z
  .strictObject(centerAgentRoutineManagementV1Shape)
  .superRefine(validateRoutineScheduleAndDestination);

export const centerAgentRoutineManagementSchema = z
  .strictObject({
    ...centerAgentRoutineManagementV1Shape,
    creationAttribution: centerAgentRoutineCreationAttributionSchema,
  })
  .superRefine(validateRoutineScheduleAndDestination);

export const centerAgentRoutineRunSchema = z
  .strictObject({
    ...routineDestinationShape,
    failureCode: nullableTrimmedTextSchema(256),
    failureDetail: nullableTrimmedTextSchema(
      CENTER_AGENT_ROUTINE_RUN_FAILURE_DETAIL_MAX_CHARS
    ),
    finishedAtMs: timestampMsSchema.nullable(),
    id: trimmedIdentifierSchema,
    nativeDeliveryId: nullableTrimmedTextSchema(256),
    organizationId: trimmedIdentifierSchema,
    publishedSignalId: nullableTrimmedTextSchema(256),
    routineId: trimmedIdentifierSchema,
    scheduledFor: centerAgentRoutineRunScheduledForMsSchema,
    startedAtMs: timestampMsSchema.nullable(),
    status: centerAgentRoutineRunStatusSchema,
  })
  .superRefine(validateRoutineRunScheduledFor);

export const centerAgentRoutineLegacyV1Schema = z.strictObject({
  canManage: z.boolean(),
  createdAtMs: timestampMsSchema,
  createdByUserId: trimmedIdentifierSchema,
  cronExpression: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_CRON_EXPRESSION_MAX_CHARS),
  id: trimmedIdentifierSchema,
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS),
  lastRun: centerAgentRoutineLastRunSummarySchema.nullable(),
  name: z.string().trim().min(1).max(CENTER_AGENT_ROUTINE_NAME_MAX_CHARS),
  nextDueAt: timestampMsSchema.nullable(),
  organizationId: trimmedIdentifierSchema,
  scheduleKind: z.literal("cron"),
  status: z.enum(["enabled", "paused"]),
  targetSpaceId: trimmedIdentifierSchema,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_TIMEZONE_MAX_CHARS),
  updatedAtMs: timestampMsSchema,
  updatedByUserId: trimmedIdentifierSchema,
});

export const centerAgentRoutineRunLegacyV1Schema = z
  .strictObject({
    failureCode: nullableTrimmedTextSchema(256),
    failureDetail: nullableTrimmedTextSchema(
      CENTER_AGENT_ROUTINE_RUN_FAILURE_DETAIL_MAX_CHARS
    ),
    finishedAtMs: timestampMsSchema.nullable(),
    id: trimmedIdentifierSchema,
    nativeDeliveryId: nullableTrimmedTextSchema(256),
    organizationId: trimmedIdentifierSchema,
    publishedSignalId: nullableTrimmedTextSchema(256),
    routineId: trimmedIdentifierSchema,
    scheduledFor: centerAgentRoutineRunScheduledForMsSchema,
    startedAtMs: timestampMsSchema.nullable(),
    status: centerAgentRoutineRunStatusSchema,
  })
  .superRefine(validateRoutineRunScheduledFor);

const routineContractQueryShape = {
  contract: centerAgentRoutineContractSchema.optional(),
};

export const centerAgentRoutineContractQuerySchema = z.strictObject(
  routineContractQueryShape
);

export const listCenterAgentRoutinesQuerySchema = z.strictObject({
  contract: centerAgentRoutineListContractSchema.optional(),
});

export const listCenterAgentRoutinesResponseSchema = z.strictObject({
  currentUserId: trimmedIdentifierSchema,
  organizationId: trimmedIdentifierSchema,
  routines: z.array(centerAgentRoutineSchema).max(CENTER_AGENT_ROUTINE_LIMIT),
});

export const listCenterAgentRoutinesManagementResponseSchema = z.strictObject({
  currentUserId: trimmedIdentifierSchema,
  organizationId: trimmedIdentifierSchema,
  routines: z
    .array(centerAgentRoutineManagementSchema)
    .max(CENTER_AGENT_ROUTINE_LIMIT),
});

export const listCenterAgentRoutinesManagementV1ResponseSchema = z.strictObject(
  {
    currentUserId: trimmedIdentifierSchema,
    organizationId: trimmedIdentifierSchema,
    routines: z
      .array(centerAgentRoutineManagementV1Schema)
      .max(CENTER_AGENT_ROUTINE_LIMIT),
  }
);

export const listCenterAgentRoutinesLegacyV1ResponseSchema = z.strictObject({
  currentUserId: trimmedIdentifierSchema,
  organizationId: trimmedIdentifierSchema,
  routines: z
    .array(centerAgentRoutineLegacyV1Schema)
    .max(CENTER_AGENT_ROUTINE_LIMIT),
});

export const listCenterAgentRoutineTargetSpacesQuerySchema = z.strictObject({});

export const listCenterAgentRoutineTargetSpacesResponseSchema = z.strictObject({
  organizationId: trimmedIdentifierSchema,
  spaces: z
    .array(centerAgentRoutineTargetSpaceSchema)
    .max(CENTER_AGENT_ROUTINE_TARGET_SPACE_LIST_MAX_ITEMS),
});

const createCenterAgentRoutineBodyShape = {
  authorizedActions: centerAgentRoutineAuthorizedActionsSchema.optional(),
  externalActionPolicy: centerAgentRoutineExternalActionPolicySchema.optional(),
  ...routineScheduleShape,
  ...routineDestinationShape,
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS),
  name: z.string().trim().min(1).max(CENTER_AGENT_ROUTINE_NAME_MAX_CHARS),
};

export const createCenterAgentRoutineBodySchema = z
  .strictObject(createCenterAgentRoutineBodyShape)
  .superRefine(validateRoutineScheduleAndDestination);

export const createCenterAgentRoutineResponseSchema = z.strictObject({
  routine: centerAgentRoutineSchema,
});

export const centerAgentRoutineMutationLegacyV1ResponseSchema = z.strictObject({
  routine: centerAgentRoutineLegacyV1Schema,
});

const centerAgentRoutineRouteParamsShape = {
  routineId: trimmedIdentifierSchema,
};

export const centerAgentRoutineRouteParamsSchema = z.strictObject(
  centerAgentRoutineRouteParamsShape
);

const routineUpdateShape = {
  authorizedActions: centerAgentRoutineAuthorizedActionsSchema.optional(),
  externalActionPolicy: centerAgentRoutineExternalActionPolicySchema.optional(),
  cronExpression: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_CRON_EXPRESSION_MAX_CHARS)
    .nullable()
    .optional(),
  destinationKind: centerAgentRoutineDestinationKindSchema.optional(),
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS)
    .optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_NAME_MAX_CHARS)
    .optional(),
  runAtMs: timestampMsSchema.nullable().optional(),
  scheduleKind: centerAgentRoutineScheduleKindSchema.optional(),
  slackChannelId: nullableTrimmedTextSchema(256).optional(),
  slackConversationId: nullableTrimmedTextSchema(512).optional(),
  slackTeamId: nullableTrimmedTextSchema(256).optional(),
  slackThreadLabel: nullableTrimmedTextSchema(
    CENTER_AGENT_ROUTINE_SLACK_THREAD_LABEL_MAX_CHARS
  ).optional(),
  slackThreadTs: nullableTrimmedTextSchema(256).optional(),
  targetSpaceId: trimmedIdentifierSchema.nullable().optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_TIMEZONE_MAX_CHARS)
    .nullable()
    .optional(),
};

export const updateCenterAgentRoutineBodySchema = z
  .strictObject(routineUpdateShape)
  .refine(hasRoutineUpdate, "At least one Routine field must be updated.");

export const updateCenterAgentRoutineResponseSchema = z.strictObject({
  routine: centerAgentRoutineSchema,
});

export const pauseCenterAgentRoutineBodySchema = z.strictObject({});
export const pauseCenterAgentRoutineResponseSchema = z.strictObject({
  routine: centerAgentRoutineSchema,
});

export const resumeCenterAgentRoutineBodySchema = z.strictObject({});
export const resumeCenterAgentRoutineResponseSchema = z.strictObject({
  routine: centerAgentRoutineSchema,
});

export const deleteCenterAgentRoutineBodySchema = z.strictObject({});
export const deleteCenterAgentRoutineResponseSchema = z.strictObject({
  deleted: z.literal(true),
  organizationId: trimmedIdentifierSchema,
  routineId: trimmedIdentifierSchema,
});

const routineRunLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT);
const queryScheduledForMsSchema = z
  .string()
  .regex(querySignedIntegerPattern)
  .transform((value) => Number(value))
  .pipe(centerAgentRoutineRunScheduledForMsSchema);
const queryLimitSchema = z
  .string()
  .regex(queryIntegerPattern)
  .transform((value) => Number(value))
  .pipe(routineRunLimitSchema);

export const listCenterAgentRoutineRunsQuerySchema = z.strictObject({
  beforeScheduledFor: queryScheduledForMsSchema.optional(),
  ...routineContractQueryShape,
  limit: queryLimitSchema.optional(),
});

export const listCenterAgentRoutineRunsResponseSchema = z.strictObject({
  organizationId: trimmedIdentifierSchema,
  routineId: trimmedIdentifierSchema,
  runs: z
    .array(centerAgentRoutineRunSchema)
    .max(CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT),
});

export const listCenterAgentRoutineRunsLegacyV1ResponseSchema = z.strictObject({
  organizationId: trimmedIdentifierSchema,
  routineId: trimmedIdentifierSchema,
  runs: z
    .array(centerAgentRoutineRunLegacyV1Schema)
    .max(CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT),
});

const routineRpcContextShape = {
  context: openMeldRequestContextSchema.optional(),
};
const routineRpcContractShape = {
  contract: centerAgentRoutineContractSchema.optional(),
};

export const listCenterAgentRoutinesRpcInputSchema = z.strictObject({
  ...routineRpcContextShape,
  contract: centerAgentRoutineListContractSchema.optional(),
});

export const listCenterAgentRoutineTargetSpacesRpcInputSchema = z.strictObject(
  routineRpcContextShape
);

export const createCenterAgentRoutineRpcInputSchema = z
  .strictObject({
    ...routineRpcContextShape,
    ...routineRpcContractShape,
    ...createCenterAgentRoutineBodyShape,
  })
  .superRefine(validateRoutineScheduleAndDestination);

export const updateCenterAgentRoutineRpcInputSchema = z
  .strictObject({
    ...routineRpcContextShape,
    ...routineRpcContractShape,
    ...centerAgentRoutineRouteParamsShape,
    ...routineUpdateShape,
  })
  .refine(hasRoutineUpdate, "At least one Routine field must be updated.");

export const pauseCenterAgentRoutineRpcInputSchema = z.strictObject({
  ...routineRpcContextShape,
  ...routineRpcContractShape,
  ...centerAgentRoutineRouteParamsShape,
});

export const resumeCenterAgentRoutineRpcInputSchema = z.strictObject({
  ...routineRpcContextShape,
  ...routineRpcContractShape,
  ...centerAgentRoutineRouteParamsShape,
});

export const deleteCenterAgentRoutineRpcInputSchema = z.strictObject({
  ...routineRpcContextShape,
  ...routineRpcContractShape,
  ...centerAgentRoutineRouteParamsShape,
});

export const listCenterAgentRoutineRunsRpcInputSchema = z.strictObject({
  beforeScheduledFor: centerAgentRoutineRunScheduledForMsSchema.optional(),
  ...routineRpcContextShape,
  ...routineRpcContractShape,
  limit: routineRunLimitSchema.optional(),
  ...centerAgentRoutineRouteParamsShape,
});

export const centerAgentRoutineToolSpeakerSchema =
  centerAgentVerifiedMemberToolSpeakerSchema;

const routineToolRpcContextShape = {
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentRoutineToolSpeakerSchema,
};

export const centerAgentListRoutinesToolRpcInputSchema = z.strictObject(
  routineToolRpcContextShape
);

export const centerAgentCreateRoutineToolRpcInputSchema = z
  .strictObject({
    ...routineToolRpcContextShape,
    ...createCenterAgentRoutineBodyShape,
  })
  .superRefine(validateRoutineScheduleAndDestination);

export const centerAgentUpdateRoutineToolRpcInputSchema = z
  .strictObject({
    ...routineToolRpcContextShape,
    ...centerAgentRoutineRouteParamsShape,
    ...routineUpdateShape,
  })
  .refine(hasRoutineUpdate, "At least one Routine field must be updated.");

export const centerAgentDeleteRoutineToolRpcInputSchema = z.strictObject({
  ...routineToolRpcContextShape,
  ...centerAgentRoutineRouteParamsShape,
});

export const centerAgentPauseRoutineToolRpcInputSchema = z.strictObject({
  ...routineToolRpcContextShape,
  ...centerAgentRoutineRouteParamsShape,
});

export const centerAgentResumeRoutineToolRpcInputSchema = z.strictObject({
  ...routineToolRpcContextShape,
  ...centerAgentRoutineRouteParamsShape,
});

function hasRoutineUpdate(value: {
  authorizedActions?: string[];
  cronExpression?: string | null;
  destinationKind?: string;
  externalActionPolicy?: string;
  instructions?: string;
  name?: string;
  runAtMs?: number | null;
  scheduleKind?: string;
  slackChannelId?: string | null;
  slackConversationId?: string | null;
  slackTeamId?: string | null;
  slackThreadLabel?: string | null;
  slackThreadTs?: string | null;
  targetSpaceId?: string | null;
  timezone?: string | null;
}): boolean {
  return (
    value.authorizedActions !== undefined ||
    value.cronExpression !== undefined ||
    value.destinationKind !== undefined ||
    value.externalActionPolicy !== undefined ||
    value.instructions !== undefined ||
    value.name !== undefined ||
    value.runAtMs !== undefined ||
    value.scheduleKind !== undefined ||
    value.slackChannelId !== undefined ||
    value.slackConversationId !== undefined ||
    value.slackTeamId !== undefined ||
    value.slackThreadLabel !== undefined ||
    value.slackThreadTs !== undefined ||
    value.targetSpaceId !== undefined ||
    value.timezone !== undefined
  );
}

function validateRoutineScheduleAndDestination(
  value: {
    cronExpression: string | null;
    destinationKind: (typeof CENTER_AGENT_ROUTINE_DESTINATION_KINDS)[number];
    runAtMs: number | null;
    scheduleKind: "cron" | "once";
    slackChannelId: string | null;
    slackConversationId: string | null;
    slackTeamId: string | null;
    slackThreadTs: string | null;
    targetSpaceId: string | null;
    timezone: string | null;
  },
  context: zod.RefinementCtx
): void {
  const recurringScheduleComplete = Boolean(
    value.cronExpression && value.timezone && value.runAtMs === null
  );
  const onceScheduleComplete = Boolean(
    value.runAtMs !== null &&
      value.cronExpression === null &&
      value.timezone === null
  );
  if (
    (value.scheduleKind === "cron" && !recurringScheduleComplete) ||
    (value.scheduleKind === "once" && !onceScheduleComplete)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "A recurring Routine requires cronExpression and timezone; a one-time Routine requires only runAtMs.",
      path: ["scheduleKind"],
    });
  }

  const spaceDestinationComplete = Boolean(
    value.targetSpaceId &&
      !value.slackTeamId &&
      !value.slackChannelId &&
      !value.slackThreadTs &&
      !value.slackConversationId
  );
  const slackDestinationComplete = Boolean(
    !value.targetSpaceId &&
      value.slackTeamId &&
      value.slackChannelId &&
      value.slackThreadTs &&
      value.slackConversationId
  );
  if (
    (value.destinationKind === "space" && !spaceDestinationComplete) ||
    (value.destinationKind === "slack_thread" && !slackDestinationComplete)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "A Space destination requires targetSpaceId; a Slack thread destination requires the durable Slack thread locator.",
      path: ["destinationKind"],
    });
  }
}

function validateRoutineRunScheduledFor(
  value: {
    failureCode: string | null;
    scheduledFor: number;
    status: (typeof CENTER_AGENT_ROUTINE_RUN_STATUSES)[number];
  },
  context: zod.RefinementCtx
): void {
  if (
    value.scheduledFor >= 0 ||
    (value.status === "skipped" &&
      value.failureCode === "routine.schedule_invalid")
  ) {
    return;
  }
  context.addIssue({
    code: "custom",
    message:
      "A negative Run scheduledFor is reserved for invalid-schedule quarantine evidence.",
    path: ["scheduledFor"],
  });
}
