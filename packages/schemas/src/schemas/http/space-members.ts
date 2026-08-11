import { z } from "zod/v4";
import { agentControllerPermissionModeSchema } from "../agent-controller-permission-mode";
import {
  agentProfileIdSchema,
  openMeldRuntimeProfileIdSchema,
  profileWorkingDirectorySchema,
  uuidProfileIdSchema,
} from "../protocol/profile";
import {
  agentExecutionReadinessSchema,
  agentWakeAvailabilitySchema,
  agentWakeRouteRegistrationSchema,
  wakeRouteEvidenceSchema,
  wakeRouteStatusSchema,
} from "./agent-execution-readiness";
import { agentProfileBindingModelSelectionSchema } from "./agent-profile-binding";
import {
  spaceMentionLabelSchema,
  spaceMentionLabelSourceSchema,
} from "./space-mention-label";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const MAX_SPACE_MEMBERS_BATCH_SIZE = 100;

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const profileIdSchema = openMeldRuntimeProfileIdSchema;
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);
const nullableRuntimeProfileIdSchema = z.union([profileIdSchema, z.null()]);
const nullableIsoDateTimeSchema = z.union([ISO_DATE_TIME_SCHEMA, z.null()]);
const retiredAgentSnapshotKeys = new Set([
  "agentExecutionReadiness",
  "daemonRouteObservation",
  "publicReplyPresence",
  "publicPresence",
  "viewerLocalControl",
  "viewerLocalRecovery",
  "wakeState",
  "wakeability",
]);

const rejectRetiredAgentSnapshotKeysSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (!(value && typeof value === "object")) {
      return;
    }

    for (const key of retiredAgentSnapshotKeys) {
      if (!Object.hasOwn(value, key)) {
        continue;
      }
      ctx.addIssue({
        code: "custom",
        message: `retired agent member field is not allowed: ${key}`,
        path: [key],
      });
    }
  });

function validateRuntimeProfileIdForMemberKind(input: {
  profileId: string;
  profileKind: "human" | "agent";
  ctx: z.core.$RefinementCtx<unknown>;
  path: string[];
}): void {
  const expectedSchema =
    input.profileKind === "human" ? uuidProfileIdSchema : agentProfileIdSchema;

  if (expectedSchema.safeParse(input.profileId).success) {
    return;
  }

  input.ctx.addIssue({
    code: "custom",
    message:
      input.profileKind === "human"
        ? "human profileId must be a UUID"
        : "agent profileId must use agt_<UUID>",
    path: input.path,
  });
}

export const spaceMemberKindSchema = z.enum(["human", "agent"]);
export const spaceMemberStatusSchema = z.enum(["active", "removed"]);
export const spaceMemberSourceSchema = z.enum([
  "space_creator",
  "joined_directly",
  "added_by_member",
  "backfilled",
]);
export const spaceMemberAgentExecutionReadinessSchema =
  agentExecutionReadinessSchema;
export const spaceMemberAgentWakeAvailabilitySchema =
  agentWakeAvailabilitySchema;
export const spaceMemberAgentOwnerWakeDiagnosticsSchema = z.object({
  state: z.enum(["none", "checking_wake_status", "action_required"]),
  agentExecutionReadiness: spaceMemberAgentExecutionReadinessSchema,
  agentWakeRouteRegistration: agentWakeRouteRegistrationSchema,
  wakeRouteEvidence: wakeRouteEvidenceSchema,
  wakeRouteStatus: wakeRouteStatusSchema,
});

const baseSpaceMemberSnapshotSchema = z.object({
  profileId: profileIdSchema,
  profileName: trimmedNonEmptyStringSchema,
  profileKind: spaceMemberKindSchema,
  status: spaceMemberStatusSchema,
  memberSource: spaceMemberSourceSchema,
  memberSourceLabel: trimmedNonEmptyStringSchema,
  addedAt: ISO_DATE_TIME_SCHEMA,
  removedAt: nullableIsoDateTimeSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
  addedByProfileId: nullableRuntimeProfileIdSchema,
  addedByOwnerUserId: nullableTrimmedStringSchema,
  addedByDisplayName: nullableTrimmedStringSchema,
  removedByProfileId: nullableRuntimeProfileIdSchema,
  removedByOwnerUserId: nullableTrimmedStringSchema,
  removalReason: nullableTrimmedStringSchema,
  firstEnteredAt: nullableIsoDateTimeSchema,
  lastEnteredAt: nullableIsoDateTimeSchema,
  lastSeenAt: nullableIsoDateTimeSchema,
  lastSeenLabel: nullableTrimmedStringSchema,
  liveNow: z.boolean(),
  avatarUrl: nullableTrimmedStringSchema.optional(),
});

