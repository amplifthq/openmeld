import * as z from "../../lazy-zod";
import { spaceEvidenceReferencesSchema } from "../../space-evidence";
import { spaceWorkHandoffSchema } from "../../space-work-handoff";
import { userRequestTimeContextSchema } from "../../user-time-context";
import {
  spaceMessageFileReferenceSchema,
  spaceMessageFileReferencesSchema,
} from "../http/space-files";
import { spaceMentionLabelSchema } from "../http/space-mention-label";
import { spacePasswordSchema } from "../http/space-password";
import { centerAgentInteractionSourceSchema } from "../protocol/center-agent-interaction-source";
import {
  executionContextAssignmentSchema,
  executionContextRequestSchema,
  executionContextSelectionSchema,
  executionContextTaskSchema,
} from "../protocol/execution-context";
import { messageEnvelopeSchema } from "../protocol/message-envelope";
import { requestChainSchema } from "../protocol/request-chain";
import { signalTextReplyToSchema } from "../protocol/signal";
import { spaceMessageAttachmentsSchema } from "../protocol/space-attachment";
import { spaceCallerContextSchema } from "../protocol/space-caller-context";
import { wakeDeviceWaitSchema } from "../protocol/wake-device-wait";
import {
  agentTaskCompletionObservationSchema,
  agentTaskHandleSchema,
} from "../runtime/agent-task-coordination";
import { spaceContractSchema } from "../space-mesh/space-contract";
import { spaceThreadContextSchema } from "../space-mesh/space-thread";
import {
  runtimeAgentControllerConversationIdMappingSpecSchema,
  runtimeDispatchPolicySchema,
  runtimeTransportModeSchema,
} from "./controller-contract";
import { openMeldDaemonMentionDispatchRuleSourceSchema } from "./mention-dispatch-result";

export const OPENMELD_DAEMON_DISPATCH_QUEUE_SCHEMA_VERSION = 2 as const;
export const REMOTE_AGENT_NATIVE_DELIVERY_DEADLINE_PROBE_QUEUE_SCHEMA_VERSION =
  3 as const;
export const AGENT_TASK_CONTINUATION_QUEUE_SCHEMA_VERSION = 4 as const;
export const AGENT_TASK_OBSERVATION_REDRIVE_QUEUE_SCHEMA_VERSION = 5 as const;
export const OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION = 2 as const;
export const openMeldDaemonDispatchDeliveryRecoveryReasonSchema = z.enum([
  "connection_replaced",
  "route_lost",
]);
export const openMeldDaemonDispatchQueueRecoveryReasonSchema = z.union([
  openMeldDaemonDispatchDeliveryRecoveryReasonSchema,
  z.literal("agent_profile_work_coordinator_promoted"),
  z.literal("hosted_admission_incomplete"),
]);

export const openMeldDaemonDispatchRulesSnapshotSchema = z.strictObject({
  dispatchPolicy: runtimeDispatchPolicySchema,
  ruleSource: openMeldDaemonMentionDispatchRuleSourceSchema,
  ruleId: z.string().min(1),
  ruleReason: z.string().min(1),
});

export const openMeldDaemonDispatchControllerSnapshotSchema = z.strictObject({
  bindingId: z.string().trim().min(1).nullable().optional(),
  configurationRevision: z.number().int().positive().optional(),
  targetBindingState: z
    .enum(["bound", "missing"])
    .describe(
      "Compatibility seed evidence captured at Space handoff time. RuntimeCoordinator head lifecycle and Core Binding lookup remain the Wake outcome authorities."
    ),
  targetBindingEnabled: z
    .boolean()
    .describe(
      "Compatibility seed evidence captured at Space handoff time. RuntimeCoordinator head lifecycle and Core Binding lookup remain the Wake outcome authorities."
    ),
  agentControllerRef: z.string().min(1).nullable(),
});

