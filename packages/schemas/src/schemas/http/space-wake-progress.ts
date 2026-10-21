import * as z from "zod/v4";
import { runtimeCoordinatorExecutionRecordSchema } from "../daemon/runtime-coordinator-execution";
import { agentInteractionPendingSummarySchema } from "../protocol/agent-interaction";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { profileKindSchema } from "../protocol/profile";
import {
  nonEmptyTrimmedStringFromUnknown,
  optionalBooleanQuerySchema,
} from "../protocol/shared";

const optionalSelectorSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());

export const wakeProgressPhaseSchema = z.enum([
  "sending",
  "request_sent",
  "queued",
  "connecting",
  "running",
  "writing",
  "publishing",
  "publication_unknown",
  "retrying",
  "failed",
  "stopped",
  "replied",
]);

export const WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE =
  "runtime.agent_controller_conversation.occupied" as const;

/** Queued on the computer behind another task that uses the same folder. */
export const WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE =
  "runtime.local_queue.workspace_conflict" as const;

export const wakeProgressWaitReasonCodeSchema = z.enum([
  WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
  WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE,
]);

export const wakeStopEligibilityReasonCodeSchema = z.enum([
  "agent_controller_interface.cancel_required",
  "agent_controller_interface.missing",
  "agent_controller_interface.stop_unsupported",
  "runtime_coordinator.pre_agent_stop_available",
  "runtime_coordinator.pre_agent_stop_unavailable",
]);

export const wakeStopEligibilityReadModelSchema = z.union([
  z.strictObject({
    controlMode: z.literal("openmeld_owned_publication_cancel"),
    reasonCode: z.null(),
    reliability: z.literal("openmeld_owned_publication"),
    status: z.literal("eligible"),
  }),
  z.strictObject({
    controlMode: z.literal("openmeld_owned_pre_agent_cancel"),
    reasonCode: z.null(),
    reliability: z.literal("openmeld_owned_pre_agent"),
    status: z.literal("eligible"),
  }),
  z.strictObject({
    controlMode: z.literal("cancel"),
    reasonCode: z.null(),
    reliability: z.literal("native_cancel"),
    status: z.literal("eligible"),
  }),
  z.strictObject({
    controlMode: z.literal("interrupt"),
    reasonCode: z.null(),
    reliability: z.literal("native_interrupt"),
    status: z.literal("eligible"),
  }),
  z.strictObject({
    controlMode: z.null(),
    reasonCode: wakeStopEligibilityReasonCodeSchema,
    reliability: z.literal("unsupported"),
    status: z.literal("not_eligible"),
  }),
]);

export const wakeProgressItemSchema = z.strictObject({
  deviceWait: z
    .strictObject({
      deadlineAtMs: z.number().int().nonnegative(),
      reason: z.enum([
        "device_offline",
        "agent_not_ready",
        "earlier_work",
        "access_check_unavailable",
        "service_draining",
      ]),
    })
    .optional(),
  clientMessageId: clientMessageIdSchema.nullable(),
  sourceSignalId: z.string().trim().min(1).nullable(),
  sourceContext: z
    .strictObject({
      messagePreview: z.string().trim().min(1).nullable(),
      profileId: z.string().trim().min(1),
      profileKind: profileKindSchema,
      profileName: z.string().trim().min(1).nullable(),
      threadId: z.string().trim().min(1).nullable(),
    })
    .nullable()
    .optional(),
  dispatchId: z.string().trim().min(1).nullable(),
  // Space-owned output placement, independent of source context and stream arrival.
  replyThreadRootSignalId: z.string().trim().min(1).nullable().optional(),
  replyPlacementRevision: z.number().int().nonnegative().optional(),
  runtimeCoordinatorExecutionId:
    runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId
      .nullable()
      .optional(),
  targetProfileId: z.string().trim().min(1),
  targetLabel: z.string().trim().min(1),
  phase: wakeProgressPhaseSchema,
  failureReasonCode: z.string().trim().min(1).nullable().optional(),
  message: z.string().trim().min(1),
  previewText: z.string().trim().min(1).optional(),
  startedAtMs: z.int().min(0).optional(),
  updatedAtMs: z.int().min(0),
  terminal: z.boolean(),
  waitReasonCode: wakeProgressWaitReasonCodeSchema.nullable().optional(),
  wakeStopEligibility: wakeStopEligibilityReadModelSchema.nullable().optional(),
  pendingInteraction: agentInteractionPendingSummarySchema
    .nullable()
    .optional(),
});

export const getSpaceWakeProgressInputSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
  includeReplyPlacement: optionalBooleanQuerySchema,
  clientMessageId: clientMessageIdSchema,
  includePreviewText: optionalBooleanQuerySchema,
  includeTiming: optionalBooleanQuerySchema,
  includeSourceContext: optionalBooleanQuerySchema,
  includeWaitReason: optionalBooleanQuerySchema,
  includeDeviceWait: optionalBooleanQuerySchema,
  includeWakeStopEligibility: optionalBooleanQuerySchema,
  targetProfileId: optionalSelectorSchema,
});

export const getSpaceWakeProgressResponseSchema = z.strictObject({
  query: z.strictObject({
    spaceId: z.string().trim().min(1),
    clientMessageId: clientMessageIdSchema.nullable(),
    targetProfileId: z.string().trim().min(1).nullable(),
  }),
  items: z.array(wakeProgressItemSchema),
});

export const getActiveSpaceWakeProgressInputSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
  includeReplyPlacement: optionalBooleanQuerySchema,
  includePageInfo: optionalBooleanQuerySchema,
  includePreviewText: optionalBooleanQuerySchema,
  includeTiming: optionalBooleanQuerySchema,
  includeSourceContext: optionalBooleanQuerySchema,
  includeWaitReason: optionalBooleanQuerySchema,
  includeDeviceWait: optionalBooleanQuerySchema,
  includeWakeStopEligibility: optionalBooleanQuerySchema,
  sourceProfileId: optionalSelectorSchema,
  targetProfileId: optionalSelectorSchema,
});

export const getActiveSpaceWakeProgressResponseSchema = z.strictObject({
  query: z.strictObject({
    spaceId: z.string().trim().min(1),
    sourceProfileId: z.string().trim().min(1).nullable().optional(),
    targetProfileId: z.string().trim().min(1).nullable(),
  }),
  pageInfo: z
    .strictObject({
      hasMore: z.boolean(),
      limit: z.int().min(1),
    })
    .optional(),
  items: z.array(wakeProgressItemSchema),
});
