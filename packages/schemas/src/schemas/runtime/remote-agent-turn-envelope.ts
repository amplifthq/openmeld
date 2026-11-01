import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldWebUrlSchema } from "../../navigation-action";
import { userRequestTimeContextSchema } from "../../user-time-context";
import {
  CENTER_AGENT_ROUTINE_NAME_MAX_CHARS,
  centerAgentRoutineAuthorizedActionsSchema,
  centerAgentRoutineExternalActionPolicySchema,
} from "../http/center-agent-routines";
import { MAX_SPACE_GUIDE_LENGTH } from "../http/space-meta";
import { centerAgentInteractionSourceSchema } from "../protocol/center-agent-interaction-source";
import { spaceCallerContextSchema } from "../protocol/space-caller-context";
import {
  agentDelegationSnapshotSchema,
  agentTaskCompletionObservationSchema,
  agentTaskHandleSchema,
  agentTaskTerminalOutcomeSchema,
  areAgentTaskTerminalOutcomesEqual,
  buildAgentTaskKey,
} from "./agent-task-coordination";
import { channelContextSchema } from "./channel-context";
import {
  buildMessageChannelConversationId,
  messageChannelConversationLocatorSchema,
  messageChannelParticipantIdentitySchema,
  messageChannelProviderSchema,
  messageChannelResourceDescriptorSchema,
} from "./message-channel";
import { workingLanguageGuidanceSchema } from "./working-language";

const nonEmptyStringSchema = z.string().trim().min(1);
export const REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS = 4000;
export const REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS = 1200;
export const REMOTE_AGENT_WORK_LOOP_CONTINUATION_MAX_ATTEMPTS = 8;

export const remoteAgentWorkLoopCheckpointSchema = z.strictObject({
  reason: z.literal("tool_call_budget_exhausted"),
  toolCallLimit: z.number().int().positive(),
  v: z.literal(1),
});

export const remoteAgentWorkLoopContinuationSchema = z.strictObject({
  attempt: z
    .number()
    .int()
    .positive()
    .max(REMOTE_AGENT_WORK_LOOP_CONTINUATION_MAX_ATTEMPTS),
  previousSubmissionId: nonEmptyStringSchema,
  reason: z.literal("tool_call_budget_exhausted"),
  v: z.literal(1),
});

export const remoteAgentInteractionEnvironmentSchema = z.enum([
  "requester_private",
  "organization_shared",
  "externally_shared",
]);

export const centerAgentContextHandlingSchema = z.enum([
  "use_and_share",
  "use_privately",
  "share_when_authorized",
  "never_available",
]);

export const centerAgentRequesterIdentitySchema = z.enum([
  "verified_member",
  "connected_organization_member",
  "external_participant",
  "organization_routine",
  "agent_profile",
]);

export const centerAgentResultAudienceSchema = z.enum([
  "requester_only",
  "organization_members",
  "external_conversation",
]);

export const centerAgentContextScopePlanSchema = z.strictObject({
  authenticationSecrets: z.literal("never_available"),
  interactionEnvironment: remoteAgentInteractionEnvironmentSchema,
  memberMemory: centerAgentContextHandlingSchema,
  organizationDocuments: centerAgentContextHandlingSchema,
  organizationMemory: centerAgentContextHandlingSchema,
  organizationSkills: centerAgentContextHandlingSchema,
  protectedInformation: centerAgentContextHandlingSchema,
  requesterIdentity: centerAgentRequesterIdentitySchema,
  resultAudience: centerAgentResultAudienceSchema,
  v: z.literal(1),
});

const remoteAgentTurnEnvelopePersonSenderShape = {
  callerContext: spaceCallerContextSchema.optional(),
  id: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema,
  ownerUserId: nonEmptyStringSchema.optional(),
  profileId: nonEmptyStringSchema.optional(),
  role: nonEmptyStringSchema.optional(),
  messageChannelIdentity: messageChannelParticipantIdentitySchema.optional(),
  verified: z.boolean(),
};

export const remoteAgentTurnEnvelopeSenderSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("member"),
      ...remoteAgentTurnEnvelopePersonSenderShape,
    }),
    z.strictObject({
      kind: z.literal("agent_profile"),
      ...remoteAgentTurnEnvelopePersonSenderShape,
    }),
    z.strictObject({
      kind: z.literal("routine"),
      routineId: nonEmptyStringSchema,
      createdByUserId: nonEmptyStringSchema,
      delegatedBy: z.strictObject({
        id: nonEmptyStringSchema,
        displayName: nonEmptyStringSchema,
        ownerUserId: nonEmptyStringSchema,
        profileId: nonEmptyStringSchema.optional(),
        role: nonEmptyStringSchema.optional(),
        verified: z.literal(true),
      }),
    }),
  ]
);

