import { z } from "zod/v4";
import { computerSetupModeSchema } from "../../navigation-action";
import { DISPATCH_ERROR_SUMMARY_MAX_LENGTH } from "../../public-agent-failure-reason";
import { agentControllerRefSchema } from "../daemon/agent-controller-ref";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import {
  signalEnvelopeSchema,
  signalTextEnvelopeSchema,
} from "../protocol/envelope";
import {
  agentProfileIdSchema,
  openMeldRuntimeProfileIdSchema,
  profileSchema,
  profileWorkingDirectorySchema,
  profileWorkspaceModeSchema,
} from "../protocol/profile";
import {
  agentTaskCompletionConditionSchema,
  agentTaskCompletionObservationSchema,
  agentTaskHandleSchema,
  agentTaskTerminalOutcomeSchema,
  controllerAgentTaskHandleSchema,
  spaceWakeAgentTaskHandleSchema,
} from "../runtime/agent-task-coordination";
import {
  centerAgentModelChoiceSchema,
  centerAgentModelPreferenceSchema,
  centerAgentModelSummarySchema,
} from "../runtime/center-agent-model";
import {
  slackMessagePermalinkSchema,
  slackThreadPublicationPermalinkSchema,
} from "../runtime/message-channel";
import { remoteAgentSlackSearchAuthorizationSchema } from "../runtime/remote-agent-turn-envelope";
import { spaceThreadContextSchema } from "../space-mesh/space-thread";
import { getAgentExecutionReadinessResponseSchema } from "./agent-execution-readiness";
import {
  agentProfileBindingAgentControllerCollaborationModeSchema,
  agentProfileBindingAgentControllerPermissionModeSchema,
  agentProfileBindingOpenCodePermissionSchema,
  ensureAgentProfilePrimaryBindingResponseSchema,
} from "./agent-profile-binding";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";
import {
  connectorConnectionNameSchema,
  connectorConnectionScopeSchema,
  connectorServiceSchema,
} from "./connector-connections";
import { setCurrentAgentProfileWorkspaceResponseSchema } from "./local-runtimes";
import { organizationComputersResponseSchema } from "./organization-computers";
import { ownerComputerDiagnosticsSchema } from "./owner-computer-diagnostics";
import { prepareReadinessRuntimeIdSchema } from "./prepare-readiness";
import { authProfileViewSchema } from "./profiles";
import { agentControllerTaskLifecycleEventSourceSchema } from "./runtime-reporting";
import {
  spaceAccessModeSchema,
  spaceAccessModeStateSchema,
} from "./space-access-mode";
import { spaceBootstrapResponseSchema } from "./space-bootstrap";
import { createSpaceBodySchema } from "./space-create";
import {
  spaceDispatchTraceAttemptStatusSchema,
  spaceDispatchTraceDispatchStatusSchema,
} from "./space-dispatch-trace";
import { spaceMessageFileReferencesSchema } from "./space-files";
import {
  postSpaceMembersResponseSchema,
  removeSpaceMembersResponseSchema,
} from "./space-members";
import { spaceMetaSchema } from "./space-meta";
import { spacePasswordSchema } from "./space-password";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);
const nullableIsoDateTimeSchema = z.union([ISO_DATE_TIME_SCHEMA, z.null()]);
// errorMessage carries a bounded, sanitized vendor-error summary for the
// designated Center Agent caller. Raw provider payloads must never cross this
// contract or be republished into a public Space notice.
const nullableDiagnosticTextSchema = z.union([
  trimmedNonEmptyStringSchema.max(DISPATCH_ERROR_SUMMARY_MAX_LENGTH),
  z.null(),
]);
const CENTER_AGENT_REFERENCE_OVERLAP_MESSAGE =
  "A profile cannot be both a Wake target and a Reference target.";

function findCenterAgentReferenceOverlapIndex(input: {
  activationTargets: readonly string[];
  fallbackAgentProfileId?: string | null;
  referenceTargets?: readonly string[];
}): number | undefined {
  const executableProfileIds = new Set(input.activationTargets);
  if (input.fallbackAgentProfileId) {
    executableProfileIds.add(input.fallbackAgentProfileId);
  }
  return input.referenceTargets?.findIndex((profileId) =>
    executableProfileIds.has(profileId)
  );
}

export const centerAgentActionSchema = z.enum([
  "create_space",
  "create_agent_profile",
  "enable_agent_profile",
  "invite_member",
  "carry_over_binding_authorization",
  "designate_remote_center_agent",
  "authorize_remote_center_agent_binding",
  "revoke_center_agent",
  "pause_center_agent",
  "resume_center_agent",
  "connect_slack_workspace",
  "move_slack_workspace",
  "disconnect_slack_workspace",
  "disconnect_message_channel_identity_link",
  "replace_message_channel_identity_link",
  "start_shared_app_authorization",
  "disconnect_shared_app",
  "add_members_to_space",
  "add_agent_profiles_to_space",
  "post_slack_channel_message",
  "list_slack_channels",
  "read_slack_channel_members",
  "read_slack_channel_history",
  "search_slack_messages",
  "post_space_message",
  "remove_agent_profiles_from_space",
  "read_org_directory",
  "read_member_computers",
  "read_member_openmeld_service_status",
  "read_slack_workspace_directory",
  "read_org_documents",
  "read_org_skills",
  "preview_org_skill",
  "install_org_skill",
  "create_org_document_folder",
  "rename_org_document_folder",
  "move_org_document",
  "save_org_document",
  "read_org_space_directory",
  "read_space_context",
  "read_dispatch_history",
  "read_projects",
  "create_project",
  "update_project",
  "set_agent_profile_default_project",
  "prepare_remove_project",
  "remove_project",
  "update_space_settings",
  "wake_agent_profiles_in_space",
  "read_agent_tasks",
  "watch_agent_task",
  "draft_org_document",
  "research_member",
  "execute_connector_action",
  "complete_connector_action",
  "fail_connector_action",
  "record_connector_action_outcome_unknown",
  "receive_local_agent_request",
  "read_center_agent_context",
  "load_center_agent_context",
  "create_routine",
  "update_routine",
  "pause_routine",
  "resume_routine",
  "delete_routine",
  "set_working_language",
  "observe_working_language",
]);

export const centerAgentConnectorActionAuditOutcomeSchema = z.enum([
  "attempted",
  "completed",
  "failed",
  "outcome_unknown",
]);

export const centerAgentRecordConnectorActionAuditBodySchema = z.strictObject({
  actionId: trimmedNonEmptyStringSchema.max(160),
  operationId: trimmedNonEmptyStringSchema.max(256),
  outcome: centerAgentConnectorActionAuditOutcomeSchema,
  service: connectorServiceSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});

export const centerAgentResourceSchema = z.strictObject({
  type: trimmedNonEmptyStringSchema,
  id: trimmedNonEmptyStringSchema,
});

