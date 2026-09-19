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

const legacyComponentReceiptSchema = z
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

// Version 3 records identity obtained from this guarded command, not merely a
// snapshot of whichever version happened to be current. Legacy records stay readable.
export const productionWorkerDeploymentContextSchema = z.strictObject({
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  operationKey: z.string().regex(/^[0-9a-f]{64}$/u),
  workerName: z.string().min(1).max(200),
  projectionTag: z.string().min(1).max(200).optional(),
});
export const productionCoreActivationSchema = z.strictObject({
  type: z.literal("openmeld-core-activation"),
  version: z.literal(1),
  timestamp: z.iso.datetime(),
  worker_name: z.string().min(1).max(200),
  version_id: z.string().min(1).max(200),
  source_sha: z.string().regex(/^[0-9a-f]{40}$/u),
  projection_tag: z.string().min(1).max(200),
  operation_key: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const productionWorkerDeploymentIdentitySchema = z.strictObject({
  kind: z.literal("worker-deployment"),
  workerName: z.string().min(1).max(200),
  environment: z.literal("prod"),
  deploymentId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200),
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  projectionTag: z.string().min(1).max(200).optional(),
  proof: z.enum(["command-output", "cli-projection"]),
});

export const correlatedComponentReceiptSchema = z
  .strictObject({
    attemptId: z.uuid(),
    componentIndex: z.number().int().nonnegative(),
    operationKey: z.string().regex(/^[0-9a-f]{64}$/u),
    startedAt: z.iso.datetime(),
    status: z.enum(["started", "applied", "verified", "failed"]),
    application: z.enum(["unknown", "applied"]),
    identity: z
      .union([
        productionWorkerDeploymentIdentitySchema,
        z.strictObject({ kind: z.literal("release-source") }),
      ])
      .optional(),
  })
  .superRefine((receipt, context) => {
    if (
      ((receipt.status === "applied" || receipt.status === "verified") &&
        (receipt.application !== "applied" || !receipt.identity)) ||
      (receipt.application === "unknown" && receipt.identity) ||
      (receipt.status === "started" && receipt.application !== "unknown")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Receipt state does not prove its claimed application/identity.",
      });
    }
  });
export const productionComponentReceiptSchema = z.union([
  correlatedComponentReceiptSchema,
  legacyComponentReceiptSchema,
]);

const commonEvidenceFields = {
  evidenceId: z.string().min(1).max(200),
  kind: z.literal("openmeld-guarded-local-release-evidence"),
  recordedAt: z.iso.datetime(),
  scope: productionReleaseScopeSchema,
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
};

export const productionReleaseEvidenceSchema = z
  .discriminatedUnion("schemaVersion", [
    z.strictObject({ ...commonEvidenceFields, schemaVersion: z.literal(1) }),
    z.strictObject({
      ...commonEvidenceFields,
      schemaVersion: z.literal(2),
      receipt: legacyComponentReceiptSchema,
    }),
    z.strictObject({
      ...commonEvidenceFields,
      schemaVersion: z.literal(3),
      receipt: correlatedComponentReceiptSchema,
    }),
  ])
  .superRefine((evidence, context) => {
    if (
      evidence.schemaVersion === 3 &&
      evidence.receipt.identity?.kind === "worker-deployment" &&
      evidence.receipt.identity.sourceSha !== evidence.sourceSha
    ) {
      context.addIssue({
        code: "custom",
        message: "Worker identity must belong to the receipt source SHA.",
      });
    }
  });

export type ProductionComponentReceipt = z.infer<
  typeof productionComponentReceiptSchema
>;
export type ProductionReleaseEvidence = z.infer<
  typeof productionReleaseEvidenceSchema
>;
