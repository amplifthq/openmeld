import * as z from "zod/v4";

export const FINAL_CANDIDATE_EVIDENCE_VERSION = 3 as const;
export const FINAL_CANDIDATE_CONFIDENCE_VALUES = ["standard", "full"] as const;
export const FINAL_CANDIDATE_CONTROL_TRUST_VALUES = [
  "current-main",
  "explicit-bootstrap",
] as const;

const exactGitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const nullableExactGitShaSchema = exactGitShaSchema.nullable();
const boundedTextSchema = z.string().max(8192);
const commandSchema = z.array(z.string().min(1).max(4096)).min(1).max(64);

export const finalCandidateConfidenceSchema = z.enum(
  FINAL_CANDIDATE_CONFIDENCE_VALUES
);
export const finalCandidateControlTrustSchema = z.enum(
  FINAL_CANDIDATE_CONTROL_TRUST_VALUES
);

export const finalCandidateCheckSchema = z.strictObject({
  command: commandSchema,
  id: z.string().min(1).max(160),
  reason: z.string().min(1).max(2000),
});

export const finalCandidateSkippedCheckSchema = z.strictObject({
  id: z.string().min(1).max(160),
  reason: z.string().min(1).max(2000),
});

export const finalCandidateCheckResultSchema = z.strictObject({
  command: commandSchema,
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  id: z.string().min(1).max(160),
  reason: z.string().min(1).max(2000),
  spawnError: boundedTextSchema.nullable(),
  status: z.enum(["passed", "failed"]),
  stderrTail: boundedTextSchema,
  stdoutTail: boundedTextSchema,
});

export const finalCandidatePublicationErrorSchema = z.strictObject({
  message: z.string().min(1).max(8192),
  occurredAt: z.iso.datetime(),
  operation: z.enum(["pending-status", "pull-request-comment", "final-status"]),
});

export const finalCandidateEvidenceSchema = z
  .strictObject({
    baseSha: nullableExactGitShaSchema,
    bootstrapReason: boundedTextSchema.nullable(),
    branchName: z.string().min(1).max(1024).nullable(),
    changedPaths: z.array(z.string().min(1).max(4096)).max(20_000),
    conclusion: z.enum(["success", "failure"]),
    confidence: finalCandidateConfidenceSchema,
    controlTrust: finalCandidateControlTrustSchema,
    error: boundedTextSchema.nullable(),
    finishedAt: z.iso.datetime(),
    headSha: nullableExactGitShaSchema,
    mode: z.enum(["local", "remote"]),
    planSourceSha: nullableExactGitShaSchema,
    publicationErrors: z.array(finalCandidatePublicationErrorSchema).max(10),
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: z.url().nullable(),
    repository: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/u)
      .max(512),
    results: z.array(finalCandidateCheckResultSchema).max(100),
    riskTags: z.array(z.string().min(1).max(160)).max(100),
    schemaVersion: z.literal(FINAL_CANDIDATE_EVIDENCE_VERSION),
    selectedChecks: z.array(finalCandidateCheckSchema).max(100),
    skippedChecks: z.array(finalCandidateSkippedCheckSchema).max(100),
    startedAt: z.iso.datetime(),
    treeSha: nullableExactGitShaSchema,
  })
  .superRefine((evidence, context) => {
    if (evidence.conclusion !== "success") {
      return;
    }
    for (const [field, value] of [
      ["baseSha", evidence.baseSha],
      ["headSha", evidence.headSha],
      ["planSourceSha", evidence.planSourceSha],
      ["treeSha", evidence.treeSha],
    ] as const) {
      if (!value) {
        context.addIssue({
          code: "custom",
          message: `Successful Final Candidate evidence requires ${field}.`,
          path: [field],
        });
      }
    }
    if (evidence.error) {
      context.addIssue({
        code: "custom",
        message:
          "Successful Final Candidate evidence cannot contain a validation error.",
        path: ["error"],
      });
    }
    if (evidence.results.some((result) => result.status !== "passed")) {
      context.addIssue({
        code: "custom",
        message:
          "Successful Final Candidate evidence cannot contain a failed check.",
        path: ["results"],
      });
    }
    if (evidence.selectedChecks.length === 0) {
      context.addIssue({
        code: "custom",
        message:
          "Successful Final Candidate evidence requires at least one selected check.",
        path: ["selectedChecks"],
      });
    }
    if (evidence.results.length !== evidence.selectedChecks.length) {
      context.addIssue({
        code: "custom",
        message:
          "Successful Final Candidate evidence requires one result for every selected check.",
        path: ["results"],
      });
    }
    for (const [index, selectedCheck] of evidence.selectedChecks.entries()) {
      const result = evidence.results[index];
      if (
        !result ||
        result.id !== selectedCheck.id ||
        result.reason !== selectedCheck.reason ||
        JSON.stringify(result.command) !== JSON.stringify(selectedCheck.command)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Successful Final Candidate evidence results must exactly match the selected plan in order.",
          path: ["results", index],
        });
      }
    }
    if (
      evidence.controlTrust === "explicit-bootstrap" &&
      evidence.mode !== "local"
    ) {
      context.addIssue({
        code: "custom",
        message: "Explicit Final Candidate bootstrap is local-only.",
        path: ["controlTrust"],
      });
    }
    const expectedPlanSource =
      evidence.controlTrust === "explicit-bootstrap"
        ? evidence.headSha
        : evidence.baseSha;
    if (evidence.planSourceSha !== expectedPlanSource) {
      context.addIssue({
        code: "custom",
        message:
          "Successful Final Candidate evidence must identify the code that owned its plan.",
        path: ["planSourceSha"],
      });
    }
    if (
      evidence.controlTrust === "explicit-bootstrap" &&
      !evidence.bootstrapReason
    ) {
      context.addIssue({
        code: "custom",
        message: "Explicit Final Candidate bootstrap requires a reason.",
        path: ["bootstrapReason"],
      });
    }
    if (
      evidence.controlTrust === "current-main" &&
      evidence.bootstrapReason !== null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Current-main Final Candidate evidence cannot claim bootstrap.",
        path: ["bootstrapReason"],
      });
    }
  });

// GitHub REST API: GET /repos/{owner}/{repo}/pulls/{pull_number}.
// Unknown vendor fields are intentionally stripped while the candidate facts
// consumed by OpenMeld remain strict and runtime-validated.
export const githubPullRequestCandidateFactsSchema = z.object({
  base: z.object({
    ref: z.string().min(1).max(1024),
    sha: exactGitShaSchema,
  }),
  draft: z.boolean(),
  head: z.object({
    ref: z.string().min(1).max(1024),
    sha: exactGitShaSchema,
  }),
  html_url: z.url(),
  labels: z.array(z.object({ name: z.string().min(1).max(160) })).max(100),
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
});

export type FinalCandidateCheck = z.infer<typeof finalCandidateCheckSchema>;
export type FinalCandidateCheckResult = z.infer<
  typeof finalCandidateCheckResultSchema
>;
export type FinalCandidateEvidence = z.infer<
  typeof finalCandidateEvidenceSchema
>;
export type FinalCandidatePublicationError = z.infer<
  typeof finalCandidatePublicationErrorSchema
>;