export const centerAgentOnBehalfOfInputSchema = z.strictObject({
  profileId: openMeldRuntimeProfileIdSchema,
});

export const centerAgentAttributionSchema = z.strictObject({
  actorProfileId: agentProfileIdSchema,
  onBehalfOf: z
    .strictObject({
      profileId: openMeldRuntimeProfileIdSchema,
      userId: nullableTrimmedStringSchema,
      displayName: trimmedNonEmptyStringSchema,
    })
    .nullable(),
});

export const centerAgentRecordConnectorActionAuditResponseSchema =
  z.strictObject({
    attribution: centerAgentAttributionSchema,
    recorded: z.literal(true),
  });

export const centerAgentConnectorActionOperationStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "outcome_unknown",
]);

export const centerAgentConnectorActionExecutionConnectionSchema =
  z.strictObject({
    connectionName: connectorConnectionNameSchema,
    ownerDisplayName: trimmedNonEmptyStringSchema,
    ownerUserId: trimmedNonEmptyStringSchema,
    scope: connectorConnectionScopeSchema,
    service: connectorServiceSchema,
  });

export const centerAgentReadConnectorActionOperationBodySchema = z.strictObject(
  {
    actionId: trimmedNonEmptyStringSchema.max(160),
    operationId: trimmedNonEmptyStringSchema.max(256),
    service: connectorServiceSchema,
    speakerMember: centerAgentToolSpeakerSchema,
  }
);

const centerAgentConnectorActionOperationSchema = z
  .strictObject({
    actionId: trimmedNonEmptyStringSchema.max(160),
    connectionName: connectorConnectionNameSchema,
    executionConnection: centerAgentConnectorActionExecutionConnectionSchema
      .nullable()
      .optional(),
    operationId: trimmedNonEmptyStringSchema.max(256),
    service: connectorServiceSchema,
    status: centerAgentConnectorActionOperationStatusSchema,
  })
  .superRefine((value, context) => {
    if (
      value.executionConnection &&
      (value.executionConnection.connectionName !== value.connectionName ||
        value.executionConnection.service !== value.service)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "executionConnection must match the connector action operation.",
        path: ["executionConnection"],
      });
    }
  });

export const centerAgentReadConnectorActionOperationResponseSchema =
  z.strictObject({
    operation: centerAgentConnectorActionOperationSchema.nullable(),
  });

export const centerAgentRecordConnectorActionOperationBodySchema = z
  .strictObject({
    actionId: trimmedNonEmptyStringSchema.max(160),
    connectionName: connectorConnectionNameSchema,
    operationId: trimmedNonEmptyStringSchema.max(256),
    outcome: centerAgentConnectorActionAuditOutcomeSchema,
    providerExecutionId: nullableTrimmedStringSchema,
    requestSignature: z.string().regex(/^[0-9a-f]{64}$/),
    service: connectorServiceSchema,
    sourceSpaceId: trimmedNonEmptyStringSchema.max(128).nullable().optional(),
    speakerMember: centerAgentToolSpeakerSchema,
  })
  .superRefine((value, context) => {
    if (value.outcome === "attempted" && value.providerExecutionId !== null) {
      context.addIssue({
        code: "custom",
        message:
          "providerExecutionId must be null while claiming a connector action operation.",
        path: ["providerExecutionId"],
      });
    }
  });

export const centerAgentRecordConnectorActionOperationResponseSchema =
  z.strictObject({
    attribution: centerAgentAttributionSchema,
    executionConnection: centerAgentConnectorActionExecutionConnectionSchema
      .nullable()
      .optional(),
    operationId: trimmedNonEmptyStringSchema.max(256),
    providerExecutionId: nullableTrimmedStringSchema,
    recorded: z.literal(true),
    replayed: z.boolean(),
    status: centerAgentConnectorActionOperationStatusSchema,
  });

export const centerAgentDesignationSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  agentProfileId: agentProfileIdSchema,
  duty: z.null(),
  designatedBy: trimmedNonEmptyStringSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
});

export const centerAgentModelConfigurationResponseSchema = z.strictObject({
  canManage: z.boolean(),
  choices: z.array(centerAgentModelChoiceSchema).min(1),
  configurationRevision: z.number().int().nonnegative(),
  effectiveModel: centerAgentModelSummarySchema,
  organizationId: trimmedNonEmptyStringSchema,
  preference: centerAgentModelPreferenceSchema,
});

export const updateCenterAgentModelBodySchema = z.strictObject({
  expectedConfigurationRevision: z.number().int().nonnegative(),
  preference: centerAgentModelPreferenceSchema,
});

export const updateCenterAgentModelResponseSchema =
  centerAgentModelConfigurationResponseSchema.extend({
    changed: z.boolean(),
  });

export const centerAgentRemoteRuntimeAvailabilityReasonCodeSchema = z.enum([
  "remote_runtime_disabled",
  "organization_blocked",
  "remote_runtime_policy_unavailable",
]);

export const centerAgentRemoteRuntimeAvailabilitySchema = z.strictObject({
  selectable: z.boolean(),
  reasonCode: centerAgentRemoteRuntimeAvailabilityReasonCodeSchema.optional(),
});

export const centerAgentSlackWorkspaceConnectionSchema = z.strictObject({
  connected: z.boolean(),
  directMessagesReady: z.boolean().optional(),
  slackTeamId: nullableTrimmedStringSchema,
  workspaceName: nullableTrimmedStringSchema,
});

export const getCenterAgentDesignationResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  designation: centerAgentDesignationSchema.nullable(),
  remoteRuntimeAvailability:
    centerAgentRemoteRuntimeAvailabilitySchema.optional(),
  slackConnection: centerAgentSlackWorkspaceConnectionSchema.optional(),
});

export const centerAgentSlackWorkspaceConnectBodySchema = z.strictObject({
  slackTeamId: trimmedNonEmptyStringSchema,
});

export const centerAgentSlackWorkspaceConnectionResponseSchema = z.strictObject(
  {
    organizationId: trimmedNonEmptyStringSchema,
    slackConnection: centerAgentSlackWorkspaceConnectionSchema,
  }
);

export const centerAgentSlackWorkspaceDisconnectResponseSchema = z.strictObject(
  {
    disconnected: z.boolean(),
    organizationId: trimmedNonEmptyStringSchema,
    slackConnection: centerAgentSlackWorkspaceConnectionSchema,
  }
);

export const slackIdentityLinkTokenSchema = z
  .string()
  .trim()
  .regex(/^slacklink_[0-9a-f]{64}$/);

export const slackIdentityLinkPreviewBodySchema = z.strictObject({
  token: slackIdentityLinkTokenSchema,
});

