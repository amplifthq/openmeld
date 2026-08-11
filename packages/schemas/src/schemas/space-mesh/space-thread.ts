import { z } from "zod/v4";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { trimmedStringFromUnknown } from "../protocol/shared";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const THREAD_ID_PATTERN =
  /^thr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const spaceThreadIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1).max(64).regex(THREAD_ID_PATTERN)
);

export const spaceThreadSchema = z.strictObject({
  threadId: spaceThreadIdSchema,
  spaceId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  rootSignalId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  createdByProfileId: openMeldRuntimeProfileIdSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceThreadContextSchema = z.strictObject({
  threadId: spaceThreadIdSchema,
  rootSignalId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
});

export const spaceThreadSignalPlacementKindSchema = z.enum(["root", "thread"]);

export const spaceThreadSignalPlacementSchema = z.strictObject({
  threadId: spaceThreadIdSchema,
  signalId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  placement: spaceThreadSignalPlacementKindSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceThreadEventTypeSchema = z.enum(["created"]);

export const spaceThreadEventSchema = z.strictObject({
  eventId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  threadId: spaceThreadIdSchema,
  eventType: spaceThreadEventTypeSchema,
  actorProfileId: openMeldRuntimeProfileIdSchema,
  clientMutationId: z.preprocess(
    trimmedStringFromUnknown,
    z.string().min(1).max(200)
  ),
  createdAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceThreadActionRefSchema = z.strictObject({
  threadId: spaceThreadIdSchema,
});
