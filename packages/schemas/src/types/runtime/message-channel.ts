import type { z } from "zod/v4";

type MessageChannelConversationLocatorSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelConversationLocatorSchema"];
type MessageChannelEventKindSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelEventKindSchema"];
type MessageChannelIngressEnvelopeSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelIngressEnvelopeSchema"];
type MessageChannelMentionTypeSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelMentionTypeSchema"];
type MessageChannelParticipantIdentitySchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelParticipantIdentitySchema"];
type MessageChannelProviderSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelProviderSchema"];
type MessageChannelResourceDescriptorSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelResourceDescriptorSchema"];
type MessageChannelResourceTypeSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelResourceTypeSchema"];
type MessageChannelTransportSchema =
  typeof import("../../schemas/runtime/message-channel")["messageChannelTransportSchema"];
type NormalizedMessageChannelEventSchema =
  typeof import("../../schemas/runtime/message-channel")["normalizedMessageChannelEventSchema"];

export type MessageChannelConversationLocator =
  z.infer<MessageChannelConversationLocatorSchema>;
export type MessageChannelEventKind = z.infer<MessageChannelEventKindSchema>;
export type MessageChannelIngressEnvelope =
  z.infer<MessageChannelIngressEnvelopeSchema>;
export type MessageChannelMentionType =
  z.infer<MessageChannelMentionTypeSchema>;
export type MessageChannelParticipantIdentity =
  z.infer<MessageChannelParticipantIdentitySchema>;
export type MessageChannelProvider = z.infer<MessageChannelProviderSchema>;
export type MessageChannelResourceDescriptor =
  z.infer<MessageChannelResourceDescriptorSchema>;
export type MessageChannelResourceType =
  z.infer<MessageChannelResourceTypeSchema>;
export type MessageChannelTransport = z.infer<MessageChannelTransportSchema>;
export type NormalizedMessageChannelEvent =
  z.infer<NormalizedMessageChannelEventSchema>;