export const slackIdentityLinkPreviewResponseSchema = z.strictObject({
  alreadyMember: z.boolean().default(true),
  continuesRequest: z.boolean().default(true),
  expiresAt: ISO_DATE_TIME_SCHEMA,
  organizationId: trimmedNonEmptyStringSchema,
  organizationName: trimmedNonEmptyStringSchema,
  slackAccountEmail: z.email().nullable().default(null),
  slackDisplayName: trimmedNonEmptyStringSchema,
  slackTeamId: trimmedNonEmptyStringSchema,
  slackUserId: trimmedNonEmptyStringSchema,
  slackWorkspaceLabel: trimmedNonEmptyStringSchema,
  openMeldAccountEmail: trimmedNonEmptyStringSchema,
  replacesExistingLink: z.boolean().default(false),
});

export const slackIdentityLinkConsumeBodySchema = z.strictObject({
  includeReturnTarget: z.literal(true).optional(),
  token: slackIdentityLinkTokenSchema,
});

export const slackIdentityLinkConsumeResponseSchema = z.strictObject({
  continuationRetryable: z.boolean().default(false),
  continued: z.boolean().default(false),
  joinedOrganization: z.boolean().default(false),
  linked: z.literal(true),
  openMeldProfileId: trimmedNonEmptyStringSchema.nullable().default(null),
  organizationId: trimmedNonEmptyStringSchema,
  organizationName: trimmedNonEmptyStringSchema,
  organizationSlug: trimmedNonEmptyStringSchema.nullable().default(null),
  slackDisplayName: trimmedNonEmptyStringSchema,
  slackTeamId: trimmedNonEmptyStringSchema,
  slackThreadPermalink: slackMessagePermalinkSchema.nullable().optional(),
  slackUserId: trimmedNonEmptyStringSchema,
  replacedExistingLink: z.boolean().default(false),
  openMeldUserId: trimmedNonEmptyStringSchema,
});

export const ensureSlackWorkspaceMemberOrganizationMembershipRpcInputSchema =
  z.strictObject({
    organizationId: trimmedNonEmptyStringSchema,
    userId: trimmedNonEmptyStringSchema,
  });

export const ensureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      alreadyMember: z.boolean(),
      ok: z.literal(true),
      organizationId: trimmedNonEmptyStringSchema,
      organizationName: trimmedNonEmptyStringSchema,
      organizationSlug: trimmedNonEmptyStringSchema,
      role: z.enum(["owner", "admin", "member"]),
    }),
    z.strictObject({
      code: z.enum([
        "slack.workspace_member_enrollment.account_unavailable",
        "slack.workspace_member_enrollment.invalid_input",
        "slack.workspace_member_enrollment.email_verification_required",
        "slack.workspace_member_enrollment.organization_inactive",
        "slack.workspace_member_enrollment.personal_organization",
      ]),
      message: trimmedNonEmptyStringSchema,
      ok: z.literal(false),
    }),
  ]);

export const ensureMessageChannelMemberOrganizationMembershipRpcInputSchema =
  z.strictObject({
    organizationId: trimmedNonEmptyStringSchema,
    provider: z.enum(["feishu", "lark", "slack"]),
    userId: trimmedNonEmptyStringSchema,
  });

export const ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      alreadyMember: z.boolean(),
      ok: z.literal(true),
      organizationId: trimmedNonEmptyStringSchema,
      organizationName: trimmedNonEmptyStringSchema,
      organizationSlug: trimmedNonEmptyStringSchema,
      role: z.enum(["owner", "admin", "member"]),
    }),
    z.strictObject({
      code: z.enum([
        "message_channel.member_enrollment.account_unavailable",
        "message_channel.member_enrollment.email_verification_required",
        "message_channel.member_enrollment.invalid_input",
        "message_channel.member_enrollment.organization_inactive",
        "message_channel.member_enrollment.personal_organization",
      ]),
      message: trimmedNonEmptyStringSchema,
      ok: z.literal(false),
    }),
  ]);

export const designateCenterAgentBodySchema = z.strictObject({
  agentProfileId: agentProfileIdSchema.optional(),
  runtime: z.enum(["self_hosted", "remote_agent"]).default("self_hosted"),
});

export const designateCenterAgentResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  designation: centerAgentDesignationSchema,
  status: z.enum(["designated", "replaced", "unchanged"]),
});

export const centerAgentOperatingStateSchema = z.enum(["active", "paused"]);

export const getCenterAgentOperatingStateResponseSchema = z.strictObject({
  canChangeOperatingState: z.boolean(),
  operatingState: centerAgentOperatingStateSchema,
  organizationId: trimmedNonEmptyStringSchema,
  pausedAt: nullableIsoDateTimeSchema,
});

export const updateCenterAgentOperatingStateBodySchema = z.strictObject({
  operatingState: centerAgentOperatingStateSchema,
});

export const updateCenterAgentOperatingStateResponseSchema =
  getCenterAgentOperatingStateResponseSchema.extend({
    affectedTaskCount: z.number().int().nonnegative(),
    changed: z.boolean(),
  });

export const centerAgentUpdateProfileBodySchema = z.strictObject({
  profileName: trimmedNonEmptyStringSchema,
});

export const centerAgentUpdateProfileResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  profile: authProfileViewSchema,
});

export const centerAgentAuditJournalEntrySchema = z.strictObject({
  id: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  actorProfileId: openMeldRuntimeProfileIdSchema,
  action: centerAgentActionSchema,
  onBehalfOf: z
    .strictObject({
      profileId: openMeldRuntimeProfileIdSchema,
      userId: nullableTrimmedStringSchema,
      displayName: trimmedNonEmptyStringSchema,
    })
    .nullable(),
  interactionSource: z
    .strictObject({
      client: trimmedNonEmptyStringSchema.max(80),
      kind: z.literal("local_agent"),
    })
    .optional(),
  contextManifest: z
    .strictObject({
      estimatedTokens: z.number().int().nonnegative(),
      includedMessages: z.number().int().nonnegative(),
      truncated: z.boolean(),
    })
    .optional(),
  contextLoad: z
    .strictObject({
      estimatedTokens: z.number().int().nonnegative(),
      includedMessages: z.number().int().min(1).max(50),
      manifestId: trimmedNonEmptyStringSchema,
    })
    .optional(),
  resource: centerAgentResourceSchema.nullable(),
  sourceSpaceId: trimmedNonEmptyStringSchema.nullable().optional(),
  createdAt: ISO_DATE_TIME_SCHEMA,
});