export const spaceMemberHumanSnapshotSchema = baseSpaceMemberSnapshotSchema
  .extend({
    profileKind: z.literal("human"),
    mentionAlias: nullableTrimmedStringSchema,
    ownerUserId: nullableTrimmedStringSchema,
    ownerName: nullableTrimmedStringSchema,
  })
  .superRefine((value, ctx) => {
    validateRuntimeProfileIdForMemberKind({
      profileId: value.profileId,
      profileKind: "human",
      ctx,
      path: ["profileId"],
    });
  });

export const spaceMemberAgentSnapshotSchema =
  rejectRetiredAgentSnapshotKeysSchema.pipe(
    baseSpaceMemberSnapshotSchema
      .extend({
        profileKind: z.literal("agent"),
        mentionAlias: nullableTrimmedStringSchema,
        ownerUserId: nullableTrimmedStringSchema,
        ownerName: nullableTrimmedStringSchema,
        agentControllerRef: nullableTrimmedStringSchema,
        agentControllerPermissionMode:
          agentControllerPermissionModeSchema.optional(),
        runtimeDeviceDisplayName: nullableTrimmedStringSchema.optional(),
        agentControllerConversationId: nullableTrimmedStringSchema,
        modelSelection: agentProfileBindingModelSelectionSchema.optional(),
        workingDirectory: profileWorkingDirectorySchema.nullable().optional(),
        agentWakeAvailability:
          spaceMemberAgentWakeAvailabilitySchema.optional(),
        ownerWakeDiagnostics: z
          .union([spaceMemberAgentOwnerWakeDiagnosticsSchema, z.null()])
          .optional(),
      })
      .superRefine((value, ctx) => {
        validateRuntimeProfileIdForMemberKind({
          profileId: value.profileId,
          profileKind: "agent",
          ctx,
          path: ["profileId"],
        });
      })
  );

export const spaceMembersSummarySchema = z.object({
  totalCount: z.number().int().min(0),
  humanCount: z.number().int().min(0),
  agentCount: z.number().int().min(0),
  liveNowCount: z.number().int().min(0),
  wakeableAgentCount: z.number().int().min(0).optional(),
  checkingAgentCount: z.number().int().min(0).optional(),
  offlineAgentCount: z.number().int().min(0).optional(),
  unavailableAgentCount: z.number().int().min(0).optional(),
});

export const spaceMembersSnapshotSchema = z
  .object({
    spaceId: trimmedNonEmptyStringSchema,
    generatedAt: ISO_DATE_TIME_SCHEMA,
    summary: spaceMembersSummarySchema,
    humans: z.array(spaceMemberHumanSnapshotSchema),
    agents: z.array(spaceMemberAgentSnapshotSchema),
  })
  .superRefine((value, ctx) => {
    const totalCount = value.humans.length + value.agents.length;
    const liveNowCount = [...value.humans, ...value.agents].filter(
      (item) => item.liveNow
    ).length;
    const wakeableAgentCount = value.agents.filter(
      isPublicWakeableAgent
    ).length;
    const checkingAgentCount = value.agents.filter(
      isPublicCheckingAgent
    ).length;
    const offlineAgentCount = value.agents.filter(isPublicOfflineAgent).length;
    const unavailableAgentCount = value.agents.filter(
      isPublicUnavailableAgent
    ).length;

    addSummaryMismatchIssue({
      ctx,
      actual: totalCount,
      expected: value.summary.totalCount,
      path: ["summary", "totalCount"],
      label: "totalCount",
    });
    addSummaryMismatchIssue({
      ctx,
      actual: value.humans.length,
      expected: value.summary.humanCount,
      path: ["summary", "humanCount"],
      label: "humanCount",
    });
    addSummaryMismatchIssue({
      ctx,
      actual: value.agents.length,
      expected: value.summary.agentCount,
      path: ["summary", "agentCount"],
      label: "agentCount",
    });
    addSummaryMismatchIssue({
      ctx,
      actual: liveNowCount,
      expected: value.summary.liveNowCount,
      path: ["summary", "liveNowCount"],
      label: "liveNowCount",
    });
    if (value.summary.wakeableAgentCount !== undefined) {
      addSummaryMismatchIssue({
        ctx,
        actual: wakeableAgentCount,
        expected: value.summary.wakeableAgentCount,
        path: ["summary", "wakeableAgentCount"],
        label: "wakeableAgentCount",
      });
    }
    if (value.summary.checkingAgentCount !== undefined) {
      addSummaryMismatchIssue({
        ctx,
        actual: checkingAgentCount,
        expected: value.summary.checkingAgentCount,
        path: ["summary", "checkingAgentCount"],
        label: "checkingAgentCount",
      });
    }
    if (value.summary.offlineAgentCount !== undefined) {
      addSummaryMismatchIssue({
        ctx,
        actual: offlineAgentCount,
        expected: value.summary.offlineAgentCount,
        path: ["summary", "offlineAgentCount"],
        label: "offlineAgentCount",
      });
    }
    if (value.summary.unavailableAgentCount !== undefined) {
      addSummaryMismatchIssue({
        ctx,
        actual: unavailableAgentCount,
        expected: value.summary.unavailableAgentCount,
        path: ["summary", "unavailableAgentCount"],
        label: "unavailableAgentCount",
      });
    }
  });

