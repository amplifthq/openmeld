import { z } from "zod/v4";

const domain = z.object({
  id: z.string().min(1),
  hostname: z.string().min(1),
  service: z.string().min(1),
  environment: z.literal("production"),
  zone_id: z.string().min(1),
});
const deployment = z.object({
  id: z.string().min(1),
  versionId: z.string().uuid(),
});
const state = z.object({
  root: domain,
  app: domain.nullable(),
  web: deployment,
  auth: deployment,
  website: deployment.nullable(),
  authOrigins: z.array(z.string()),
});

// Operator evidence describes real browser checks against these exact versions.
// It is never inferred from an HTTP health probe or an attached hostname.
export const websiteDomainMigrationSchema = z.object({
  schemaVersion: z.literal(1),
  accountId: z.string().min(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/u),
  environment: z.enum(["prod", "stg"]),
  before: state,
  lastObserved: state,
  appSmoke: z
    .object({
      webVersionId: z.string().uuid(),
      authVersionId: z.string().uuid(),
      login: z.literal(true),
      existingSession: z.literal(true),
      spaceReadWrite: z.literal(true),
      signOut: z.literal(true),
      unsentDraftsHandled: z.literal(true),
      evidence: z.string().min(1),
    })
    .nullable(),
});