export const listCenterAgentAuditJournalQuerySchema = z.strictObject({
  actionSet: z
    .enum([
      "v2",
      "v3",
      "v4",
      "v5",
      "v6",
      "v7",
      "v8",
      "v9",
      "v10",
      "v11",
      "v12",
      "v13",
      "v14",
      "v15",
      "v16",
      "v17",
      "v18",
      "v19",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const listCenterAgentAuditJournalResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  entries: z.array(centerAgentAuditJournalEntrySchema),
});

export const centerAgentCreateSpaceBodySchema = z
  .strictObject({
    name: z.unknown().optional(),
    purpose: z.unknown().optional(),
    guide: z.unknown().optional(),
    visibility: z.unknown().optional(),
    accessMode: z.unknown().optional(),
    password: z.unknown().optional(),
    onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
  })
  .transform((value, ctx) => {
    const { onBehalfOf, ...spaceBody } = value;
    const parsedSpaceBody = createSpaceBodySchema.safeParse(spaceBody);
    if (!parsedSpaceBody.success) {
      ctx.addIssue({
        code: "custom",
        message:
          parsedSpaceBody.error.issues[0]?.message ??
          "Invalid Center Agent Space payload",
      });
      return z.NEVER;
    }
    return {
      ...parsedSpaceBody.data,
      ...(onBehalfOf === undefined ? {} : { onBehalfOf }),
    };
  });

export const centerAgentCreateAgentProfileBodySchema = z.strictObject({
  profileName: trimmedNonEmptyStringSchema,
  onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
});

export const centerAgentEnableAgentProfileBodySchema = z.strictObject({
  onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
});

export const centerAgentAddAgentProfilesToSpaceBodySchema = z.strictObject({
  agentProfileIds: z.array(agentProfileIdSchema).min(1).max(100),
  onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
  password: trimmedNonEmptyStringSchema.optional(),
  spaceId: trimmedNonEmptyStringSchema,
});

export const centerAgentAddMembersToSpaceBodySchema = z.strictObject({
  memberUserIds: z.array(trimmedNonEmptyStringSchema).min(1).max(100),
  spaceId: trimmedNonEmptyStringSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});

export const centerAgentRemoveAgentProfilesFromSpaceBodySchema = z.strictObject(
  {
    agentProfileIds: z.array(agentProfileIdSchema).min(1).max(100),
    onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
    spaceId: trimmedNonEmptyStringSchema,
  }
);

export const centerAgentSpaceContextScopeSchema = z.enum([
  "source",
  "thread",
  "delta",
  "history",
]);

const centerAgentSpaceContextAnchorByScope = {
  delta: "afterSignalId",
  history: null,
  source: "sourceSignalId",
  thread: "threadId",
} as const;

export const centerAgentReadSpaceContextBodySchema = z
  .strictObject({
    afterSignalId: trimmedNonEmptyStringSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    scope: centerAgentSpaceContextScopeSchema.optional(),
    sourceSignalId: trimmedNonEmptyStringSchema.optional(),
    spaceId: trimmedNonEmptyStringSchema,
    threadId: trimmedNonEmptyStringSchema.optional(),
  })
  .superRefine((value, context) => {
    const requiredAnchor = value.scope
      ? centerAgentSpaceContextAnchorByScope[value.scope]
      : null;
    if (requiredAnchor && !value[requiredAnchor]) {
      context.addIssue({
        code: "custom",
        message: `${requiredAnchor} is required for ${value.scope} context.`,
        path: [requiredAnchor],
      });
    }

    for (const anchor of [
      "sourceSignalId",
      "threadId",
      "afterSignalId",
    ] as const) {
      if (value[anchor] && anchor !== requiredAnchor) {
        context.addIssue({
          code: "custom",
          message: `${anchor} is not valid for ${value.scope ?? "legacy"} context.`,
          path: [anchor],
        });
      }
    }
  });

// N is capped at 20: this tool exists for the Center Agent to diagnose one
// recent failure or in-flight Wake, not to browse full dispatch history.
export const centerAgentReadDispatchHistoryBodySchema = z.strictObject({
  dispatchId: trimmedNonEmptyStringSchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
  spaceId: trimmedNonEmptyStringSchema,
  targetProfileId: trimmedNonEmptyStringSchema.optional(),
});

export const centerAgentPostSpaceMessageBodySchema = z.strictObject({
  files: spaceMessageFileReferencesSchema.optional(),
  onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
  referenceProfileIds: z
    .array(openMeldRuntimeProfileIdSchema)
    .max(25)
    .optional(),
  spaceId: trimmedNonEmptyStringSchema,
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
});

const centerAgentRemoteAgentExecutionPublicationSourceSchema = z.strictObject({
  executionId: trimmedNonEmptyStringSchema.max(512),
  kind: z.literal("remote_agent_execution"),
});

export const centerAgentPublicationSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    documentId: trimmedNonEmptyStringSchema.max(256),
    kind: z.literal("organization_document"),
  }),
  centerAgentRemoteAgentExecutionPublicationSourceSchema,
  z.strictObject({
    kind: z.literal("routine_run"),
    runId: trimmedNonEmptyStringSchema.max(256),
  }),
]);

const centerAgentSlackMessageCommonBodyFields = {
  speakerMember: centerAgentToolSpeakerSchema,
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
};

export const centerAgentPostSlackChannelMessageBodySchema = z.strictObject({
  ...centerAgentSlackMessageCommonBodyFields,
  channelName: trimmedNonEmptyStringSchema.max(80),
  // Optional only for the existing top-level publication rollout. The current
  // Remote Agent always sends a system-bound source.
  publicationSource: centerAgentPublicationSourceSchema.optional(),
});

export const centerAgentPostSlackThreadMessageBodySchema = z.union([
  z.strictObject({
    ...centerAgentSlackMessageCommonBodyFields,
    publicationSource: centerAgentRemoteAgentExecutionPublicationSourceSchema,
    threadPermalink: slackThreadPublicationPermalinkSchema,
  }),
  // Compatibility receiver for an already-running older Remote Agent. The
  // current caller sends a trusted permalink and never sends a model-authored
  // channel/timestamp pair.
  z.strictObject({
    ...centerAgentSlackMessageCommonBodyFields,
    channelName: trimmedNonEmptyStringSchema.max(80),
    publicationSource: centerAgentRemoteAgentExecutionPublicationSourceSchema,
    threadTs: z
      .string()
      .trim()
      .regex(/^\d+\.\d+$/)
      .max(32),
  }),
]);

export const centerAgentSearchSlackMessagesBodySchema = z.strictObject({
  includeBots: z.boolean().optional(),
  query: trimmedNonEmptyStringSchema.max(500),
  searchAuthorization: remoteAgentSlackSearchAuthorizationSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});

export const CENTER_AGENT_DELEGATION_COMPLETION_MODES = [
  "child_reports_directly",
  "resume_parent_when_all_terminal",
  "resume_parent_when_first_success",
  "resume_parent_on_failure",
  "resume_parent_on_each_terminal",
] as const;

export const centerAgentDelegationCompletionModeSchema = z.enum(
  CENTER_AGENT_DELEGATION_COMPLETION_MODES
);