export const openMeldDaemonAcceptedDispatchSnapshotSchema = z.strictObject({
  // Frozen material contract for admission and route-reconnect capability checks.
  workHandoffVersion: z.literal(2).optional(),
  contextRequest: executionContextRequestSchema.optional(),
  executionContext: executionContextAssignmentSchema.optional(),
  deviceWait: wakeDeviceWaitSchema.optional(),
  controllerSnapshot: z.strictObject({
    bindingId: z.string().trim().min(1),
    configurationRevision: z.number().int().positive(),
    targetBindingState: z.literal("bound"),
    targetBindingEnabled: z.literal(true),
    agentControllerRef: z.string().trim().min(1),
  }),
  openMeldServiceRuntimeId: z.string().trim().min(1),
  payloadFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runtimeKind: z.literal("openmeld_service"),
});

export const openMeldDaemonDispatchSnapshotSchema = z.strictObject({
  dispatchPolicy: runtimeDispatchPolicySchema,
  ruleSource: openMeldDaemonMentionDispatchRuleSourceSchema,
  ruleId: z.string().min(1),
  ruleReason: z.string().min(1),
  targetBindingState: z
    .enum(["bound", "missing"])
    .describe(
      "Compatibility seed evidence captured at Space handoff time. Do not use this snapshot as Binding authority or per-Wake outcome truth."
    ),
  targetBindingEnabled: z
    .boolean()
    .describe(
      "Compatibility seed evidence captured at Space handoff time. Do not use this snapshot as Binding authority or per-Wake outcome truth."
    ),
});

export const openMeldDaemonDispatchSourceSignalSnapshotSchema = z.strictObject({
  requestTimeContext: userRequestTimeContextSchema.optional(),
  evidenceRefs: spaceEvidenceReferencesSchema.optional(),
  workHandoff: spaceWorkHandoffSchema.optional(),
  contextMessages: z
    .array(
      z.strictObject({
        signalId: z.string().min(1),
        author: z.string().min(1).nullable(),
        text: z.string().max(16_000),
        files: spaceMessageFileReferencesSchema.optional(),
        attachments: spaceMessageAttachmentsSchema.optional(),
      })
    )
    .max(3)
    .optional(),
  callerContext: spaceCallerContextSchema.optional(),
  pinnedFiles: z.array(spaceMessageFileReferenceSchema).max(100).optional(),
  quotedMessage: z
    .strictObject({
      signalId: z.string().min(1),
      author: z.string().min(1).nullable(),
      text: z.string().max(16_000).nullable(),
      status: z.enum(["available", "recalled", "unavailable"]),
    })
    .optional(),
  text: z.string().min(1),
  profileId: z.string().min(1).nullable(),
  profileKind: z.enum(["agent", "human", "system"]).nullable(),
  profileMentionLabel: spaceMentionLabelSchema.optional(),
  attachments: spaceMessageAttachmentsSchema.optional(),
  files: spaceMessageFileReferencesSchema.optional(),
  centerAgentInteractionSource: centerAgentInteractionSourceSchema.optional(),
});

export const openMeldDaemonDispatchReplyToSnapshotSchema =
  signalTextReplyToSchema;
export const openMeldDaemonDispatchContinuitySnapshotSchema = z.strictObject({
  messagesSinceThen: z.number().int().finite().min(0),
  higherAuthorityUpdates: z.boolean(),
});

export const openMeldDaemonDispatchOwnerSchema = z.strictObject({
  kind: z.literal("owner_account"),
  id: z.string().min(1),
});

export const openMeldDaemonDispatchQueueLegacyMessageSchemaV1 = z.strictObject({
  v: z.literal(1),
  dispatchId: z.string().min(1),
  spaceId: z.string().min(1),
  sourceEventId: z.string().min(1),
  targetProfileId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  enqueuedAtMs: z.number().int().nonnegative(),
});

