import * as z from "zod/v4";
import { productionReleaseScopeSchema } from "./production-scope-lease.ts";

const workerIdentitySchema = z
  .strictObject({
    kind: z.literal("worker"),
    versions: z
      .array(
        z.strictObject({
          versionId: z.string().min(1).max(200),
          percentage: z.number().min(0).max(100),
        })
      )
      .min(1)
      .max(20),
  })
  .superRefine((identity, context) => {
    if (
      Math.abs(
        identity.versions.reduce(
          (total, version) => total + version.percentage,
          0
        ) - 100
      ) > 0.001 ||
      new Set(identity.versions.map((version) => version.versionId)).size !==
        identity.versions.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Worker identity requires unique versions totaling 100% traffic.",
      });
    }
  });

export const productionComponentReceiptSchema = z
  .strictObject({
    attemptId: z.uuid(),
    componentIndex: z.number().int().nonnegative(),
    status: z.enum(["started", "applied", "verified", "failed"]),
    application: z.enum(["unknown", "applied"]),
    identity: z
      .union([
        workerIdentitySchema,
        z.strictObject({ kind: z.literal("release-source") }),
      ])
      .optional(),
  })
  .superRefine((receipt, context) => {
    if (
      (receipt.status === "verified" || receipt.status === "applied") &&
      (receipt.application !== "applied" || !receipt.identity)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed component evidence requires applied identity.",
      });
    }
    if (receipt.application === "unknown" && receipt.identity) {
      context.addIssue({
        code: "custom",
        message: "Unknown application cannot claim an applied identity.",
      });
    }
    if (
      receipt.status === "started" &&
      (receipt.application !== "unknown" || receipt.identity)
    ) {
      context.addIssue({
        code: "custom",
        message: "An attempt marker is not deployment evidence.",
      });
    }
  });

const commonEvidenceFields = {
  evidenceId: z.string().min(1).max(200),
  kind: z.literal("openmeld-guarded-local-release-evidence"),
  recordedAt: z.iso.datetime(),
  scope: productionReleaseScopeSchema,
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
};

export const productionReleaseEvidenceSchema = z.discriminatedUnion(
  "schemaVersion",
  [
    z.strictObject({ ...commonEvidenceFields, schemaVersion: z.literal(1) }),
    z.strictObject({
      ...commonEvidenceFields,
      schemaVersion: z.literal(2),
      receipt: productionComponentReceiptSchema,
    }),
  ]
);

export type ProductionComponentReceipt = z.infer<
  typeof productionComponentReceiptSchema
>;
export type ProductionReleaseEvidence = z.infer<
  typeof productionReleaseEvidenceSchema
>;