export const centerAgentWakeAgentProfilesInSpaceBodySchema = z
  .strictObject({
    agentProfileIds: z.array(agentProfileIdSchema).min(1).max(25),
    completionMode: centerAgentDelegationCompletionModeSchema.optional(),
    fallbackAgentProfileId: agentProfileIdSchema.optional(),
    onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
    referenceProfileIds: z
      .array(openMeldRuntimeProfileIdSchema)
      .max(25)
      .optional(),
    spaceId: trimmedNonEmptyStringSchema,
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  })
  .superRefine((value, context) => {
    const overlappingReferenceIndex = findCenterAgentReferenceOverlapIndex({
      activationTargets: value.agentProfileIds,
      fallbackAgentProfileId: value.fallbackAgentProfileId,
      referenceTargets: value.referenceProfileIds,
    });
    if (
      overlappingReferenceIndex !== undefined &&
      overlappingReferenceIndex >= 0
    ) {
      context.addIssue({
        code: "custom",
        message: CENTER_AGENT_REFERENCE_OVERLAP_MESSAGE,
        path: ["referenceProfileIds", overlappingReferenceIndex],
      });
    }
    if (!value.fallbackAgentProfileId) {
      return;
    }
    if (!value.completionMode) {
      context.addIssue({
        code: "custom",
        message:
          "completionMode is required when fallbackAgentProfileId is provided.",
        path: ["completionMode"],
      });
    }
    const primaryProfileIds = new Set(value.agentProfileIds);
    if (primaryProfileIds.has(value.fallbackAgentProfileId)) {
      context.addIssue({
        code: "custom",
        message: "fallbackAgentProfileId must differ from every primary Agent.",
        path: ["fallbackAgentProfileId"],
      });
    }
    if (primaryProfileIds.size !== 1) {
      context.addIssue({
        code: "custom",
        message:
          "Fallback activation currently requires exactly one primary Agent.",
        path: ["agentProfileIds"],
      });
    }
    if (value.completionMode === "resume_parent_on_each_terminal") {
      context.addIssue({
        code: "custom",
        message:
          "Fallback activation does not support resume_parent_on_each_terminal.",
        path: ["completionMode"],
      });
    }
  });

export const centerAgentWakePublicationCommandSchema = z
  .strictObject({
    activationTargets: z.array(agentProfileIdSchema).min(1),
    attribution: centerAgentAttributionSchema,
    clientMessageId: trimmedNonEmptyStringSchema,
    completionMode: centerAgentDelegationCompletionModeSchema,
    context: openMeldRequestContextSchema,
    delegationId: trimmedNonEmptyStringSchema,
    fallbackAgentProfileId: agentProfileIdSchema.nullable(),
    organizationId: trimmedNonEmptyStringSchema,
    parentSubmissionId: trimmedNonEmptyStringSchema,
    profile: profileSchema,
    referenceTargets: z
      .array(openMeldRuntimeProfileIdSchema)
      .max(25)
      .default([]),
    spaceId: trimmedNonEmptyStringSchema,
    subscriptionIds: z.array(trimmedNonEmptyStringSchema).min(1),
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    v: z.literal(1),
  })
  .superRefine((value, context) => {
    const overlappingReferenceIndex = findCenterAgentReferenceOverlapIndex({
      activationTargets: value.activationTargets,
      fallbackAgentProfileId: value.fallbackAgentProfileId,
      referenceTargets: value.referenceTargets,
    });
    if (
      overlappingReferenceIndex !== undefined &&
      overlappingReferenceIndex >= 0
    ) {
      context.addIssue({
        code: "custom",
        message: CENTER_AGENT_REFERENCE_OVERLAP_MESSAGE,
        path: ["referenceTargets", overlappingReferenceIndex],
      });
    }
  });

export const centerAgentWatchAgentTaskBodySchema = z.strictObject({
  completionCondition: agentTaskCompletionConditionSchema,
  instruction: z.string().trim().min(1).max(4000),
  task: agentTaskHandleSchema,
});

export const centerAgentListAgentTasksBodySchema = z.strictObject({
  agentControllerRef: agentControllerRefSchema.optional(),
  limit: z.int().min(1).max(20).optional(),
});

export const centerAgentUpdateSpaceSettingsBodySchema = z
  .strictObject({
    accessMode: spaceAccessModeSchema.optional(),
    guide: z.string().optional(),
    onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
    password: spacePasswordSchema.optional(),
    purpose: z.string().optional(),
    spaceId: trimmedNonEmptyStringSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.accessMode === undefined &&
      value.guide === undefined &&
      value.purpose === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Expected purpose, guide, or accessMode",
      });
    }
    if (value.password !== undefined && value.accessMode === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "password can only be set with accessMode",
        path: ["password"],
      });
    }
    if (value.password !== undefined && value.accessMode === "public") {
      ctx.addIssue({
        code: "custom",
        message: "public access does not use a Space password",
        path: ["password"],
      });
    }
  });

export const centerAgentInviteMemberBodySchema = z.strictObject({
  email: z.email(),
  role: z.enum(["admin", "member"]).default("member"),
  onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
});

export const centerAgentProductOperationStepNameSchema = z.enum([
  "list_local_agent_connection_candidates",
  "select_local_agent_connection_candidate",
  "create_agent_profile",
  "enable_agent_profile",
  "connect_agent_profile_to_local_agent",
  "authorize_agent_profile_for_organization",
  "update_agent_profile_runtime_settings",
  "update_agent_profile_workspace",
  "add_agent_profile_to_space",
  "check_agent_profile_readiness",
]);

export const centerAgentProductOperationStepSchema = z.strictObject({
  name: centerAgentProductOperationStepNameSchema,
  status: z.enum(["completed", "failed", "skipped"]),
  message: trimmedNonEmptyStringSchema.optional(),
  nextAction: trimmedNonEmptyStringSchema.optional(),
});

export const centerAgentLocalAgentConnectionCandidateSchema = z.strictObject({
  agentControllerRef: trimmedNonEmptyStringSchema,
  agentDisplayName: trimmedNonEmptyStringSchema,
  candidateId: trimmedNonEmptyStringSchema,
  connectable: z.boolean(),
  deviceDisplayName: trimmedNonEmptyStringSchema,
  deviceId: trimmedNonEmptyStringSchema,
  freshness: z.enum(["fresh", "stale", "unknown"]),
  lastObservedAtMs: z.number().int().nonnegative().nullable(),
  reasonCodes: z.array(trimmedNonEmptyStringSchema),
  runtimeLane: trimmedNonEmptyStringSchema,
  status: z.enum(["ready", "not_ready", "stale", "unknown"]),
  openMeldServiceRuntimeId: prepareReadinessRuntimeIdSchema,
});