export const openMeldDaemonDispatchQueueMessageSchema = z
  .strictObject({
    v: z.literal(OPENMELD_DAEMON_DISPATCH_QUEUE_SCHEMA_VERSION),
    dispatchId: z.string().min(1),
    contextSelection: executionContextSelectionSchema.optional(),
    executionContext: executionContextTaskSchema.optional(),
    deviceWait: wakeDeviceWaitSchema.optional(),
    spaceId: z.string().min(1),
    organizationId: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Canonical Space Organization snapshot captured by the Space Durable Object when it creates the dispatch outbox seed. Optional only while old producers remain in the phase-1 rollout window."
      )
      .optional(),
    sourceEventId: z.string().min(1),
    sourceClientMessageId: z.string().min(1).max(200).nullable().optional(),
    dispatchOwner: openMeldDaemonDispatchOwnerSchema.optional(),
    targetProfileId: z.string().min(1),
    targetProfileMentionLabel: spaceMentionLabelSchema.optional(),
    dispatchChainId: z.string().min(1),
    autoRelayDepth: z.number().int().nonnegative(),
    visitedProfileIds: z.array(z.string().min(1)).max(256).default([]),
    visitedProfileIdsHash: z.string().min(1),
    requestChain: requestChainSchema
      .optional()
      .describe(
        "Written by the Space Durable Object when it creates the outbox seed; Core admission derives it when absent. Never accepted from clients or Agents."
      ),
    dispatchContractVersion: z.number().int().positive(),
    dispatchPolicy: runtimeDispatchPolicySchema,
    ruleSource: openMeldDaemonMentionDispatchRuleSourceSchema,
    ruleId: z.string().min(1),
    ruleReason: z.string().min(1),
    taskId: z.string().min(1),
    transportMode: runtimeTransportModeSchema.nullable(),
    spacePassword: spacePasswordSchema.optional(),
    controllerSnapshot: openMeldDaemonDispatchControllerSnapshotSchema,
    contextIdMappingSpec:
      runtimeAgentControllerConversationIdMappingSpecSchema.nullable(),
    dispatchRulesSnapshot: openMeldDaemonDispatchRulesSnapshotSchema,
    dispatchSnapshot: openMeldDaemonDispatchSnapshotSchema,
    spaceContractSnapshot: spaceContractSchema.optional(),
    continuitySnapshot:
      openMeldDaemonDispatchContinuitySnapshotSchema.optional(),
    sourceSignalSnapshot:
      openMeldDaemonDispatchSourceSignalSnapshotSchema.optional(),
    sourceMessageEnvelope: messageEnvelopeSchema.optional(),
    replyToSnapshot: openMeldDaemonDispatchReplyToSnapshotSchema.optional(),
    threadContext: spaceThreadContextSchema.optional(),
    spaceNameSnapshot: z.string().min(1).nullable().optional(),
    sourceProfileNameSnapshot: z.string().min(1).nullable().optional(),
    targetProfileNameSnapshot: z.string().min(1).nullable().optional(),
    deliveryRecoveryReason:
      openMeldDaemonDispatchQueueRecoveryReasonSchema.optional(),
    idempotencyKey: z.string().min(1),
    // Stable age of the Space outbox item; enqueuedAtMs tracks the latest handoff.
    outboxCreatedAtMs: z.number().int().nonnegative().optional(),
    enqueuedAtMs: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.dispatchSnapshot.dispatchPolicy !== value.dispatchPolicy) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dispatchSnapshot", "dispatchPolicy"],
        message: "dispatchSnapshot.dispatchPolicy must match dispatchPolicy",
      });
    }
    if (value.dispatchSnapshot.ruleSource !== value.ruleSource) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dispatchSnapshot", "ruleSource"],
        message: "dispatchSnapshot.ruleSource must match ruleSource",
      });
    }
    if (value.dispatchSnapshot.ruleId !== value.ruleId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dispatchSnapshot", "ruleId"],
        message: "dispatchSnapshot.ruleId must match ruleId",
      });
    }
    if (value.dispatchSnapshot.ruleReason !== value.ruleReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dispatchSnapshot", "ruleReason"],
        message: "dispatchSnapshot.ruleReason must match ruleReason",
      });
    }
    if (
      value.dispatchRulesSnapshot.dispatchPolicy !== value.dispatchPolicy ||
      value.dispatchRulesSnapshot.ruleSource !== value.ruleSource ||
      value.dispatchRulesSnapshot.ruleId !== value.ruleId ||
      value.dispatchRulesSnapshot.ruleReason !== value.ruleReason
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dispatchRulesSnapshot"],
        message:
          "dispatchRulesSnapshot must match top-level dispatch rule fields",
      });
    }
    if (
      value.controllerSnapshot.targetBindingState !==
        value.dispatchSnapshot.targetBindingState ||
      value.controllerSnapshot.targetBindingEnabled !==
        value.dispatchSnapshot.targetBindingEnabled
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controllerSnapshot"],
        message:
          "controllerSnapshot target binding fields must match dispatchSnapshot",
      });
    }
  });