export const spaceViewerMembershipProfileSchema = z.strictObject({
  profileId: profileIdSchema,
  profileKind: spaceMemberKindSchema,
  profileName: trimmedNonEmptyStringSchema,
  lastEnteredAt: nullableIsoDateTimeSchema,
});

export const spaceViewerMembershipResponseSchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  activeMemberProfiles: z.array(spaceViewerMembershipProfileSchema),
  preferredOpenProfileId: nullableRuntimeProfileIdSchema,
});

export const spaceIdentityDirectoryEntrySchema = z
  .strictObject({
    profileId: profileIdSchema,
    profileName: trimmedNonEmptyStringSchema,
    profileKind: spaceMemberKindSchema,
    mentionAlias: nullableTrimmedStringSchema,
    ownerUserId: nullableTrimmedStringSchema,
    ownerName: nullableTrimmedStringSchema,
    agentControllerRef: nullableTrimmedStringSchema,
  })
  .superRefine((value, ctx) => {
    validateRuntimeProfileIdForMemberKind({
      profileId: value.profileId,
      profileKind: value.profileKind,
      ctx,
      path: ["profileId"],
    });
  });

export const spaceIdentityDirectorySchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  entries: z.array(spaceIdentityDirectoryEntrySchema),
});

const currentSpaceMemberDirectoryAllowedRelationsSchema = z.strictObject({
  wake: z.boolean(),
  reference: z.boolean(),
});

export const spaceMemberDirectoryAllowedRelationsSchema = z.preprocess(
  (value) => {
    if (!(value && typeof value === "object") || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.cc !== "boolean") {
      return value;
    }
    const { cc: _legacyCc, ...currentRelations } = record;
    return currentRelations;
  },
  currentSpaceMemberDirectoryAllowedRelationsSchema
);

export const spaceMemberDirectoryCardSchema = z.strictObject({
  role: nullableTrimmedStringSchema,
  roleDescription: nullableTrimmedStringSchema,
});

export const spaceMemberDirectoryEntrySchema = z
  .strictObject({
    profileId: profileIdSchema,
    profileKind: spaceMemberKindSchema,
    displayName: trimmedNonEmptyStringSchema,
    primaryMentionLabel: spaceMentionLabelSchema,
    mentionLabels: z.array(spaceMentionLabelSchema).min(1),
    mentionAlias: nullableTrimmedStringSchema,
    labelSource: spaceMentionLabelSourceSchema,
    lookupTokens: z.array(trimmedNonEmptyStringSchema).min(1),
    preferredLookupToken: trimmedNonEmptyStringSchema,
    profileIdShort: trimmedNonEmptyStringSchema,
    allowedRelations: spaceMemberDirectoryAllowedRelationsSchema,
    ownerUserId: nullableTrimmedStringSchema,
    ownerName: nullableTrimmedStringSchema,
    agentCard: z.union([spaceMemberDirectoryCardSchema, z.null()]),
    spaceRole: z.union([spaceMemberDirectoryCardSchema, z.null()]),
  })
  .superRefine((value, ctx) => {
    validateRuntimeProfileIdForMemberKind({
      profileId: value.profileId,
      profileKind: value.profileKind,
      ctx,
      path: ["profileId"],
    });
    if (
      value.primaryMentionLabel &&
      !value.mentionLabels.includes(value.primaryMentionLabel)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "primaryMentionLabel must be included in mentionLabels",
        path: ["primaryMentionLabel"],
      });
    }
    if (value.profileKind === "human" && value.allowedRelations.wake) {
      ctx.addIssue({
        code: "custom",
        message: "human members cannot support Wake",
        path: ["allowedRelations", "wake"],
      });
    }
  });

