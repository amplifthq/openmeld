import * as z from "zod/v4";
import { cliBinaryCompressedReleaseSchema } from "../http/cli-binary-manifest.ts";
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
  proof: z.enum(["command-output", "cli-projection", "reconciled-hosted"]),
});

export const productionCliReleaseIdentitySchema = z.strictObject({
  kind: z.literal("cli-release"),
  version: z.string().min(1).max(200),
  tagName: z.string().min(1).max(200),
  npmPackage: z.literal("openmeld"),
  artifact: cliBinaryCompressedReleaseSchema.extend({
    platform: z.string().min(1).max(100),
  }),
});

const productionAppliedIdentitySchema = z.union([
  productionWorkerDeploymentIdentitySchema,
  productionCliReleaseIdentitySchema,
  z.strictObject({ kind: z.literal("release-source") }),
]);

export const retainedRemoteContainerSchema = z.strictObject({
  id: z.string().min(1),
  name: z.literal("openmeld-agent-computer"),
  version: z.number().int().nonnegative(),
  image: z.string().regex(/@sha256:[0-9a-f]{64}$/u),
  configurationHash: z.string().regex(/^[0-9a-f]{64}$/u),
  instances: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        version: z.number().int().nonnegative(),
      })
    )
    .min(1),
});

const remoteAgentReleaseStageSchema = z.strictObject({
  phase: z.enum(["worker-only", "retained", "rollout", "complete"]),
  container: retainedRemoteContainerSchema,
  baselineEvidenceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  baselineSourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  workerIdentity: productionWorkerDeploymentIdentitySchema.optional(),
});

export const correlatedComponentReceiptSchema = z
  .strictObject({
    attemptId: z.uuid(),
    componentIndex: z.number().int().nonnegative(),
    operationKey: z.string().regex(/^[0-9a-f]{64}$/u),
    startedAt: z.iso.datetime(),
    status: z.enum(["started", "applied", "verified", "failed"]),
    application: z.enum(["unknown", "applied"]),
    identity: productionAppliedIdentitySchema.optional(),
    remoteAgent: remoteAgentReleaseStageSchema.optional(),
  })
  .superRefine((receipt, context) => {
    if (
      receipt.remoteAgent &&
      ((receipt.status === "verified" &&
        receipt.remoteAgent.phase !== "complete") ||
        (["retained", "rollout", "complete"].includes(
          receipt.remoteAgent.phase
        ) &&
          !receipt.remoteAgent.workerIdentity))
    ) {
      context.addIssue({
        code: "custom",
        message: "Remote Agent release stage does not prove completion.",
      });
    }
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
const remoteAgentRecoverySchema = z.strictObject({
  id: z.uuid(),
  originalEvidenceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  startedAt: z.iso.datetime(),
  nativeProvenance: z
    .strictObject({
      evidenceSha: z.string().regex(/^[0-9a-f]{40}$/u),
      sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
      workerVersionId: z.string().min(1).max(200),
      container: retainedRemoteContainerSchema.omit({ instances: true }),
    })
    .optional(),
  baseline: z.strictObject({
    workerDeploymentId: z.string().min(1).max(200),
    workerVersionId: z.string().min(1).max(200),
    containerId: z.string().min(1).max(200),
    containerVersion: z.number().int().nonnegative(),
    containerImage: z.string().min(1).max(500),
  }),
  completed: z
    .strictObject({
      containerVersion: z.number().int().nonnegative(),
      containerImage: z.string().min(1).max(500),
      observedAt: z.iso.datetime(),
      activeRolloutId: z.null(),
      healthyInstances: z.number().int().positive(),
      activeInstances: z.number().int().nonnegative(),
    })
    .optional(),
  observedAfterFailure: z
    .strictObject({
      workerDeploymentId: z.string().min(1).max(200),
      workerVersionId: z.string().min(1).max(200),
      containerVersion: z.number().int().nonnegative(),
      containerImage: z.string().min(1).max(500),
      observedAt: z.iso.datetime(),
    })
    .optional(),
});

// The canonical receipt stays v3 for older release readers. This v4 proof is
// its second Git parent; the first parent preserves the original failed event.
// The baseline never attributes the partial Worker to the failed command.
export const recoveredComponentReceiptSchema = z
  .strictObject({
    attemptId: z.uuid(),
    componentIndex: z.number().int().nonnegative(),
    operationKey: z.string().regex(/^[0-9a-f]{64}$/u),
    startedAt: z.iso.datetime(),
    status: z.enum(["verified", "failed"]),
    application: z.enum(["unknown", "applied"]),
    identity: productionWorkerDeploymentIdentitySchema.optional(),
    recovery: remoteAgentRecoverySchema,
  })
  .superRefine((receipt, context) => {
    if (
      (receipt.status === "verified" &&
        (receipt.application !== "applied" ||
          !receipt.identity ||
          !receipt.recovery.completed)) ||
      (receipt.status === "failed" &&
        (receipt.application !== "unknown" || receipt.identity))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Recovery receipt requires a verified Worker and container target.",
      });
    }
  });