export const remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema =
  z.strictObject({
    v: z.literal(
      REMOTE_AGENT_NATIVE_DELIVERY_DEADLINE_PROBE_QUEUE_SCHEMA_VERSION
    ),
    kind: z.literal("remote_agent_native_delivery_deadline_probe"),
    submissionId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    organizationId: z.string().min(1),
    spaceId: z.string().min(1),
    dispatchId: z.string().min(1),
    enqueuedAtMs: z.number().int().nonnegative(),
    deadlineAtMs: z.number().int().nonnegative(),
  });

export const agentTaskContinuationQueueMessageSchema = z.strictObject({
  enqueuedAtMs: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(1).max(512),
  kind: z.literal("agent_task_continuation"),
  subscriptionId: z.string().trim().min(1).max(512),
  v: z.literal(AGENT_TASK_CONTINUATION_QUEUE_SCHEMA_VERSION),
});

export const agentTaskObservationRedriveQueueMessageSchema = z.strictObject({
  deliveryId: z.string().trim().min(1).max(1024),
  enqueuedAtMs: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(1).max(1536),
  kind: z.literal("agent_task_observation_redrive"),
  observation: agentTaskCompletionObservationSchema,
  ownerUserId: z.string().trim().min(1).max(512),
  runtimeCoordinatorExecutionId: z.string().trim().min(1).max(512),
  task: agentTaskHandleSchema,
  v: z.literal(AGENT_TASK_OBSERVATION_REDRIVE_QUEUE_SCHEMA_VERSION),
});

export const openMeldDaemonDispatchQueueIngressSchema = z.discriminatedUnion(
  "v",
  [
    openMeldDaemonDispatchQueueLegacyMessageSchemaV1,
    openMeldDaemonDispatchQueueMessageSchema,
    remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema,
    agentTaskContinuationQueueMessageSchema,
    agentTaskObservationRedriveQueueMessageSchema,
  ]
);

const resolveReceivedQueueSchemaVersion = (value: unknown): number | null => {
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    return null;
  }
  const version = (value as { v?: unknown }).v;
  return typeof version === "number" && Number.isInteger(version)
    ? version
    : null;
};

const buildLegacyQueueIssues = () =>
  [
    {
      code: z.ZodIssueCode.custom,
      message: "legacy dispatch queue schema version unsupported",
      path: ["v"],
    },
  ] as const;

const parseCurrentDispatchQueueMessage = (value: unknown) => {
  const parsed = openMeldDaemonDispatchQueueMessageSchema.safeParse(value);
  if (parsed.success) {
    return {
      kind: "current_v2" as const,
      message: parsed.data,
      receivedQueueSchemaVersion: parsed.data.v,
    };
  }
  return {
    kind: "invalid" as const,
    issues: parsed.error.issues,
    receivedQueueSchemaVersion: 2,
  };
};

