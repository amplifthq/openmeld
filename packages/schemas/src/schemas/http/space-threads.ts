import * as z from "zod/v4";
import {
  signalEnvelopeSchema,
  signalTextEnvelopeSchema,
} from "../protocol/envelope";
import { messageEnvelopeSchema } from "../protocol/message-envelope";
import { trimmedStringFromUnknown } from "../protocol/shared";
import { signalTextSchema } from "../protocol/signal";
import {
  spaceThreadEventSchema,
  spaceThreadSchema,
  spaceThreadSignalPlacementSchema,
} from "../space-mesh/space-thread";

const clientMutationIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1).max(200)
);
const clientMessageIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1).max(200)
);
const decimalIntegerPattern = /^\d+$/u;
const optionalThreadSignalAnchorSchema = z.preprocess(
  (value) =>
    value === undefined || value === null
      ? undefined
      : trimmedStringFromUnknown(value),
  z.string().min(1).optional()
);
const optionalThreadSignalLimitSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  const normalized = trimmedStringFromUnknown(value);
  return decimalIntegerPattern.test(normalized)
    ? Number.parseInt(normalized, 10)
    : Number.NaN;
}, z.number().int().min(1).max(100).optional());

export const listSpaceThreadSignalsQuerySchema = z
  .strictObject({
    includeWakeContinuation: z.preprocess(
      (value) => (value === "true" ? true : value),
      z.union([z.literal(true), z.literal("conversation")]).optional()
    ),
    afterSignalId: optionalThreadSignalAnchorSchema,
    limit: optionalThreadSignalLimitSchema,
  })
  .superRefine((value, ctx) => {
    if ((value.afterSignalId === undefined) === (value.limit === undefined)) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message:
        "afterSignalId and an integer limit from 1 to 100 are required together",
    });
  });

export const createSpaceThreadBodySchema = z.strictObject({
  rootSignalId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  clientMutationId: clientMutationIdSchema,
});

export const createSpaceThreadResponseSchema = z.strictObject({
  thread: spaceThreadSchema,
  rootSignal: signalEnvelopeSchema,
  placement: spaceThreadSignalPlacementSchema,
});

export const getSpaceThreadResponseSchema = z.strictObject({
  thread: spaceThreadSchema,
  rootSignal: z.union([signalEnvelopeSchema, z.null()]),
});

export const listSpaceThreadEventsResponseSchema = z.strictObject({
  events: z.array(spaceThreadEventSchema),
});

export const spaceThreadPreviewSchema = z.strictObject({
  threadId: spaceThreadSchema.shape.threadId,
  replyCount: z.number().int().min(0),
  signals: z.array(signalEnvelopeSchema),
  placements: z.array(spaceThreadSignalPlacementSchema),
});

export const listSpaceThreadsResponseSchema = z.strictObject({
  threads: z.array(spaceThreadSchema),
  previews: z.array(spaceThreadPreviewSchema).default([]),
});

export const listSpaceThreadSignalsResponseSchema = z.strictObject({
  wakeContinuation: z
    .strictObject({
      targetProfileId: z.string().min(1).nullable(),
      automaticTargetProfileId: z.string().min(1).nullable().optional(),
    })
    .optional(),
  signals: z.array(signalEnvelopeSchema),
  placements: z.array(spaceThreadSignalPlacementSchema),
});

export const postSpaceThreadSignalBodySchema = z
  .strictObject({
    threadWakeContinuation: z.literal(true).optional(),
    text: signalTextSchema.shape.data.shape.text,
    deviceWait: signalTextSchema.shape.data.shape.deviceWait.optional(),
    contextSelection:
      signalTextSchema.shape.data.shape.contextSelection.optional(),
    files: signalTextSchema.shape.data.shape.files.optional(),
    messageEnvelope: messageEnvelopeSchema.optional(),
    clientMessageId: clientMessageIdSchema,
    authorHasRead:
      signalTextSchema.shape.data.shape.meta.unwrap().shape.authorHasRead,
    restoredFromSignalId:
      signalTextSchema.shape.data.shape.meta.unwrap().shape
        .restoredFromSignalId,
  })
  .superRefine((value, ctx) => {
    const parsed = signalTextSchema.shape.data.safeParse({
      text: value.text,
      ...(value.files ? { files: value.files } : {}),
      ...(value.messageEnvelope
        ? { messageEnvelope: value.messageEnvelope }
        : {}),
      meta: {
        clientMessageId: value.clientMessageId,
      },
    });
    if (parsed.success) {
      return;
    }
    const firstIssue = parsed.error.issues[0];
    ctx.addIssue({
      code: "custom",
      path: firstIssue?.path ?? [],
      message: firstIssue?.message ?? "Invalid thread signal payload",
    });
  });

export const postSpaceThreadSignalResponseSchema = z.strictObject({
  signal: signalTextEnvelopeSchema,
  placement: spaceThreadSignalPlacementSchema,
});
