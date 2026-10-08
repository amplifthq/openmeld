import * as z from "zod/v4";
import { productionReleaseScopeSchema } from "./production-scope-lease.ts";

const sha = z.string().regex(/^[0-9a-f]{40}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const trainScope = z.union([
  productionReleaseScopeSchema,
  z.literal("desktop"),
]);

// Admission only: this is neither deployment evidence nor a publication receipt.
export const productionTrainAdmissionSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: sha,
  scopes: z.array(trainScope).min(1),
  artifactScopes: z.array(z.enum(["cli", "desktop", "web", "website", "docs"])),
  producer: z.strictObject({
    repository: z.string().min(1),
    workflowRef: z.string().min(1),
    controlSha: sha,
    runId: z.string().regex(/^[1-9][0-9]*$/u),
    runAttempt: z.string().regex(/^[1-9][0-9]*$/u),
    job: z.literal("validate_release_source"),
  }),
  buildInputs: z.strictObject({
    treeSha: sha,
    lockSha256: sha256,
    node: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
  }),
  artifacts: z.array(
    z.discriminatedUnion("scope", [
      z.strictObject({
        scope: z.literal("cli"),
        integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u),
      }),
      z.strictObject({
        scope: z.enum(["desktop", "web", "website", "docs"]),
        inputIdentity: sha256,
        artifactSha256: sha256,
        receiptSha256: sha256,
        runtime: z.literal("local-workerd-disposable-cookie-key"),
      }),
    ])
  ),
});

export type ProductionTrainAdmission = z.infer<
  typeof productionTrainAdmissionSchema
>;