const parseRemoteAgentDeadlineProbeQueueMessage = (value: unknown) => {
  const parsed =
    remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema.safeParse(value);
  if (parsed.success) {
    return {
      kind: "remote_agent_deadline_probe" as const,
      message: parsed.data,
      receivedQueueSchemaVersion: parsed.data.v,
    };
  }
  return {
    kind: "invalid" as const,
    issues: parsed.error.issues,
    receivedQueueSchemaVersion: 3,
  };
};

const parseAgentTaskContinuationQueueMessage = (value: unknown) => {
  const parsed = agentTaskContinuationQueueMessageSchema.safeParse(value);
  if (parsed.success) {
    return {
      kind: "agent_task_continuation" as const,
      message: parsed.data,
      receivedQueueSchemaVersion: parsed.data.v,
    };
  }
  return {
    kind: "invalid" as const,
    issues: parsed.error.issues,
    receivedQueueSchemaVersion: 4,
  };
};

const parseAgentTaskObservationRedriveQueueMessage = (value: unknown) => {
  const parsed = agentTaskObservationRedriveQueueMessageSchema.safeParse(value);
  if (parsed.success) {
    return {
      kind: "agent_task_observation_redrive" as const,
      message: parsed.data,
      receivedQueueSchemaVersion: parsed.data.v,
    };
  }
  return {
    kind: "invalid" as const,
    issues: parsed.error.issues,
    receivedQueueSchemaVersion: 5,
  };
};

const parseLegacyDispatchQueueMessage = (value: unknown) => {
  const parsed =
    openMeldDaemonDispatchQueueLegacyMessageSchemaV1.safeParse(value);
  if (parsed.success) {
    return {
      kind: "legacy_v1" as const,
      message: parsed.data,
      issues: buildLegacyQueueIssues(),
      receivedQueueSchemaVersion: parsed.data.v,
    };
  }
  return {
    kind: "invalid" as const,
    issues: parsed.error.issues,
    receivedQueueSchemaVersion: 1,
  };
};

export const parseOpenMeldDaemonDispatchQueueIngress = (value: unknown) => {
  const receivedQueueSchemaVersion = resolveReceivedQueueSchemaVersion(value);

  if (receivedQueueSchemaVersion === 2) {
    return parseCurrentDispatchQueueMessage(value);
  }

  if (receivedQueueSchemaVersion === 3) {
    return parseRemoteAgentDeadlineProbeQueueMessage(value);
  }

  if (receivedQueueSchemaVersion === 4) {
    return parseAgentTaskContinuationQueueMessage(value);
  }

  if (receivedQueueSchemaVersion === 5) {
    return parseAgentTaskObservationRedriveQueueMessage(value);
  }

  if (receivedQueueSchemaVersion === 1) {
    return parseLegacyDispatchQueueMessage(value);
  }

  const parsed = openMeldDaemonDispatchQueueIngressSchema.safeParse(value);
  if (parsed.success) {
    if (parsed.data.v === 2) {
      return {
        kind: "current_v2" as const,
        message: parsed.data,
        receivedQueueSchemaVersion: parsed.data.v,
      };
    }
    if (parsed.data.v === 3) {
      return {
        kind: "remote_agent_deadline_probe" as const,
        message: parsed.data,
        receivedQueueSchemaVersion: parsed.data.v,
      };
    }
    if (parsed.data.v === 4) {
      return {
        kind: "agent_task_continuation" as const,
        message: parsed.data,
        receivedQueueSchemaVersion: parsed.data.v,
      };
    }
    if (parsed.data.v === 5) {
      return {
        kind: "agent_task_observation_redrive" as const,
        message: parsed.data,
        receivedQueueSchemaVersion: parsed.data.v,
      };
    }
    return {
      kind: "legacy_v1" as const,
      message: parsed.data,
      issues: buildLegacyQueueIssues(),
      receivedQueueSchemaVersion: parsed.data.v,
    };
  }

  return {
    kind: "invalid" as const,
    issues: parsed.error.issues,
    receivedQueueSchemaVersion,
  };
};
