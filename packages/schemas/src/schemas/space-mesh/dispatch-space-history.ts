import * as z from "zod/v4";

export const dispatchSpaceHistoryRequestSchema = z.strictObject({});

export const dispatchSpaceHistoryResultSchema = z.strictObject({
  spaceId: z.string().min(1),
  sourceSignalId: z.string().min(1),
  beforeCount: z.literal(20),
  afterCount: z.literal(0),
  // Canonical envelopes are decoded by signalTextEnvelopeSchema before this
  // transport projection; its normalizing transforms are not JSON Schema.
  signals: z.array(z.record(z.string(), z.unknown())).max(21),
  nextCursor: z.string().min(1).nullable(),
});