export const spaceMemberDirectorySchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  members: z.array(spaceMemberDirectoryEntrySchema),
});

export const postSpaceMembersBodySchema = z.strictObject({
  memberProfileIds: z
    .array(profileIdSchema)
    .min(1)
    .max(MAX_SPACE_MEMBERS_BATCH_SIZE),
});

export const addCenterAgentToSpaceBodySchema = z.strictObject({
  expectedCenterAgentProfileId: agentProfileIdSchema,
});

export const addOrganizationDirectoryProfilesToSpaceBodySchema = z
  .strictObject({
    directoryProfileIds: z
      .array(profileIdSchema)
      .min(1)
      .max(MAX_SPACE_MEMBERS_BATCH_SIZE),
    expectedCenterAgentProfileId: agentProfileIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.directoryProfileIds).size !==
      value.directoryProfileIds.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "directoryProfileIds must not contain duplicates",
        path: ["directoryProfileIds"],
      });
    }
    if (
      value.expectedCenterAgentProfileId &&
      !value.directoryProfileIds.includes(value.expectedCenterAgentProfileId)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "expectedCenterAgentProfileId must be included in directoryProfileIds",
        path: ["expectedCenterAgentProfileId"],
      });
    }
  });

export const removeSpaceMembersBodySchema = z.strictObject({
  memberProfileIds: z
    .array(profileIdSchema)
    .min(1)
    .max(MAX_SPACE_MEMBERS_BATCH_SIZE),
});

export const resolvedSpaceMemberProfileSchema = z
  .strictObject({
    profileId: profileIdSchema,
    profileName: trimmedNonEmptyStringSchema,
    profileKind: spaceMemberKindSchema,
    ownerUserId: nullableTrimmedStringSchema,
    ownerName: nullableTrimmedStringSchema,
    agentControllerRef: nullableTrimmedStringSchema,
  })
  .superRefine((value, ctx) => {
    validateRuntimeProfileIdForMemberKind({
      profileId: value.profileId,
      profileKind: value.profileKind,
      ctx,
      path: ["profileId"],
    });
  });

export const postResolvedSpaceMembersBodySchema = z.strictObject({
  members: z
    .array(resolvedSpaceMemberProfileSchema)
    .min(1)
    .max(MAX_SPACE_MEMBERS_BATCH_SIZE),
});

export const postSpaceMembersResponseSchema = z.strictObject({
  addedMemberIds: z.array(profileIdSchema),
  alreadyMemberIds: z.array(profileIdSchema),
  items: z.array(
    z.union([spaceMemberHumanSnapshotSchema, spaceMemberAgentSnapshotSchema])
  ),
});

export const removeSpaceMembersResponseSchema = z.strictObject({
  removedMemberIds: z.array(profileIdSchema),
  alreadyAbsentMemberIds: z.array(profileIdSchema),
});

export const leaveSpaceResponseSchema = z.strictObject({
  leftProfileId: profileIdSchema,
  status: z.enum(["left", "already_absent"]),
});

function addSummaryMismatchIssue(input: {
  ctx: z.core.$RefinementCtx<z.output<typeof spaceMembersSnapshotSchema>>;
  actual: number;
  expected: number;
  path: string[];
  label: string;
}): void {
  if (input.actual === input.expected) {
    return;
  }

  input.ctx.addIssue({
    code: "custom",
    message: `${input.label} must match derived member counts`,
    path: input.path,
  });
}

function isPublicWakeableAgent(
  agent: z.output<typeof spaceMemberAgentSnapshotSchema>
): boolean {
  return agent.agentWakeAvailability?.status === "available_for_wake";
}

function isPublicCheckingAgent(
  agent: z.output<typeof spaceMemberAgentSnapshotSchema>
): boolean {
  return agent.agentWakeAvailability?.status === "checking_connection";
}

function isPublicOfflineAgent(
  agent: z.output<typeof spaceMemberAgentSnapshotSchema>
): boolean {
  return agent.agentWakeAvailability?.status === "offline_for_wake";
}

function isPublicUnavailableAgent(
  agent: z.output<typeof spaceMemberAgentSnapshotSchema>
): boolean {
  return agent.agentWakeAvailability?.status === "unavailable_for_wake";
}
