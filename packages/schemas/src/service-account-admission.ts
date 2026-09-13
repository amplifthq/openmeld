import * as z from "zod/v4";

export const SERVICE_ACCOUNT_STOP_REFUSED_CODE =
  "service.account_admission.stop_refused" as const;

export const serviceControlCapabilitiesSchema = z.strictObject({
  deviceId: z.string().min(1).nullable(),
  start: z.boolean(),
  stop: z.boolean(),
});

export const serviceControlCarrierCapabilitySchema = z.strictObject({
  protocol: z.literal("account-checked-service-control-v1"),
  executable: z.string().min(1),
});

export const serviceAccountControlRequestSchema = z.strictObject({
  operation: z.enum(["start", "stop"]),
  expectedAccount: z.string().trim().min(1),
});
export type ServiceAccountControlRequest = z.infer<
  typeof serviceAccountControlRequestSchema
>;

export const serviceAccountAdmissionIdentitySchema = z.strictObject({
  accountId: z.string().min(1),
  authBaseUrl: z.url(),
  clientId: z.string().min(1),
  gatewayUrl: z.url(),
  lane: z.enum(["prod", "dev-local", "canary"]),
  deviceId: z.string().min(1),
  contractGeneration: z.int().positive(),
});

const processIdentitySchema = z.strictObject({
  ownerPid: z.int().positive(),
  ownerProcessStartedAt: z.string().min(1),
});

export const serviceAccountAdmissionSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  operation: z.enum(["start", "stop"]),
  state: z.enum(["pending", "admitted", "cancelled"]),
  identity: serviceAccountAdmissionIdentitySchema,
  requester: processIdentitySchema,
  target: processIdentitySchema.optional(),
  carrier: processIdentitySchema.optional(),
  startupReceipt: z
    .strictObject({
      id: z.uuid(),
      contractBinding: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
});

export type ServiceAccountAdmissionIdentity = z.infer<
  typeof serviceAccountAdmissionIdentitySchema
>;
export type ServiceAccountAdmission = z.infer<
  typeof serviceAccountAdmissionSchema
>;