export const remoteAgentTurnEnvelopeSpaceSchema = z.strictObject({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: z.enum(["dm", "space"]),
  isCenterAgentDm: z.boolean(),
  guide: nonEmptyStringSchema.max(MAX_SPACE_GUIDE_LENGTH).optional(),
});

export const remoteAgentTurnEnvelopeOrganizationSchema = z.strictObject({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  personal: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  webUrl: openMeldWebUrlSchema.optional(),
  workingLanguage: workingLanguageGuidanceSchema.optional(),
});

export const remoteAgentTurnEnvelopeCenterAgentSchema = z.strictObject({
  profileName: nonEmptyStringSchema,
  profileHandle: nonEmptyStringSchema,
});

export const remoteAgentSlackSearchAuthorizationSchema = z.strictObject({
  encryptedAuthorization: nonEmptyStringSchema.max(8192),
});

const remoteAgentRoutineDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("message_channel"),
    locator: messageChannelConversationLocatorSchema,
  }),
  z.strictObject({
    kind: z.literal("space"),
    spaceId: nonEmptyStringSchema,
  }),
  z.strictObject({
    channelId: nonEmptyStringSchema,
    conversationId: nonEmptyStringSchema,
    kind: z.literal("slack_thread"),
    label: nonEmptyStringSchema.optional(),
    teamId: nonEmptyStringSchema,
    threadTs: nonEmptyStringSchema,
  }),
]);

const remoteAgentRoutineContinuationSchema = z.strictObject({
  delegation: agentDelegationSnapshotSchema,
  delegationId: nonEmptyStringSchema,
  outcome: agentTaskTerminalOutcomeSchema,
  subscriptionId: nonEmptyStringSchema,
  watchedTask: agentTaskHandleSchema,
});

export const remoteAgentTurnEnvelopeTriggerSchema = z.discriminatedUnion(
  "source",
  [
    z.strictObject({ source: z.literal("web_dm") }),
    z.strictObject({ source: z.literal("space_wake") }),
    z.strictObject({
      source: z.literal("slack"),
      teamId: nonEmptyStringSchema.optional(),
      channelId: nonEmptyStringSchema.optional(),
      threadTs: nonEmptyStringSchema.optional(),
      conversationId: nonEmptyStringSchema.optional(),
      channelName: nonEmptyStringSchema.optional(),
      replyPlacement: z.enum(["conversation", "thread"]).optional(),
      searchAuthorization: remoteAgentSlackSearchAuthorizationSchema.optional(),
    }),
    z.strictObject({
      source: z.literal("message_channel"),
      routineLocator: messageChannelConversationLocatorSchema.optional(),
      provider: messageChannelProviderSchema,
      connectionId: nonEmptyStringSchema,
      conversationId: nonEmptyStringSchema,
      filePublicationSupported: z.literal(true).optional(),
      resources: z
        .array(messageChannelResourceDescriptorSchema)
        .max(10)
        .optional(),
    }),
    z.strictObject({
      authorizedActions: centerAgentRoutineAuthorizedActionsSchema.default([]),
      externalActionPolicy:
        centerAgentRoutineExternalActionPolicySchema.optional(),
      source: z.literal("routine"),
      routineId: nonEmptyStringSchema,
      runId: nonEmptyStringSchema,
      scheduledFor: z.number().int().nonnegative(),
      routineName: nonEmptyStringSchema.max(
        CENTER_AGENT_ROUTINE_NAME_MAX_CHARS
      ),
      destination: remoteAgentRoutineDestinationSchema.optional(),
      continuation: remoteAgentRoutineContinuationSchema.optional(),
    }),
    z.strictObject({
      source: z.literal("member_research"),
      taskId: nonEmptyStringSchema,
      subjectUserId: nonEmptyStringSchema,
      subjectDisplayName: nonEmptyStringSchema,
    }),
    z.strictObject({
      delegation: agentDelegationSnapshotSchema.optional(),
      delegationId: nonEmptyStringSchema,
      outcome: agentTaskTerminalOutcomeSchema,
      source: z.literal("task_continuation"),
      // Set by the task owner for restricted summary recovery, never model input.
      summaryOnly: z.literal(true).optional(),
      subscriptionId: nonEmptyStringSchema,
      watchedTask: agentTaskHandleSchema,
    }),
    z.strictObject({
      outcome: agentTaskCompletionObservationSchema,
      source: z.literal("task_watch_continuation"),
      subscriptionId: nonEmptyStringSchema,
      watchedTask: agentTaskHandleSchema,
      watchId: nonEmptyStringSchema,
    }),
  ]
);

