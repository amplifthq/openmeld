import type { z } from "zod/v4";

type MessageChannelConnectionListResponseSchema =
  typeof import("../../schemas/http/message-channels")["messageChannelConnectionListResponseSchema"];
type MessageChannelConnectionProjectionSchema =
  typeof import("../../schemas/http/message-channels")["messageChannelConnectionProjectionSchema"];
type MessageChannelConnectionStatusSchema =
  typeof import("../../schemas/http/message-channels")["messageChannelConnectionStatusSchema"];
type MessageChannelIdentityLinkConsumeBodySchema =
  typeof import("../../schemas/http/message-channels")["messageChannelIdentityLinkConsumeBodySchema"];
type MessageChannelIdentityLinkConsumeResponseSchema =
  typeof import("../../schemas/http/message-channels")["messageChannelIdentityLinkConsumeResponseSchema"];
type MessageChannelIdentityLinkPreviewBodySchema =
  typeof import("../../schemas/http/message-channels")["messageChannelIdentityLinkPreviewBodySchema"];
type MessageChannelIdentityLinkPreviewResponseSchema =
  typeof import("../../schemas/http/message-channels")["messageChannelIdentityLinkPreviewResponseSchema"];
type MessageChannelIdentityLinkTokenSchema =
  typeof import("../../schemas/http/message-channels")["messageChannelIdentityLinkTokenSchema"];
type LarkPlatformWebhookVerificationInputSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformWebhookVerificationInputSchema"];
type LarkPlatformWebhookVerificationResponseSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformWebhookVerificationResponseSchema"];
type LarkPlatformRegistrationAttemptProjectionSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformRegistrationAttemptProjectionSchema"];
type LarkPlatformRegistrationBeginModeSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformRegistrationBeginModeSchema"];
type LarkPlatformRegistrationResponseSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformRegistrationResponseSchema"];
type LarkPlatformProviderSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformProviderSchema"];
type LarkPlatformActiveRegistrationListResponseSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformActiveRegistrationListResponseSchema"];
type LarkPlatformActiveRegistrationProjectionSchema =
  typeof import("../../schemas/http/message-channels")["larkPlatformActiveRegistrationProjectionSchema"];

export type MessageChannelConnectionListResponse =
  z.infer<MessageChannelConnectionListResponseSchema>;
export type MessageChannelConnectionProjection =
  z.infer<MessageChannelConnectionProjectionSchema>;
export type MessageChannelConnectionStatus =
  z.infer<MessageChannelConnectionStatusSchema>;
export type MessageChannelIdentityLinkConsumeBody =
  z.infer<MessageChannelIdentityLinkConsumeBodySchema>;
export type MessageChannelIdentityLinkConsumeResponse =
  z.infer<MessageChannelIdentityLinkConsumeResponseSchema>;
export type MessageChannelIdentityLinkPreviewBody =
  z.infer<MessageChannelIdentityLinkPreviewBodySchema>;
export type MessageChannelIdentityLinkPreviewResponse =
  z.infer<MessageChannelIdentityLinkPreviewResponseSchema>;
export type MessageChannelIdentityLinkToken =
  z.infer<MessageChannelIdentityLinkTokenSchema>;
export type LarkPlatformWebhookVerificationInput =
  z.infer<LarkPlatformWebhookVerificationInputSchema>;
export type LarkPlatformWebhookVerificationResponse =
  z.infer<LarkPlatformWebhookVerificationResponseSchema>;
export type LarkPlatformRegistrationAttemptProjection =
  z.infer<LarkPlatformRegistrationAttemptProjectionSchema>;
export type LarkPlatformRegistrationBeginMode =
  z.infer<LarkPlatformRegistrationBeginModeSchema>;
export type LarkPlatformRegistrationResponse =
  z.infer<LarkPlatformRegistrationResponseSchema>;
export type LarkPlatformProvider = z.infer<LarkPlatformProviderSchema>;
export type LarkPlatformActiveRegistrationListResponse =
  z.infer<LarkPlatformActiveRegistrationListResponseSchema>;
export type LarkPlatformActiveRegistrationProjection =
  z.infer<LarkPlatformActiveRegistrationProjectionSchema>;
