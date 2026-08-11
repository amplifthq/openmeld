import type { z } from "zod/v4";

type CanonicalMentionLiteralSchema =
  typeof import("../../schemas/protocol/message-envelope")["canonicalMentionLiteralSchema"];
type CanonicalMentionTextFragmentSchema =
  typeof import("../../schemas/protocol/message-envelope")["canonicalMentionTextFragmentSchema"];
type MessageEnvelopeInputSchema =
  typeof import("../../schemas/protocol/message-envelope")["messageEnvelopeInputSchema"];
type MessageEnvelopeSchema =
  typeof import("../../schemas/protocol/message-envelope")["messageEnvelopeSchema"];
type MessageEnvelopeTargetFieldSchema =
  typeof import("../../schemas/protocol/message-envelope")["messageEnvelopeTargetFieldSchema"];
type MessageMentionTypeSchema =
  typeof import("../../schemas/protocol/message-envelope")["messageMentionTypeSchema"];
type SpaceMessageAddressingRelationSchema =
  typeof import("../../schemas/protocol/message-envelope")["spaceMessageAddressingRelationSchema"];
type SpaceMessageAddressingTargetKindSchema =
  typeof import("../../schemas/protocol/message-envelope")["spaceMessageAddressingTargetKindSchema"];

export type CanonicalMentionLiteral = z.infer<CanonicalMentionLiteralSchema>;
export type CanonicalMentionTextFragment =
  z.infer<CanonicalMentionTextFragmentSchema>;
export type MessageEnvelope = z.infer<MessageEnvelopeSchema>;
export type MessageEnvelopeInput = z.infer<MessageEnvelopeInputSchema>;
export type MessageEnvelopeTargetField =
  z.infer<MessageEnvelopeTargetFieldSchema>;
export type MessageMentionType = z.infer<MessageMentionTypeSchema>;
export type SpaceMessageAddressingRelation =
  z.infer<SpaceMessageAddressingRelationSchema>;
export type SpaceMessageAddressingTargetKind =
  z.infer<SpaceMessageAddressingTargetKindSchema>;