export const remoteAgentTurnEnvelopeMemorySourceSchema = z.enum([
  "ca_dm",
  "explicit_tool",
  "space_conversation",
  "slack_conversation",
  "message_channel_conversation",
]);

export const remoteAgentTurnEnvelopeMemorySubjectSchema = z.enum([
  "member",
  "organization",
  "space",
]);

const remoteAgentTurnEnvelopeMemoryItemTextSchema = nonEmptyStringSchema.max(
  REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS
);

export const remoteAgentTurnEnvelopeMemoryItemSchema = z.discriminatedUnion(
  "source",
  [
    z.strictObject({
      source: z.enum([
        "ca_dm",
        "explicit_tool",
        "space_conversation",
        "slack_conversation",
      ]),
      subject: remoteAgentTurnEnvelopeMemorySubjectSchema,
      text: remoteAgentTurnEnvelopeMemoryItemTextSchema,
    }),
    z.strictObject({
      source: z.literal("message_channel_conversation"),
      provider: messageChannelProviderSchema,
      subject: remoteAgentTurnEnvelopeMemorySubjectSchema,
      text: remoteAgentTurnEnvelopeMemoryItemTextSchema,
    }),
  ]
);

export const remoteAgentTurnEnvelopeMemorySchema = z.strictObject({
  items: z.array(remoteAgentTurnEnvelopeMemoryItemSchema).max(8),
  truncated: z.boolean(),
  status: z.enum(["partial", "unavailable"]).optional(),
});

export const remoteAgentTurnEnvelopeSchema = z
  .strictObject({
    sender: remoteAgentTurnEnvelopeSenderSchema,
    requestTimeContext: userRequestTimeContextSchema.optional(),
    space: remoteAgentTurnEnvelopeSpaceSchema,
    organization: remoteAgentTurnEnvelopeOrganizationSchema,
    centerAgent: remoteAgentTurnEnvelopeCenterAgentSchema,
    trigger: remoteAgentTurnEnvelopeTriggerSchema,
    contextScopePlan: centerAgentContextScopePlanSchema.optional(),
    interactionEnvironment: remoteAgentInteractionEnvironmentSchema.optional(),
    centerAgentInteractionSource: centerAgentInteractionSourceSchema.optional(),
    channelContext: channelContextSchema.optional(),
    memory: remoteAgentTurnEnvelopeMemorySchema.optional(),
    workLoopContinuation: remoteAgentWorkLoopContinuationSchema.optional(),
  })
  .superRefine((envelope, context) => {
    const hasRoutineSender = envelope.sender.kind === "routine";
    const hasRoutineTrigger = envelope.trigger.source === "routine";
    if (hasRoutineSender !== hasRoutineTrigger) {
      context.addIssue({
        code: "custom",
        message: "Routine sender and trigger variants must be used together.",
        path: [hasRoutineSender ? "trigger" : "sender"],
      });
      return;
    }
    if (
      envelope.sender.kind === "routine" &&
      envelope.trigger.source === "routine" &&
      envelope.sender.routineId !== envelope.trigger.routineId
    ) {
      context.addIssue({
        code: "custom",
        message: "Routine sender and trigger identifiers must match.",
        path: ["trigger", "routineId"],
      });
    }
    if (
      envelope.sender.kind === "routine" &&
      envelope.sender.delegatedBy.ownerUserId !==
        envelope.sender.createdByUserId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Routine delegation must belong to the user who created the Routine.",
        path: ["sender", "delegatedBy", "ownerUserId"],
      });
    }
    if (
      envelope.trigger.source === "routine" &&
      envelope.trigger.destination?.kind === "message_channel" &&
      (envelope.trigger.destination.locator.provider === "slack" ||
        buildMessageChannelConversationId(
          envelope.trigger.destination.locator
        ) !== envelope.space.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "Routine destination must match its conversation.",
        path: ["trigger", "destination"],
      });
    }
    if (
      envelope.trigger.source === "routine" &&
      envelope.trigger.destination &&
      envelope.trigger.destination.kind === "space" &&
      envelope.trigger.destination.spaceId !== envelope.space.id
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Routine Space destination must match the envelope conversation.",
        path: ["trigger", "destination", "spaceId"],
      });
    }
    if (
      envelope.trigger.source === "routine" &&
      envelope.trigger.destination &&
      envelope.trigger.destination.kind === "slack_thread" &&
      envelope.trigger.destination.conversationId !== envelope.space.id
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Routine Slack destination must match the envelope conversation.",
        path: ["trigger", "destination", "conversationId"],
      });
    }
    if (
      envelope.trigger.source === "member_research" &&
      (envelope.sender.kind !== "member" ||
        !envelope.sender.verified ||
        !envelope.sender.ownerUserId ||
        !envelope.sender.profileId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Member research turns require a verified human member sender.",
        path: ["sender"],
      });
    }
    if (
      envelope.trigger.source === "task_continuation" &&
      (envelope.sender.kind !== "member" ||
        !envelope.sender.verified ||
        !envelope.sender.ownerUserId ||
        !envelope.sender.profileId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Task continuation turns require the original verified human member sender.",
        path: ["sender"],
      });
    }
    validateTaskContinuationTrigger(envelope.trigger, context);
    validateMessageChannelTurn(envelope, context);
  });