export const centerAgentComputerSetupOptionSchema = z
  .strictObject({
    connectedComputerId: trimmedNonEmptyStringSchema.nullable(),
    deviceDisplayName: trimmedNonEmptyStringSchema,
    deviceId: trimmedNonEmptyStringSchema,
    isCurrent: z.boolean(),
    lastObservedAtMs: z.number().int().nonnegative().nullable(),
    reasonCodes: z.array(trimmedNonEmptyStringSchema),
    recommendedMode: computerSetupModeSchema.nullable(),
    status: z.enum([
      "connected",
      "needs_attention",
      "not_connected",
      "unknown",
    ]),
  })
  .superRefine((value, context) => {
    if (
      value.recommendedMode !== null &&
      value.recommendedMode !== "setup" &&
      value.connectedComputerId === null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "connectedComputerId is required for reconnect and update_service",
        path: ["connectedComputerId"],
      });
    }
  });

export const centerAgentListLocalAgentConnectionCandidatesBodySchema =
  z.strictObject({});

export const centerAgentListLocalAgentConnectionCandidatesResponseSchema =
  z.strictObject({
    candidates: z.array(centerAgentLocalAgentConnectionCandidateSchema),
    organizationId: trimmedNonEmptyStringSchema,
  });

export const centerAgentListComputersBodySchema = z.strictObject({
  includeDiagnostics: z.boolean().optional(),
  includeUsageLimits: z.literal("true").optional(),
  speakerMember: centerAgentToolSpeakerSchema,
});

export const centerAgentListComputersResponseSchema = z.strictObject({
  computers: z.array(centerAgentComputerSetupOptionSchema),
  diagnostics: ownerComputerDiagnosticsSchema.optional(),
  organizationId: trimmedNonEmptyStringSchema,
});

export const centerAgentReadMemberComputersBodySchema = z.strictObject({
  includeUsageLimits: z.literal("true").optional(),
  memberUserId: trimmedNonEmptyStringSchema,
});

export const centerAgentReadMemberComputersResponseSchema =
  organizationComputersResponseSchema
    .extend({
      memberUserId: trimmedNonEmptyStringSchema,
    })
    .superRefine((value, context) => {
      value.computers.forEach((computer, index) => {
        if (computer.ownerUserId !== value.memberUserId) {
          context.addIssue({
            code: "custom",
            message: "computer ownerUserId must match memberUserId",
            path: ["computers", index, "ownerUserId"],
          });
        }
      });
    });

export const centerAgentConnectAgentProfileToLocalAgentBodySchema =
  z.strictObject({
    agentControllerCollaborationMode:
      agentProfileBindingAgentControllerCollaborationModeSchema.optional(),
    agentControllerPermissionMode:
      agentProfileBindingAgentControllerPermissionModeSchema.optional(),
    agentProfileId: agentProfileIdSchema,
    candidateId: trimmedNonEmptyStringSchema,
    modelId: trimmedNonEmptyStringSchema.optional(),
    onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
    openCodePermission: agentProfileBindingOpenCodePermissionSchema.optional(),
    reasoningLevel: trimmedNonEmptyStringSchema.optional(),
  });

export const centerAgentUpdateAgentProfileRuntimeSettingsBodySchema = z
  .strictObject({
    agentControllerCollaborationMode:
      agentProfileBindingAgentControllerCollaborationModeSchema.optional(),
    agentControllerPermissionMode:
      agentProfileBindingAgentControllerPermissionModeSchema.optional(),
    agentProfileId: agentProfileIdSchema,
    modelId: trimmedNonEmptyStringSchema.optional(),
    onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
    openCodePermission: agentProfileBindingOpenCodePermissionSchema.optional(),
    reasoningLevel: trimmedNonEmptyStringSchema.optional(),
    workspaceMode: profileWorkspaceModeSchema.optional(),
    workspacePath: profileWorkingDirectorySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.agentControllerCollaborationMode === undefined &&
      value.agentControllerPermissionMode === undefined &&
      value.modelId === undefined &&
      value.openCodePermission === undefined &&
      value.reasoningLevel === undefined &&
      value.workspaceMode === undefined &&
      value.workspacePath === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Expected at least one runtime setting",
      });
    }
    if (value.reasoningLevel !== undefined && value.modelId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "reasoningLevel requires modelId",
        path: ["reasoningLevel"],
      });
    }
    if (
      value.workspacePath !== undefined &&
      value.workspaceMode === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "workspacePath requires workspaceMode",
        path: ["workspacePath"],
      });
    }
  });

export const centerAgentCheckAgentProfileReadinessBodySchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
});

export const centerAgentCreateConfiguredAgentProfileBodySchema = z
  .strictObject({
    agentControllerCollaborationMode:
      agentProfileBindingAgentControllerCollaborationModeSchema.optional(),
    agentControllerPermissionMode:
      agentProfileBindingAgentControllerPermissionModeSchema.optional(),
    candidateId: trimmedNonEmptyStringSchema,
    modelId: trimmedNonEmptyStringSchema.optional(),
    onBehalfOf: centerAgentOnBehalfOfInputSchema.optional(),
    openCodePermission: agentProfileBindingOpenCodePermissionSchema.optional(),
    profileName: trimmedNonEmptyStringSchema,
    reasoningLevel: trimmedNonEmptyStringSchema.optional(),
    spaceId: trimmedNonEmptyStringSchema,
    workspaceMode: profileWorkspaceModeSchema.optional(),
    workspacePath: profileWorkingDirectorySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reasoningLevel !== undefined && value.modelId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "reasoningLevel requires modelId",
        path: ["reasoningLevel"],
      });
    }
    if (
      value.workspacePath !== undefined &&
      value.workspaceMode === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "workspacePath requires workspaceMode",
        path: ["workspacePath"],
      });
    }
  });

export const centerAgentReadinessBlockerSchema = z.strictObject({
  reasonCode: trimmedNonEmptyStringSchema,
  explanation: trimmedNonEmptyStringSchema,
});

export const centerAgentCheckAgentProfileReadinessResponseSchema =
  z.strictObject({
    agentProfileId: agentProfileIdSchema,
    blockers: z.array(centerAgentReadinessBlockerSchema),
    canReply: z.boolean(),
    organizationId: trimmedNonEmptyStringSchema,
    readiness: getAgentExecutionReadinessResponseSchema,
    summary: trimmedNonEmptyStringSchema,
  });

const centerAgentProductOperationStatusSchema = z.enum([
  "completed",
  "blocked",
]);

export const centerAgentConnectAgentProfileToLocalAgentResponseSchema =
  z.strictObject({
    agentProfileId: agentProfileIdSchema,
    binding: ensureAgentProfilePrimaryBindingResponseSchema.optional(),
    canReply: z.boolean(),
    candidate: centerAgentLocalAgentConnectionCandidateSchema.optional(),
    organizationId: trimmedNonEmptyStringSchema,
    readiness: centerAgentCheckAgentProfileReadinessResponseSchema.optional(),
    status: centerAgentProductOperationStatusSchema,
    steps: z.array(centerAgentProductOperationStepSchema),
  });

