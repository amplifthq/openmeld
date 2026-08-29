import * as z from "zod/v4";

// Better Auth owns these endpoints. These schemas mirror the public 1.6.30
// deviceAuthorization route types from
// dist/plugins/device-authorization/index.d.mts so every OpenMeld process
// validates the same external HTTP contract.
export const BETTER_AUTH_DEVICE_AUTHORIZATION_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code" as const;

export const betterAuthDeviceAuthorizationCodeRequestSchema = z.object({
  client_id: z.string().min(1),
  scope: z.string().optional(),
  user_id: z.string().optional(),
});

export const betterAuthDeviceAuthorizationCodeResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  verification_uri_complete: z.string().min(1),
  expires_in: z.number().finite().positive(),
  interval: z.number().finite().positive(),
});

export const betterAuthDeviceAuthorizationStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
]);

export const betterAuthDeviceAuthorizationClaimResponseSchema = z.object({
  user_code: z.string().min(1),
  status: betterAuthDeviceAuthorizationStatusSchema,
});

export const betterAuthDeviceAuthorizationDecisionRequestSchema = z.object({
  userCode: z.string().min(1),
});

export const betterAuthDeviceAuthorizationDecisionResponseSchema = z.object({
  success: z.boolean(),
});

export const betterAuthDeviceAuthorizationTokenRequestSchema = z.object({
  grant_type: z.literal(BETTER_AUTH_DEVICE_AUTHORIZATION_GRANT_TYPE),
  device_code: z.string().min(1),
  client_id: z.string().min(1),
});

export const betterAuthDeviceAuthorizationTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().finite().positive(),
  scope: z.string(),
});

export const betterAuthDeviceAuthorizationErrorResponseSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
  message: z.string().optional(),
  detail: z.string().optional(),
});

export const betterAuthSessionUserSnapshotSchema = z.object({
  id: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
});

export const betterAuthSessionSnapshotResponseSchema = z.nullable(
  z.object({
    session: z.unknown().optional(),
    user: betterAuthSessionUserSnapshotSchema.nullable(),
  })
);

export type BetterAuthDeviceAuthorizationCodeResponse = z.infer<
  typeof betterAuthDeviceAuthorizationCodeResponseSchema
>;
export type BetterAuthDeviceAuthorizationTokenResponse = z.infer<
  typeof betterAuthDeviceAuthorizationTokenResponseSchema
>;
export type BetterAuthSessionUserSnapshot = z.infer<
  typeof betterAuthSessionUserSnapshotSchema
>;