function validateMessageChannelTurn(
  envelope: {
    trigger: zod.infer<typeof remoteAgentTurnEnvelopeTriggerSchema>;
    space: zod.infer<typeof remoteAgentTurnEnvelopeSpaceSchema>;
    channelContext?: zod.infer<typeof channelContextSchema>;
  },
  context: zod.RefinementCtx
): void {
  if (envelope.trigger.source !== "message_channel") {
    return;
  }
  const locator = envelope.trigger.routineLocator;
  if (
    locator &&
    (locator.provider !== envelope.trigger.provider ||
      locator.connectionId !== envelope.trigger.connectionId ||
      buildMessageChannelConversationId(locator) !==
        envelope.trigger.conversationId)
  ) {
    context.addIssue({
      code: "custom",
      message: "Routine origin must match the Message Channel trigger.",
      path: ["trigger", "routineLocator"],
    });
  }
  if (envelope.trigger.conversationId !== envelope.space.id) {
    context.addIssue({
      code: "custom",
      message: "Message Channel trigger must match the envelope conversation.",
      path: ["trigger", "conversationId"],
    });
  }
  if (
    envelope.channelContext &&
    (envelope.channelContext.provider !== envelope.trigger.provider ||
      envelope.channelContext.conversationId !==
        envelope.trigger.conversationId)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Message Channel context must match the trigger provider and conversation.",
      path: ["channelContext"],
    });
  }
}

function validateTaskContinuationTrigger(
  trigger: zod.infer<typeof remoteAgentTurnEnvelopeTriggerSchema>,
  context: zod.RefinementCtx
): void {
  let continuation: zod.infer<
    typeof remoteAgentRoutineContinuationSchema
  > | null = null;
  if (trigger.source === "task_continuation" && trigger.delegation) {
    continuation = {
      delegation: trigger.delegation,
      delegationId: trigger.delegationId,
      outcome: trigger.outcome,
      subscriptionId: trigger.subscriptionId,
      watchedTask: trigger.watchedTask,
    };
  } else if (trigger.source === "routine") {
    continuation = trigger.continuation ?? null;
  }
  if (!continuation) {
    return;
  }
  const { delegation, delegationId, outcome, watchedTask } = continuation;
  if (delegation.delegationId !== delegationId) {
    context.addIssue({
      code: "custom",
      message:
        "Task continuation delegation identifiers must match the snapshot.",
      path: ["trigger", "delegation", "delegationId"],
    });
  }
  const watchedTaskKey = buildAgentTaskKey(watchedTask);
  const watchedChild = delegation.children.find(
    (child) => buildAgentTaskKey(child.task) === watchedTaskKey
  );
  if (!watchedChild) {
    context.addIssue({
      code: "custom",
      message: "Task continuation watched task must identify a snapshot child.",
      path: ["trigger", "watchedTask"],
    });
  } else if (
    !(
      watchedChild.terminalOutcome &&
      areAgentTaskTerminalOutcomesEqual(watchedChild.terminalOutcome, outcome)
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Task continuation outcome must match the watched snapshot child.",
      path: ["trigger", "outcome"],
    });
  }
}
