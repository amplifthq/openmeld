import { z } from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const memberResearchTextSchema = z.string().trim().min(1).max(1000);

export const CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES = [
  "organization_directory",
  "approved_profile_report",
  "agent_activity",
  "github",
  "slack_workspace_directory",
  "slack_channel_history",
  "connected_apps",
] as const;
const LEGACY_CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES =
  CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES.slice(0, 5);
export const CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_STATUSES = [
  "checked",
  "unavailable",
  "not_attributable",
] as const;
export const CENTER_AGENT_MEMBER_RESEARCH_EVIDENCE_SOURCES = [
  "agent_activity",
  "github",
  "slack",
  "connected_app",
] as const;

export const centerAgentMemberResearchEvidenceSourceSchema = z.enum(
  CENTER_AGENT_MEMBER_RESEARCH_EVIDENCE_SOURCES
);
export const centerAgentMemberResearchEvidenceItemSchema = z
  .strictObject({
    date: z.iso.date(),
    source: centerAgentMemberResearchEvidenceSourceSchema,
    sourceId: trimmedNonEmptyStringSchema.max(256),
    sourceName: trimmedNonEmptyStringSchema.max(120).optional(),
    sourceUrl: z.url().max(2048).optional(),
    text: memberResearchTextSchema,
  })
  .superRefine((item, context) => {
    if (item.source === "agent_activity" && item.sourceUrl) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity evidence uses its stable sourceId, not a URL.",
        path: ["sourceUrl"],
      });
    }
    if (item.source === "github" && !item.sourceUrl) {
      context.addIssue({
        code: "custom",
        message: "GitHub evidence requires a direct HTTPS sourceUrl.",
        path: ["sourceUrl"],
      });
      return;
    }
    if (
      (item.source === "slack" || item.source === "connected_app") &&
      !item.sourceName
    ) {
      context.addIssue({
        code: "custom",
        message: `${item.source === "slack" ? "Slack" : "Connected App"} evidence requires a sourceName.`,
        path: ["sourceName"],
      });
    }
    if (
      item.source === "github" &&
      item.sourceUrl &&
      new URL(item.sourceUrl).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        message: "GitHub evidence requires a direct HTTPS sourceUrl.",
        path: ["sourceUrl"],
      });
    }
    if (
      item.source === "connected_app" &&
      item.sourceUrl &&
      new URL(item.sourceUrl).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        message: "Connected App evidence sourceUrl must use HTTPS.",
        path: ["sourceUrl"],
      });
    }
  });

export const centerAgentMemberResearchCoverageSourceSchema = z.enum(
  CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES
);
export const centerAgentMemberResearchCoverageStatusSchema = z.enum(
  CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_STATUSES
);
export const centerAgentMemberResearchCoverageSchema = z.strictObject({
  evidence: memberResearchTextSchema.max(500),
  source: centerAgentMemberResearchCoverageSourceSchema,
  status: centerAgentMemberResearchCoverageStatusSchema,
  timeRange: trimmedNonEmptyStringSchema.max(120),
});

const centerAgentMemberResearchCoverageListSchema = z
  .array(centerAgentMemberResearchCoverageSchema)
  .min(LEGACY_CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES.length)
  .max(CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES.length)
  .superRefine((coverage, context) => {
    const expectedSources =
      coverage.length ===
      LEGACY_CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES.length
        ? LEGACY_CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES
        : CENTER_AGENT_MEMBER_RESEARCH_COVERAGE_SOURCES;
    for (const source of expectedSources) {
      const sourceCount = coverage.filter(
        (entry) => entry.source === source
      ).length;
      if (sourceCount !== 1) {
        context.addIssue({
          code: "custom",
          message: `Research coverage must include ${source} exactly once.`,
        });
      }
    }
    if (coverage.some((entry) => !expectedSources.includes(entry.source))) {
      context.addIssue({
        code: "custom",
        message:
          "Research coverage must use either the complete legacy source set or the complete current source set.",
      });
    }
  });

const centerAgentMemberResearchEvidenceBackedReportSchema = z
  .strictObject({
    collaborationGuidance: z
      .array(centerAgentMemberResearchEvidenceItemSchema)
      .max(4),
    coverage: centerAgentMemberResearchCoverageListSchema,
    currentFocus: z
      .array(centerAgentMemberResearchEvidenceItemSchema)
      .min(1)
      .max(5),
    observedActivity: z
      .array(centerAgentMemberResearchEvidenceItemSchema)
      .min(2)
      .max(12),
    recentContributions: z
      .array(centerAgentMemberResearchEvidenceItemSchema)
      .min(1)
      .max(8),
    result: z.literal("evidence_backed"),
    suggestedAboutAdditions: z
      .array(centerAgentMemberResearchEvidenceItemSchema)
      .max(5),
  })
  .superRefine((report, context) => {
    const distinctEvidence = new Set(
      report.observedActivity.map((item) => `${item.source}:${item.sourceId}`)
    );
    if (distinctEvidence.size < 2) {
      context.addIssue({
        code: "custom",
        message:
          "An evidence-backed report requires at least two distinct observed work items.",
        path: ["observedActivity"],
      });
    }
  });