export const productionComponentReceiptSchema = z.union([
  correlatedComponentReceiptSchema,
  recoveredComponentReceiptSchema,
  legacyComponentReceiptSchema,
]);

const commonEvidenceFields = {
  evidenceId: z.string().min(1).max(200),
  kind: z.literal("openmeld-guarded-local-release-evidence"),
  recordedAt: z.iso.datetime(),
  scope: productionReleaseScopeSchema,
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
};

export const coreReceiverReconciliationSchema = z.strictObject({
  kind: z.literal("reconciled-hosted-core-receiver"),
  repository: z.literal("amplifthq/openmeld"),
  runId: z.number().int().positive(),
  runAttempt: z.number().int().positive(),
  jobId: z.number().int().positive(),
  controlSha: z.string().regex(/^[0-9a-f]{40}$/u),
  deployedAt: z.iso.datetime({ offset: true }),
  supersededReceipt: z.strictObject({
    evidenceSha: z.string().regex(/^[0-9a-f]{40}$/u),
    sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
    completionRunId: z.number().int().positive(),
  }),
  startupArtifact: z.strictObject({
    id: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    startupTimeMs: z.number().nonnegative(),
  }),
  stableProjection: z.strictObject({
    tagName: z.string().min(1),
    sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
});

export const postgresqlRollbackReconciliationSchema = z.strictObject({
  kind: z.literal("reconciled-postgresql-rollback"),
  verifiedAt: z.iso.datetime(),
  supersededReceipt: z.strictObject({
    evidenceSha: z.string().regex(/^[0-9a-f]{40}$/u),
    sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  }),
  baselineReceipt: z.strictObject({
    evidenceSha: z.string().regex(/^[0-9a-f]{40}$/u),
    sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  }),
});

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
    z.strictObject({
      ...commonEvidenceFields,
      schemaVersion: z.literal(4),
      receipt: recoveredComponentReceiptSchema,
    }),
    z.strictObject({
      ...commonEvidenceFields,
      schemaVersion: z.literal(5),
      receipt: correlatedComponentReceiptSchema,
      reconciliation: coreReceiverReconciliationSchema,
    }),
    z.strictObject({
      ...commonEvidenceFields,
      schemaVersion: z.literal(6),
      receipt: correlatedComponentReceiptSchema,
      reconciliation: postgresqlRollbackReconciliationSchema,
    }),
  ])
  .superRefine((evidence, context) => {
    if (
      evidence.schemaVersion === 6 &&
      (evidence.scope !== "db" ||
        evidence.receipt.status !== "started" ||
        evidence.receipt.application !== "unknown" ||
        evidence.receipt.identity ||
        Date.parse(evidence.reconciliation.verifiedAt) >
          Date.parse(evidence.receipt.startedAt) ||
        evidence.sourceSha ===
          evidence.reconciliation.supersededReceipt.sourceSha)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "PostgreSQL rollback proof requires a new-source database start event.",
      });
    }
    if (
      evidence.schemaVersion === 5 &&
      (evidence.scope !== "core" ||
        evidence.receipt.status !== "applied" ||
        evidence.receipt.application !== "applied" ||
        evidence.receipt.identity?.kind !== "worker-deployment" ||
        evidence.receipt.identity.sourceSha !== evidence.sourceSha ||
        evidence.receipt.identity.workerName !== "openmeld-core-prod" ||
        evidence.receipt.identity.proof !== "reconciled-hosted" ||
        !evidence.receipt.identity.projectionTag)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Reconciliation requires an applied exact-source Core receiver identity.",
      });
    }
    if (evidence.schemaVersion === 4 && evidence.scope !== "remote-agent") {
      context.addIssue({
        code: "custom",
        message:
          "Partial recovery is limited to the Remote Agent release scope.",
      });
    }
    if (
      (evidence.schemaVersion === 3 || evidence.schemaVersion === 4) &&
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
