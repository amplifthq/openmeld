import * as z from "zod/v4";

export const PRODUCTION_RELEASE_SCOPE_VALUES = [
  "auth",
  "cli",
  "core",
  "db",
  "gateway",
  "remote-agent",
  "web",
] as const;

export const PRODUCTION_SCOPE_LEASE_SCHEMA_VERSION = 1 as const;

export const productionReleaseScopeSchema = z.enum(
  PRODUCTION_RELEASE_SCOPE_VALUES
);

export const productionScopeLeaseSchema = z
  .strictObject({
    expiresAt: z.iso.datetime(),
    kind: z.literal("openmeld-production-scope-lease"),
    leaseId: z.uuid(),
    owner: z.string().trim().min(1).max(1024),
    schemaVersion: z.literal(PRODUCTION_SCOPE_LEASE_SCHEMA_VERSION),
    scope: productionReleaseScopeSchema,
    sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
    startedAt: z.iso.datetime(),
  })
  .superRefine((lease, context) => {
    if (Date.parse(lease.expiresAt) <= Date.parse(lease.startedAt)) {
      context.addIssue({
        code: "custom",
        message: "Production scope lease expiry must follow its start.",
        path: ["expiresAt"],
      });
    }
  });

export type ProductionReleaseScope = z.infer<
  typeof productionReleaseScopeSchema
>;
export type ProductionScopeLease = z.infer<typeof productionScopeLeaseSchema>;
