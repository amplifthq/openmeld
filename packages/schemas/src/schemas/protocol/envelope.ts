import * as z from "zod/v4";
import {
  spaceThreadContextSchema,
  spaceThreadSignalPlacementSchema,
} from "../space-mesh/space-thread";
import {
  spaceAgentStreamDeltaFrameSchema,
  spaceAgentStreamPartFrameSchema,
  spaceAgentStreamTerminalFrameSchema,
} from "./agent-stream";
import { helloAckSchema } from "./hello";
import { profileSchema } from "./profile";
import { serverErrorFrameSchema } from "./server-error";
import {
  finiteIntegerNumber,
  nonEmptyTrimmedStringFromUnknown,
} from "./shared";
import {
  signalStatusDataSchema,
  signalSystemNoticeDataSchema,
  signalTextDataSchema,
} from "./signal";

const baseEnvelopeShape = {
  v: z.literal(1),
  id: nonEmptyTrimmedStringFromUnknown,
  spaceId: nonEmptyTrimmedStringFromUnknown,
  ts: finiteIntegerNumber,
  profile: profileSchema,
};

const presenceDataSchema = z.record(z.string(), z.unknown());

export const presenceEnvelopeSchema = z.object({
  ...baseEnvelopeShape,
  type: z.enum(["presence.join", "presence.quit"]),
  data: presenceDataSchema,
});

export const signalTextEnvelopeSchema = z.object({
  ...baseEnvelopeShape,
  type: z.literal("signal.text"),
  data: signalTextDataSchema,
});

export const signalStatusEnvelopeSchema = z.object({
  ...baseEnvelopeShape,
  type: z.literal("signal.status"),
  data: signalStatusDataSchema,
});

export const signalSystemNoticeEnvelopeSchema = z.object({
  ...baseEnvelopeShape,
  type: z.literal("signal.system_notice"),
  data: signalSystemNoticeDataSchema,
});

export const signalEnvelopeSchema = z.union([
  presenceEnvelopeSchema,
  signalTextEnvelopeSchema,
  signalStatusEnvelopeSchema,
  signalSystemNoticeEnvelopeSchema,
]);

export const spaceLiveSignalFrameSchema = z.strictObject({
  type: z.literal("space.signal"),
  signal: signalEnvelopeSchema,
  history: z
    .strictObject({
      persisted: z.boolean(),
    })
    .optional(),
  threadContext: spaceThreadContextSchema.optional(),
  threadPlacement: spaceThreadSignalPlacementSchema.optional(),
});

export const spaceLiveInvalidationFrameSchema = z.strictObject({
  type: z.enum([
    "space.members.changed",
    "space.meta.changed",
    "space.files.changed",
    "agent.readiness.invalidated",
    "wake.progress.changed",
  ]),
  spaceId: nonEmptyTrimmedStringFromUnknown,
  version: finiteIntegerNumber,
  profileIds: z.array(nonEmptyTrimmedStringFromUnknown).optional(),
  agentProfileIds: z.array(nonEmptyTrimmedStringFromUnknown).optional(),
  clientMessageIds: z.array(nonEmptyTrimmedStringFromUnknown).optional(),
  reason: nonEmptyTrimmedStringFromUnknown.optional(),
});

export const incomingServerMessageSchema = z.union([
  signalEnvelopeSchema,
  spaceLiveSignalFrameSchema,
  spaceLiveInvalidationFrameSchema,
  spaceAgentStreamDeltaFrameSchema,
  spaceAgentStreamPartFrameSchema,
  spaceAgentStreamTerminalFrameSchema,
  helloAckSchema,
  serverErrorFrameSchema,
]);