export const centerAgentUpdateAgentProfileRuntimeSettingsResponseSchema =
  z.strictObject({
    agentProfileId: agentProfileIdSchema,
    binding: ensureAgentProfilePrimaryBindingResponseSchema.optional(),
    canReply: z.boolean(),
    organizationId: trimmedNonEmptyStringSchema,
    readiness: centerAgentCheckAgentProfileReadinessResponseSchema.optional(),
    status: centerAgentProductOperationStatusSchema,
    steps: z.array(centerAgentProductOperationStepSchema),
    workspace: setCurrentAgentProfileWorkspaceResponseSchema.optional(),
  });

export const centerAgentCreateConfiguredAgentProfileResponseSchema =
  z.strictObject({
    agentProfileId: agentProfileIdSchema.optional(),
    canReply: z.boolean(),
    connection:
      centerAgentConnectAgentProfileToLocalAgentResponseSchema.optional(),
    organizationId: trimmedNonEmptyStringSchema,
    profile: authProfileViewSchema.optional(),
    readiness: centerAgentCheckAgentProfileReadinessResponseSchema.optional(),
    spaceId: trimmedNonEmptyStringSchema,
    status: centerAgentProductOperationStatusSchema,
    steps: z.array(centerAgentProductOperationStepSchema),
    workspace: setCurrentAgentProfileWorkspaceResponseSchema.optional(),
  });

export const centerAgentConciergeActionResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  attribution: centerAgentAttributionSchema,
  resource: centerAgentResourceSchema.nullable(),
});

export const centerAgentCreateSpaceResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    meta: spaceMetaSchema.optional(),
    spaceId: trimmedNonEmptyStringSchema,
  });

export const centerAgentCreateAgentProfileResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    profile: authProfileViewSchema,
  });

export const centerAgentEnableAgentProfileResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    agentProfileId: agentProfileIdSchema,
    enabled: z.boolean(),
  });

export const centerAgentAddAgentProfilesToSpaceResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    agentProfileIds: z.array(agentProfileIdSchema),
    spaceId: trimmedNonEmptyStringSchema,
    membership: postSpaceMembersResponseSchema,
  });

export const centerAgentAddMembersToSpaceResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      memberUserId: trimmedNonEmptyStringSchema,
      profileId: openMeldRuntimeProfileIdSchema,
      status: z.enum(["added", "already_member"]),
    }),
    z.strictObject({
      code: z.enum([
        "not_organization_member",
        "active_human_profile_required",
      ]),
      memberUserId: trimmedNonEmptyStringSchema,
      message: trimmedNonEmptyStringSchema,
      status: z.literal("rejected"),
    }),
  ]
);

export const centerAgentAddMembersToSpaceResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    membership: postSpaceMembersResponseSchema,
    results: z.array(centerAgentAddMembersToSpaceResultSchema),
    spaceId: trimmedNonEmptyStringSchema,
  });

export const centerAgentRemoveAgentProfilesFromSpaceResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    agentProfileIds: z.array(agentProfileIdSchema),
    spaceId: trimmedNonEmptyStringSchema,
    membership: removeSpaceMembersResponseSchema,
  });

const centerAgentSpaceContextBaseResponseShape = {
  organizationId: trimmedNonEmptyStringSchema,
  spaceId: trimmedNonEmptyStringSchema,
};

const centerAgentProgressiveSpaceContextSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    scope: z.literal("source"),
    signals: z.array(signalEnvelopeSchema).max(1),
    sourceSignalId: trimmedNonEmptyStringSchema,
    threadContext: z.union([spaceThreadContextSchema, z.null()]),
    truncated: z.literal(false),
  }),
  z.strictObject({
    scope: z.literal("thread"),
    signals: z.array(signalEnvelopeSchema).max(100),
    threadId: trimmedNonEmptyStringSchema,
    truncated: z.boolean(),
  }),
  z.strictObject({
    afterSignalId: trimmedNonEmptyStringSchema,
    scope: z.literal("delta"),
    signals: z.array(signalEnvelopeSchema).max(100),
    truncated: z.boolean(),
  }),
  z.strictObject({
    scope: z.literal("history"),
    signals: z.array(signalEnvelopeSchema).max(100),
    truncated: z.boolean(),
  }),
]);

export const centerAgentReadSpaceContextResponseSchema = z.union([
  z.strictObject({
    ...centerAgentSpaceContextBaseResponseShape,
    bootstrap: spaceBootstrapResponseSchema,
  }),
  z.strictObject({
    ...centerAgentSpaceContextBaseResponseShape,
    context: centerAgentProgressiveSpaceContextSchema,
  }),
]);

export const centerAgentDispatchHistoryLatestAttemptSchema = z.strictObject({
  attemptId: trimmedNonEmptyStringSchema,
  attemptNo: z.int().min(1),
  createdAt: ISO_DATE_TIME_SCHEMA,
  errorCode: nullableTrimmedStringSchema,
  errorMessage: nullableDiagnosticTextSchema,
  finishedAt: nullableIsoDateTimeSchema,
  startedAt: nullableIsoDateTimeSchema,
  status: spaceDispatchTraceAttemptStatusSchema,
});

export const centerAgentDispatchHistoryEntrySchema = z.strictObject({
  attemptCount: z.int().min(0),
  dispatchId: trimmedNonEmptyStringSchema,
  firstSeenAt: ISO_DATE_TIME_SCHEMA,
  lastAttemptAt: ISO_DATE_TIME_SCHEMA,
  latestAttempt: z.union([
    centerAgentDispatchHistoryLatestAttemptSchema,
    z.null(),
  ]),
  status: spaceDispatchTraceDispatchStatusSchema,
  targetProfileId: trimmedNonEmptyStringSchema,
});

export const centerAgentReadDispatchHistoryResponseSchema = z.strictObject({
  entries: z.array(centerAgentDispatchHistoryEntrySchema),
  organizationId: trimmedNonEmptyStringSchema,
  spaceId: trimmedNonEmptyStringSchema,
});

export const centerAgentUpdateSpaceSettingsResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    accessModeState: spaceAccessModeStateSchema.optional(),
    meta: spaceMetaSchema.optional(),
    spaceId: trimmedNonEmptyStringSchema,
  });

export const centerAgentSpaceAuthoringContractResponseSchema = z.strictObject({
  addressingModel: z.literal("wake_reference"),
  structuredReferenceTargets: z.literal(true),
});

export const centerAgentPostSpaceMessageResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    signal: signalTextEnvelopeSchema,
    spaceId: trimmedNonEmptyStringSchema,
  });

