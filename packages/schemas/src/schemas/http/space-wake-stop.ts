import { z } from "zod/v4";
import {
  runtimeCoordinatorCancellationStateSchema,
  runtimeCoordinatorExecutionRecordSchema,
} from "../daemon/runtime-coordinator-execution";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";

const boundedReasonCodeSchema = z.string().trim().min(1).max(160);
const boundedSelectorIdSchema = z.string().trim().min(1).max(512);
const wakeStopReasonSchema = z.string().trim().min(1).max(512);

export const spaceWakeStopSelectorSchema = z.discriminatedUnion("by", [
  z.strictObject({
    by: z.literal("source_signal"),
    sourceSignalId: boundedSelectorIdSchema,
    targetProfileId: boundedSelectorIdSchema,
  }),
  z.strictObject({
    by: z.literal("client_message"),
    clientMessageId: clientMessageIdSchema,
    targetProfileId: boundedSelectorIdSchema,
  }),
]);

export const postSpaceWakeStopBodySchema = z.strictObject({
  reason: wakeStopReasonSchema.optional(),
  target: spaceWakeStopSelectorSchema,
});

export const postSpaceWakeStopInputSchema = z.strictObject({
  body: postSpaceWakeStopBodySchema,
  spaceId: nonEmptyTrimmedStringFromUnknown,
});

const spaceWakeStopResponseBaseSchema = z.strictObject({
  targetProfileId: boundedSelectorIdSchema,
});

const wakeStopExecutionIdSchema =
  runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId;

const wakeStopModeSchema = z.enum([
  "openmeld_owned_pre_agent",
  "controller_control",
  "remote_agent_native_delivery",
]);

const wakeStopRequestPendingCancellationStateSchema =
  runtimeCoordinatorCancellationStateSchema.extend({
    status: z.enum(["requested", "delivery_pending"]),
  });

const wakeStopCancelledCancellationStateSchema =
  runtimeCoordinatorCancellationStateSchema.extend({
    status: z.literal("cancelled"),
  });

const wakeStopNotRequestedCancellationStateSchema =
  runtimeCoordinatorCancellationStateSchema.extend({
    status: z.literal("not_requested"),
  });

const wakeStopNotStoppableCancellationStateSchema =
  runtimeCoordinatorCancellationStateSchema.extend({
    status: z.enum(["not_requested", "local_control_rejected"]),
  });

const wakeStopUnsupportedCancellationStateSchema =
  runtimeCoordinatorCancellationStateSchema.extend({
    status: z.literal("unsupported"),
  });

const wakeStopRetryLaterCancellationStateSchema =
  runtimeCoordinatorCancellationStateSchema.extend({
    status: z.literal("delivery_rejected"),
  });

const wakeStopSuccessResponseBaseSchema =
  spaceWakeStopResponseBaseSchema.extend({
    ok: z.literal(true),
    runtimeCoordinatorExecutionId: wakeStopExecutionIdSchema.nullable(),
    stopMode: wakeStopModeSchema.optional(),
  });

const wakeStopFailureResponseBaseSchema =
  spaceWakeStopResponseBaseSchema.extend({
    ok: z.literal(false),
    reasonCode: boundedReasonCodeSchema,
    runtimeCoordinatorExecutionId: wakeStopExecutionIdSchema.nullable(),
  });

export const postSpaceWakeStopResponseSchema = z
  .discriminatedUnion("status", [
    wakeStopSuccessResponseBaseSchema.extend({
      cancellationState: wakeStopRequestPendingCancellationStateSchema,
      status: z.literal("cancellation_requested"),
    }),
    wakeStopSuccessResponseBaseSchema.extend({
      cancellationState: wakeStopCancelledCancellationStateSchema,
      status: z.literal("cancelled"),
    }),
    wakeStopSuccessResponseBaseSchema.extend({
      cancellationState: wakeStopCancelledCancellationStateSchema,
      status: z.literal("already_cancelled"),
    }),
    wakeStopFailureResponseBaseSchema.extend({
      cancellationState: wakeStopNotRequestedCancellationStateSchema,
      status: z.literal("not_found"),
    }),
    wakeStopFailureResponseBaseSchema.extend({
      cancellationState: wakeStopNotStoppableCancellationStateSchema,
      status: z.literal("not_stoppable"),
    }),
    wakeStopFailureResponseBaseSchema.extend({
      cancellationState: wakeStopUnsupportedCancellationStateSchema,
      status: z.literal("unsupported"),
    }),
    wakeStopFailureResponseBaseSchema.extend({
      cancellationState: wakeStopRetryLaterCancellationStateSchema,
      status: z.literal("retry_later"),
    }),
  ])
  .superRefine((response, context) => {
    if (!response.ok) {
      return;
    }

    if (response.status === "cancellation_requested") {
      if (
        response.runtimeCoordinatorExecutionId === null &&
        response.stopMode !== "remote_agent_native_delivery"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "controller-backed cancellation requests require a RuntimeCoordinator execution id",
          path: ["runtimeCoordinatorExecutionId"],
        });
      }
      if (response.stopMode === "openmeld_owned_pre_agent") {
        context.addIssue({
          code: "custom",
          message:
            "pre-agent Stop must be terminal cancelled, not cancellation_requested",
          path: ["stopMode"],
        });
      }
      return;
    }

    if (response.runtimeCoordinatorExecutionId === null) {
      if (
        response.stopMode !== "openmeld_owned_pre_agent" &&
        response.stopMode !== "remote_agent_native_delivery"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Wake Stop success without an execution id must name its OpenMeld-owned stop mode",
          path: ["stopMode"],
        });
      }
      return;
    }

    if (response.stopMode === "openmeld_owned_pre_agent") {
      context.addIssue({
        code: "custom",
        message:
          "OpenMeld-owned pre-agent Stop must not carry a RuntimeCoordinator execution id",
        path: ["runtimeCoordinatorExecutionId"],
      });
    }
  });
