import * as z from "zod/v4";

export const MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION = 2 as const;
export const MAC_OS_KEYCHAIN_AUTHENTICATION_INTERACTION = "disallow" as const;

const macOsKeychainServiceSchema = z.string().trim().min(1).max(512);
const macOsKeychainAccountSchema = z.string().trim().min(1).max(512);
const macOsKeychainAccessTokenSchema = z.string().min(1).max(65_536);

export const macOsKeychainHelperOperationSchema = z.enum([
  "store",
  "read",
  "delete",
]);

export const macOsKeychainHelperRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      schemaVersion: z.literal(MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION),
      operation: z.literal("store"),
      service: macOsKeychainServiceSchema,
      account: macOsKeychainAccountSchema,
      accessToken: macOsKeychainAccessTokenSchema,
      authenticationInteraction: z.literal(
        MAC_OS_KEYCHAIN_AUTHENTICATION_INTERACTION
      ),
    }),
    z.strictObject({
      schemaVersion: z.literal(MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION),
      operation: z.literal("read"),
      service: macOsKeychainServiceSchema,
      account: macOsKeychainAccountSchema,
      authenticationInteraction: z.literal(
        MAC_OS_KEYCHAIN_AUTHENTICATION_INTERACTION
      ),
    }),
    z.strictObject({
      schemaVersion: z.literal(MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION),
      operation: z.literal("delete"),
      service: macOsKeychainServiceSchema,
      account: macOsKeychainAccountSchema,
      authenticationInteraction: z.literal(
        MAC_OS_KEYCHAIN_AUTHENTICATION_INTERACTION
      ),
    }),
  ]
);

const macOsKeychainHelperMutationSuccessSchema = z.strictObject({
  schemaVersion: z.literal(MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION),
  ok: z.literal(true),
  operation: z.enum(["store", "delete"]),
});

const macOsKeychainHelperReadSuccessSchema = z.strictObject({
  schemaVersion: z.literal(MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION),
  ok: z.literal(true),
  operation: z.literal("read"),
  accessToken: z.union([macOsKeychainAccessTokenSchema, z.null()]),
});

const macOsKeychainHelperErrorSchema = z.strictObject({
  schemaVersion: z.literal(MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION),
  ok: z.literal(false),
  operation: macOsKeychainHelperOperationSchema,
  errorMessage: z.string().trim().min(1).max(2048),
});

export const macOsKeychainHelperResponseSchema = z.union([
  macOsKeychainHelperMutationSuccessSchema,
  macOsKeychainHelperReadSuccessSchema,
  macOsKeychainHelperErrorSchema,
]);

export type MacOsKeychainHelperRequest = z.infer<
  typeof macOsKeychainHelperRequestSchema
>;
export type MacOsKeychainHelperResponse = z.infer<
  typeof macOsKeychainHelperResponseSchema
>;