export const centerAgentPostSlackChannelMessageResponseSchema = z.strictObject({
  attribution: centerAgentAttributionSchema,
  channelName: trimmedNonEmptyStringSchema.max(80),
  joinedChannel: z.boolean(),
  messageTs: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
});

const centerAgentSlackSearchFailureSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  reason: trimmedNonEmptyStringSchema.max(500),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  status: z.enum([
    "authorization_expired",
    "forbidden",
    "rate_limited",
    "unavailable",
  ]),
});

export const CENTER_AGENT_SLACK_SEARCH_CONTENT_MAX_CHARS = 2000;
export const CENTER_AGENT_SLACK_SEARCH_CONTEXT_MESSAGES_MAX = 2;
export const CENTER_AGENT_SLACK_SEARCH_MESSAGES_MAX = 8;
const centerAgentSlackSearchEvidenceItemSchema = z.strictObject({
  authorName: trimmedNonEmptyStringSchema.max(256),
  authorUserId: trimmedNonEmptyStringSchema.max(256),
  channelId: trimmedNonEmptyStringSchema.max(256),
  channelName: trimmedNonEmptyStringSchema.max(256),
  content: trimmedNonEmptyStringSchema.max(
    CENTER_AGENT_SLACK_SEARCH_CONTENT_MAX_CHARS
  ),
  isAuthorBot: z.boolean(),
  messageTs: trimmedNonEmptyStringSchema.max(64),
  permalink: slackMessagePermalinkSchema,
});

export const centerAgentSlackSearchMessageSchema =
  centerAgentSlackSearchEvidenceItemSchema.extend({
    contextMessages: z
      .array(centerAgentSlackSearchEvidenceItemSchema)
      .max(CENTER_AGENT_SLACK_SEARCH_CONTEXT_MESSAGES_MAX),
  });

export const centerAgentSearchSlackMessagesResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      messages: z
        .array(centerAgentSlackSearchMessageSchema)
        .max(CENTER_AGENT_SLACK_SEARCH_MESSAGES_MAX),
      moreResultsAvailable: z.boolean(),
      organizationId: trimmedNonEmptyStringSchema,
      status: z.literal("found"),
    }),
    centerAgentSlackSearchFailureSchema,
  ]);

const centerAgentWakeAgentProfilesInSpaceResponseBaseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    agentProfileIds: z.array(agentProfileIdSchema),
    childTasks: z
      .array(
        z.strictObject({
          completionCondition: z.literal("terminal"),
          subscriptionId: trimmedNonEmptyStringSchema,
          task: spaceWakeAgentTaskHandleSchema,
        })
      )
      .optional(),
    delegationId: trimmedNonEmptyStringSchema.optional(),
    fallbackTask: z
      .strictObject({
        activationSubscriptionId: trimmedNonEmptyStringSchema,
        completionCondition: z.literal("terminal"),
        subscriptionId: trimmedNonEmptyStringSchema,
        task: spaceWakeAgentTaskHandleSchema,
      })
      .optional(),
    spaceId: trimmedNonEmptyStringSchema,
  });

const centerAgentAcceptedWakeResponseSchema =
  centerAgentWakeAgentProfilesInSpaceResponseBaseSchema.extend({
    publicationStatus: z.literal("accepted").optional(),
    signal: signalTextEnvelopeSchema,
  });

const centerAgentPendingWakeResponseSchema =
  centerAgentWakeAgentProfilesInSpaceResponseBaseSchema
    .extend({
      publicationStatus: z.literal("pending"),
      retryAfterSeconds: z.int().positive().max(300),
    })
    .superRefine((value, context) => {
      if (!(value.delegationId && value.childTasks)) {
        context.addIssue({
          code: "custom",
          message:
            "a pending Wake publication requires its durable delegation contract",
          path: ["delegationId"],
        });
      }
    });

export const centerAgentWakeAgentProfilesInSpaceResponseSchema = z
  .union([
    centerAgentAcceptedWakeResponseSchema,
    centerAgentPendingWakeResponseSchema,
  ])
  .superRefine((value, context) => {
    if (
      (value.delegationId === undefined) !==
      (value.childTasks === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "delegationId and childTasks must either both be present or both be absent",
        path: ["delegationId"],
      });
    }
    if (value.fallbackTask && !value.delegationId) {
      context.addIssue({
        code: "custom",
        message: "fallbackTask requires a delegationId",
        path: ["fallbackTask"],
      });
    }
    if (value.childTasks) {
      const expectedProfileIds = [...new Set(value.agentProfileIds)].sort();
      const childProfileIds = value.childTasks
        .map((child) => child.task.targetProfileId)
        .sort();
      if (
        childProfileIds.length !== expectedProfileIds.length ||
        childProfileIds.some(
          (profileId, index) => profileId !== expectedProfileIds[index]
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "childTasks must contain exactly one Space Wake task for every agentProfileId",
          path: ["childTasks"],
        });
      }
      if (
        value.fallbackTask &&
        expectedProfileIds.includes(value.fallbackTask.task.targetProfileId)
      ) {
        context.addIssue({
          code: "custom",
          message: "fallbackTask must target a different Agent Profile",
          path: ["fallbackTask"],
        });
      }
    }
  });

export const centerAgentWatchAgentTaskResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    completionCondition: agentTaskCompletionConditionSchema,
    status: z.enum([
      "watching",
      "continuation_pending",
      "continuation_created",
      "condition_not_met",
    ]),
    outcome: z.union([agentTaskCompletionObservationSchema, z.null()]),
    subscriptionId: trimmedNonEmptyStringSchema,
    task: agentTaskHandleSchema,
    watchId: trimmedNonEmptyStringSchema,
  });

export const centerAgentListAgentTaskSchema = z.strictObject({
  outcome: z.union([agentTaskTerminalOutcomeSchema, z.null()]),
  registeredAtMs: z.int().nonnegative(),
  registrationSource: agentControllerTaskLifecycleEventSourceSchema,
  supportedCompletionConditions: z.array(agentTaskCompletionConditionSchema),
  task: controllerAgentTaskHandleSchema,
});

export const centerAgentListAgentTasksResponseSchema = z.strictObject({
  hasMore: z.boolean(),
  organizationId: trimmedNonEmptyStringSchema,
  tasks: z.array(centerAgentListAgentTaskSchema).max(20),
});

export const centerAgentInviteMemberResponseSchema =
  centerAgentConciergeActionResponseSchema.extend({
    invited: z.literal(true),
  });

export const openCenterAgentDirectMessageSpaceResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  centerAgentProfileId: agentProfileIdSchema,
  memberProfileId: openMeldRuntimeProfileIdSchema,
  spaceId: trimmedNonEmptyStringSchema,
  created: z.boolean(),
});
