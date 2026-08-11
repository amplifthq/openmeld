import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type PresenceEnvelopeSchema =
  typeof import("../../schemas/protocol/envelope")["presenceEnvelopeSchema"];
type SignalStatusEnvelopeSchema =
  typeof import("../../schemas/protocol/envelope")["signalStatusEnvelopeSchema"];
type SignalTextEnvelopeSchema =
  typeof import("../../schemas/protocol/envelope")["signalTextEnvelopeSchema"];
type SignalSystemNoticeEnvelopeSchema =
  typeof import("../../schemas/protocol/envelope")["signalSystemNoticeEnvelopeSchema"];
type SignalEnvelopeSchema =
  typeof import("../../schemas/protocol/envelope")["signalEnvelopeSchema"];
type IncomingServerMessageSchema =
  typeof import("../../schemas/protocol/envelope")["incomingServerMessageSchema"];
type ServerErrorFrameSchema =
  typeof import("../../schemas/protocol/server-error")["serverErrorFrameSchema"];
type SpaceLiveSignalFrameSchema =
  typeof import("../../schemas/protocol/envelope")["spaceLiveSignalFrameSchema"];
type SpaceLiveInvalidationFrameSchema =
  typeof import("../../schemas/protocol/envelope")["spaceLiveInvalidationFrameSchema"];

export type PresenceEnvelope = z.infer<PresenceEnvelopeSchema>;
export type SignalStatusEnvelope = z.infer<SignalStatusEnvelopeSchema>;
export type SignalTextEnvelope = z.infer<SignalTextEnvelopeSchema>;
export type SignalSystemNoticeEnvelope =
  z.infer<SignalSystemNoticeEnvelopeSchema>;
export type SignalEnvelope = z.infer<SignalEnvelopeSchema>;
export type IncomingServerMessage = z.infer<IncomingServerMessageSchema>;
export type ServerErrorFrame = z.infer<ServerErrorFrameSchema>;
export type SpaceLiveSignalFrame = z.infer<SpaceLiveSignalFrameSchema>;
export type SpaceLiveInvalidationFrame =
  z.infer<SpaceLiveInvalidationFrameSchema>;