const centerAgentMemberResearchInsufficientEvidenceReportSchema =
  z.strictObject({
    coverage: centerAgentMemberResearchCoverageListSchema,
    nextSteps: z.array(memberResearchTextSchema.max(400)).min(1).max(2),
    result: z.literal("insufficient_evidence"),
  });

export const centerAgentMemberResearchReportSchema = z.discriminatedUnion(
  "result",
  [
    centerAgentMemberResearchEvidenceBackedReportSchema,
    centerAgentMemberResearchInsufficientEvidenceReportSchema,
  ]
);

export const centerAgentMemberResearchScopeSchema = z.enum(["member", "all"]);
export const centerAgentMemberResearchBatchStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
]);
export const centerAgentMemberResearchTaskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const centerAgentMemberResearchTaskSchema = z
  .strictObject({
    id: trimmedNonEmptyStringSchema,
    subjectUserId: trimmedNonEmptyStringSchema,
    subjectDisplayName: trimmedNonEmptyStringSchema,
    position: z.number().int().positive(),
    status: centerAgentMemberResearchTaskStatusSchema,
    failureCode: trimmedNonEmptyStringSchema.nullable(),
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
  })
  .superRefine((task, context) => {
    const validLifecycle =
      (task.status === "queued" &&
        task.startedAt === null &&
        task.finishedAt === null &&
        task.failureCode === null) ||
      (task.status === "running" &&
        task.startedAt !== null &&
        task.finishedAt === null &&
        task.failureCode === null) ||
      (task.status === "completed" &&
        task.startedAt !== null &&
        task.finishedAt !== null &&
        task.failureCode === null) ||
      (task.status === "failed" &&
        task.startedAt !== null &&
        task.finishedAt !== null &&
        task.failureCode !== null);
    if (!validLifecycle) {
      context.addIssue({
        code: "custom",
        message: "Task timestamps and failureCode must match the task status.",
        path: ["status"],
      });
    }
    if (
      task.startedAt !== null &&
      task.finishedAt !== null &&
      Date.parse(task.finishedAt) < Date.parse(task.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "finishedAt must not be before startedAt.",
        path: ["finishedAt"],
      });
    }
  });

export const centerAgentMemberResearchBatchSchema = z
  .strictObject({
    id: trimmedNonEmptyStringSchema,
    organizationId: trimmedNonEmptyStringSchema,
    scope: centerAgentMemberResearchScopeSchema,
    status: centerAgentMemberResearchBatchStatusSchema,
    totalCount: z.number().int().positive(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    tasks: z.array(centerAgentMemberResearchTaskSchema).min(1),
  })
  .superRefine((batch, context) => {
    const completedCount = batch.tasks.filter(
      (task) => task.status === "completed"
    ).length;
    const failedCount = batch.tasks.filter(
      (task) => task.status === "failed"
    ).length;
    const countChecks = [
      ["totalCount", batch.totalCount, batch.tasks.length],
      ["completedCount", batch.completedCount, completedCount],
      ["failedCount", batch.failedCount, failedCount],
    ] as const;
    for (const [field, actual, expected] of countChecks) {
      if (actual !== expected) {
        context.addIssue({
          code: "custom",
          message: `${field} must match the task list.`,
          path: [field],
        });
      }
    }
    for (const [index, task] of batch.tasks.entries()) {
      if (task.position !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Task positions must be ordered and contiguous.",
          path: ["tasks", index, "position"],
        });
      }
    }
    if (batch.scope === "member" && batch.tasks.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Single-member research must contain exactly one task.",
        path: ["tasks"],
      });
    }
    const allQueued = batch.tasks.every((task) => task.status === "queued");
    const allTerminal = batch.tasks.every(
      (task) => task.status === "completed" || task.status === "failed"
    );
    if (
      (batch.status === "queued" && !allQueued) ||
      (batch.status === "running" && allQueued) ||
      (batch.status === "completed" && !allTerminal)
    ) {
      context.addIssue({
        code: "custom",
        message: "Batch status must match its task lifecycle.",
        path: ["status"],
      });
    }
    if (Date.parse(batch.updatedAt) < Date.parse(batch.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt must not be before createdAt.",
        path: ["updatedAt"],
      });
    }
  });

export const startCenterAgentMemberResearchBodySchema = z.discriminatedUnion(
  "scope",
  [
    z.strictObject({
      expectedOrganizationId: trimmedNonEmptyStringSchema,
      scope: z.literal("member"),
      subjectUserId: trimmedNonEmptyStringSchema,
    }),
    z.strictObject({
      expectedOrganizationId: trimmedNonEmptyStringSchema,
      scope: z.literal("all"),
    }),
  ]
);

export const startCenterAgentMemberResearchResponseSchema = z.strictObject({
  batch: centerAgentMemberResearchBatchSchema,
});

export const startCenterAgentMemberResearchRpcInputSchema =
  startCenterAgentMemberResearchBodySchema.and(
    z.strictObject({ context: openMeldRequestContextSchema })
  );

export const centerAgentStartSelfMemberResearchToolRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentToolSpeakerSchema,
  });

export const getCenterAgentMemberResearchStatusResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  latestBatch: centerAgentMemberResearchBatchSchema.nullable(),
});

export const getCenterAgentMemberResearchStatusRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
