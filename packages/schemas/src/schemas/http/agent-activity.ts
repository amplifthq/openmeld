import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { optionalBooleanQuerySchema } from "../protocol/shared";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";
import { projectSchema, repositoryFingerprintSchema } from "./projects";

export const AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT = 1000;
export const AGENT_ACTIVITY_TITLE_MAX_CHARS = 240;
export const AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS = 5 * 60_000;
export const AGENT_ACTIVITY_EVENT_MAX_BYTES = 16 * 1024;
export const AGENT_ACTIVITY_EVENT_BATCH_LIMIT = 64;
export const AGENT_ACTIVITY_EVENT_BATCH_MAX_BYTES =
  AGENT_ACTIVITY_EVENT_BATCH_LIMIT * AGENT_ACTIVITY_EVENT_MAX_BYTES + 4096;
export const AGENT_ACTIVITY_EVENT_RETENTION_MS = 14 * 24 * 60 * 60_000;
export const AGENT_ACTIVITY_DIGEST_SUMMARY_MAX_CHARS = 1200;
export const AGENT_ACTIVITY_DIGEST_EVIDENCE_MAX_ITEMS = 100;
export const AGENT_ACTIVITY_STATS_DAILY_LIMIT = 400;
export const AGENT_ACTIVITY_PROVIDERS = [
  "codex",
  "claude-code",
  "cursor",
  "opencode",
] as const;
export const AGENT_ACTIVITY_CLIENT_KINDS = [
  "codex-app",
  "codex-cli",
  "claude-code-cli",
  "cursor-cli",
  "cursor-ide",
  "unknown",
] as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();
const nullableBoundedTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

const agentActivityRpcContextShape = {
  context: openMeldRequestContextSchema.optional(),
};

export const agentActivityEventTypeSchema = z.enum([
  "session_started",
  "session_updated",
  "session_active",
  "session_idle",
  "session_ended",
  "session_error",
  "heartbeat",
]);

export const agentActivitySessionStatusSchema = z.enum([
  "active",
  "idle",
  "ended",
  "error",
  "unknown",
]);
export const agentActivityProviderSchema = z.enum(AGENT_ACTIVITY_PROVIDERS);
export const agentActivityClientKindSchema = z.enum(
  AGENT_ACTIVITY_CLIENT_KINDS
);

const safeMetadataTextSchema = z.string().trim().min(1).max(256);

export const codexAgentActivityProviderMetadataSchema = z.strictObject({
  approvalPolicy: z
    .enum(["untrusted", "on-failure", "on-request", "never"])
    .optional(),
  cliVersion: safeMetadataTextSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
  modelProvider: safeMetadataTextSchema.optional(),
  originator: z.enum(["desktop", "cli", "subagent"]).optional(),
  reasoningEffort: z
    .enum(["minimal", "low", "medium", "high", "xhigh", "ultra"])
    .optional(),
  sandboxMode: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .optional(),
  source: z.enum(["rollout", "hook", "reconciliation"]).optional(),
});

export const claudeCodeAgentActivityProviderMetadataSchema = z.strictObject({
  entrypoint: z.enum(["cli", "desktop"]).optional(),
  isSidechain: z.boolean().optional(),
  parentSessionId: boundedIdentifierSchema.optional(),
  permissionMode: z
    .enum([
      "default",
      "acceptEdits",
      "plan",
      "dontAsk",
      "bypassPermissions",
      "ask",
      "allow",
    ])
    .optional(),
  source: z.enum(["jsonl", "hook", "reconciliation"]).optional(),
  version: safeMetadataTextSchema.optional(),
});

export const openCodeAgentActivityProviderMetadataSchema = z.strictObject({
  agent: safeMetadataTextSchema.optional(),
  cost: z.number().nonnegative().finite().optional(),
  modelProvider: safeMetadataTextSchema.optional(),
  modelVariant: safeMetadataTextSchema.optional(),
  parentSessionId: boundedIdentifierSchema.optional(),
  tokensCacheRead: z.number().int().nonnegative().optional(),
  tokensCacheWrite: z.number().int().nonnegative().optional(),
  tokensInput: z.number().int().nonnegative().optional(),
  tokensOutput: z.number().int().nonnegative().optional(),
  tokensReasoning: z.number().int().nonnegative().optional(),
  version: safeMetadataTextSchema.optional(),
});

export const cursorAgentActivityProviderMetadataSchema = z.strictObject({
  composerMode: z.enum(["agent", "chat", "plan", "debug"]).optional(),
  isBackgroundAgent: z.boolean().optional(),
  source: z.enum(["acp", "hook"]),
  version: safeMetadataTextSchema.optional(),
});

export const codexPublicAgentActivityProviderMetadataSchema =
  codexAgentActivityProviderMetadataSchema;
export const claudeCodePublicAgentActivityProviderMetadataSchema =
  claudeCodeAgentActivityProviderMetadataSchema.omit({ parentSessionId: true });
export const cursorPublicAgentActivityProviderMetadataSchema =
  cursorAgentActivityProviderMetadataSchema;
export const openCodePublicAgentActivityProviderMetadataSchema =
  openCodeAgentActivityProviderMetadataSchema.omit({ parentSessionId: true });

const agentActivityEventCommonShape = {
  eventId: boundedIdentifierSchema,
  eventType: agentActivityEventTypeSchema,
  expiresAtMs: timestampMsSchema,
  gitBranch: nullableBoundedTextSchema(512),
  gitCommit: nullableBoundedTextSchema(128),
  model: nullableBoundedTextSchema(256),
  observedAtMs: timestampMsSchema,
  organizationId: boundedIdentifierSchema,
  projectId: boundedIdentifierSchema,
  providerSessionId: z.string().trim().min(1).max(512),
  repositoryFingerprint: repositoryFingerprintSchema.nullable(),
  source: z.literal("observed"),
  startedAtMs: timestampMsSchema.nullable(),
  status: agentActivitySessionStatusSchema,
  title: nullableBoundedTextSchema(AGENT_ACTIVITY_TITLE_MAX_CHARS),
};

const codexAgentActivityEventSchema = z.strictObject({
  ...agentActivityEventCommonShape,
  clientKind: z.enum(["codex-app", "codex-cli", "unknown"]),
  provider: z.literal("codex"),
  providerMetadata: codexAgentActivityProviderMetadataSchema,
});

const claudeCodeAgentActivityEventSchema = z.strictObject({
  ...agentActivityEventCommonShape,
  clientKind: z.enum(["claude-code-cli", "unknown"]),
  provider: z.literal("claude-code"),
  providerMetadata: claudeCodeAgentActivityProviderMetadataSchema,
});

const openCodeAgentActivityEventSchema = z.strictObject({
  ...agentActivityEventCommonShape,
  clientKind: z.literal("unknown"),
  provider: z.literal("opencode"),
  providerMetadata: openCodeAgentActivityProviderMetadataSchema,
});

const cursorAgentActivityEventSchema = z.strictObject({
  ...agentActivityEventCommonShape,
  clientKind: z.enum(["cursor-cli", "cursor-ide", "unknown"]),
  provider: z.literal("cursor"),
  providerMetadata: cursorAgentActivityProviderMetadataSchema,
});

export const agentActivityEventSchema = z
  .discriminatedUnion("provider", [
    codexAgentActivityEventSchema,
    claudeCodeAgentActivityEventSchema,
    cursorAgentActivityEventSchema,
    openCodeAgentActivityEventSchema,
  ])
  .superRefine((value, context) => {
    const allowedStatuses = {
      heartbeat: ["active"],
      session_active: ["active"],
      session_ended: ["ended"],
      session_error: ["error"],
      session_idle: ["idle"],
      session_started: ["active", "unknown"],
      session_updated: ["unknown"],
    } as const satisfies Record<
      zod.infer<typeof agentActivityEventTypeSchema>,
      readonly zod.infer<typeof agentActivitySessionStatusSchema>[]
    >;
    if (!allowedStatuses[value.eventType].includes(value.status as never)) {
      context.addIssue({
        code: "custom",
        message:
          "Agent Activity event type and session status are inconsistent.",
        path: ["status"],
      });
    }
    if (value.startedAtMs !== null && value.startedAtMs > value.observedAtMs) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity start time cannot follow its observation.",
        path: ["startedAtMs"],
      });
    }
    if (value.status === "active" && value.expiresAtMs <= value.observedAtMs) {
      context.addIssue({
        code: "custom",
        message: "Active Agent Activity requires a bounded future expiry.",
        path: ["expiresAtMs"],
      });
    }
    if (
      value.expiresAtMs - value.observedAtMs >
      AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS
    ) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity expiry exceeds the presence TTL.",
        path: ["expiresAtMs"],
      });
    }
    if (value.expiresAtMs < value.observedAtMs) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity expiry cannot precede its observation.",
        path: ["expiresAtMs"],
      });
    }
  });

export const agentActivityEventOutcomeSchema = z.enum([
  "accepted",
  "reused",
  "retryable_rejected",
  "permanent_rejected",
]);

export const agentActivityEventRejectionReasonSchema = z.enum([
  "event_id_conflict",
  "event_invalid",
  "event_time_invalid",
  "membership_removed",
  "membership_unavailable",
  "project_archived",
  "project_missing",
  "repository_fingerprint_mismatch",
  "runtime_lookup_conflict",
  "runtime_missing",
  "openmeld_service_runtime_id_invalid",
  "openmeld_service_runtime_id_mismatch",
  "openmeld_service_runtime_identity_invalid",
]);

export const submitAgentActivityEventsBodySchema = z.strictObject({
  events: z.array(z.unknown()).min(1).max(AGENT_ACTIVITY_EVENT_BATCH_LIMIT),
  lane: boundedIdentifierSchema,
  openMeldServiceRuntimeId: z.strictObject({
    source: z.literal("runtime_registry_authority"),
    value: z.string().trim().min(1).max(512),
  }),
});

export const submitAgentActivityEventResultSchema = z
  .strictObject({
    eventId: boundedIdentifierSchema.optional(),
    index: z
      .number()
      .int()
      .nonnegative()
      .max(AGENT_ACTIVITY_EVENT_BATCH_LIMIT - 1),
    outcome: agentActivityEventOutcomeSchema,
    reason: agentActivityEventRejectionReasonSchema.optional(),
  })
  .superRefine((value, context) => {
    const rejected =
      value.outcome === "retryable_rejected" ||
      value.outcome === "permanent_rejected";
    if (rejected !== Boolean(value.reason)) {
      context.addIssue({
        code: "custom",
        message: "Rejected Agent Activity events require exactly one reason.",
        path: ["reason"],
      });
    }
  });

export const submitAgentActivityEventsResponseSchema = z
  .strictObject({
    events: z
      .array(submitAgentActivityEventResultSchema)
      .min(1)
      .max(AGENT_ACTIVITY_EVENT_BATCH_LIMIT),
    status: z.enum(["accepted", "partial", "rejected"]),
    openMeldServiceRuntimeId: z
      .strictObject({
        source: z.literal("runtime_registry_authority"),
        value: z.string().trim().min(1).max(512),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    const indices = value.events.map((event) => event.index);
    if (new Set(indices).size !== indices.length) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity event result indices must be unique.",
        path: ["events"],
      });
    }
    if (value.status !== "rejected" && !value.openMeldServiceRuntimeId) {
      context.addIssue({
        code: "custom",
        message: "Accepted Agent Activity responses require Runtime authority.",
        path: ["openMeldServiceRuntimeId"],
      });
    }
  });

export const submitAgentActivityEventsRpcInputSchema = z.strictObject({
  ...agentActivityRpcContextShape,
  ...submitAgentActivityEventsBodySchema.shape,
  deviceId: boundedIdentifierSchema,
});

export const agentActivitySnapshotQuerySchema = z.strictObject({
  includeProviderMetadata: optionalBooleanQuerySchema,
  memberUserId: boundedIdentifierSchema.optional(),
  projectId: boundedIdentifierSchema.optional(),
  provider: agentActivityProviderSchema.optional(),
  status: agentActivitySessionStatusSchema.optional(),
});

const agentActivityPublicSessionCommonShape = {
  expiresAtMs: timestampMsSchema,
  gitBranch: nullableBoundedTextSchema(512),
  gitCommit: nullableBoundedTextSchema(128),
  id: boundedIdentifierSchema,
  isActive: z.boolean(),
  lastObservedAtMs: timestampMsSchema,
  memberName: z.string().trim().min(1).max(256),
  memberUserId: boundedIdentifierSchema,
  model: nullableBoundedTextSchema(256),
  projectId: boundedIdentifierSchema,
  startedAtMs: timestampMsSchema.nullable(),
  status: agentActivitySessionStatusSchema,
  title: nullableBoundedTextSchema(AGENT_ACTIVITY_TITLE_MAX_CHARS),
};

export const agentActivityPublicSessionSchema = z.discriminatedUnion(
  "provider",
  [
    z.strictObject({
      ...agentActivityPublicSessionCommonShape,
      clientKind: z.enum(["codex-app", "codex-cli", "unknown"]),
      provider: z.literal("codex"),
      providerMetadata:
        codexPublicAgentActivityProviderMetadataSchema.optional(),
    }),
    z.strictObject({
      ...agentActivityPublicSessionCommonShape,
      clientKind: z.enum(["claude-code-cli", "unknown"]),
      provider: z.literal("claude-code"),
      providerMetadata:
        claudeCodePublicAgentActivityProviderMetadataSchema.optional(),
    }),
    z.strictObject({
      ...agentActivityPublicSessionCommonShape,
      clientKind: z.enum(["cursor-cli", "cursor-ide", "unknown"]),
      provider: z.literal("cursor"),
      providerMetadata:
        cursorPublicAgentActivityProviderMetadataSchema.optional(),
    }),
    z.strictObject({
      ...agentActivityPublicSessionCommonShape,
      clientKind: z.literal("unknown"),
      provider: z.literal("opencode"),
      providerMetadata:
        openCodePublicAgentActivityProviderMetadataSchema.optional(),
    }),
  ]
);

export const agentActivityPublicEventSchema = z.strictObject({
  clientKind: agentActivityClientKindSchema,
  eventId: boundedIdentifierSchema,
  eventType: agentActivityEventTypeSchema,
  memberName: z.string().trim().min(1).max(256),
  memberUserId: boundedIdentifierSchema,
  observedAtMs: timestampMsSchema,
  projectId: boundedIdentifierSchema,
  provider: agentActivityProviderSchema,
  status: agentActivitySessionStatusSchema,
  title: nullableBoundedTextSchema(AGENT_ACTIVITY_TITLE_MAX_CHARS),
});

export const agentActivityDigestCitationSchema = z.strictObject({
  eventId: boundedIdentifierSchema,
  observedAtMs: timestampMsSchema,
});

export const agentActivityPublicDigestSchema = z
  .strictObject({
    citations: z.array(agentActivityDigestCitationSchema).max(20),
    createdAtMs: timestampMsSchema,
    eventCount: z.number().int().positive(),
    failureReason: z.string().trim().min(1).max(256).nullable(),
    id: boundedIdentifierSchema,
    projectId: boundedIdentifierSchema,
    status: z.enum(["completed", "failed"]),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_ACTIVITY_DIGEST_SUMMARY_MAX_CHARS)
      .nullable(),
    windowEndedAtMs: timestampMsSchema,
    windowStartedAtMs: timestampMsSchema,
  })
  .superRefine((value, context) => {
    if (value.windowStartedAtMs > value.windowEndedAtMs) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity digest start cannot follow its end.",
        path: ["windowStartedAtMs"],
      });
    }
    const completed = value.status === "completed";
    if (completed !== Boolean(value.summary)) {
      context.addIssue({
        code: "custom",
        message:
          "Completed Agent Activity digests require exactly one summary.",
        path: ["summary"],
      });
    }
    if (completed === Boolean(value.failureReason)) {
      context.addIssue({
        code: "custom",
        message:
          "Failed Agent Activity digests require exactly one failure reason.",
        path: ["failureReason"],
      });
    }
    if (completed !== value.citations.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Completed Agent Activity digests require evidence citations.",
        path: ["citations"],
      });
    }
  });

export const agentActivityDigestEvidenceSchema = z.strictObject({
  eventId: boundedIdentifierSchema,
  eventType: agentActivityEventTypeSchema,
  memberName: z.string().trim().min(1).max(256),
  observedAtMs: timestampMsSchema,
  provider: agentActivityProviderSchema,
  status: agentActivitySessionStatusSchema,
  title: nullableBoundedTextSchema(AGENT_ACTIVITY_TITLE_MAX_CHARS),
});

export const summarizeAgentActivityDigestRpcInputSchema = z
  .strictObject({
    eventCount: z.number().int().positive(),
    evidence: z
      .array(agentActivityDigestEvidenceSchema)
      .min(1)
      .max(AGENT_ACTIVITY_DIGEST_EVIDENCE_MAX_ITEMS),
    organizationId: boundedIdentifierSchema,
    projectId: boundedIdentifierSchema,
    windowEndedAtMs: timestampMsSchema,
    windowStartedAtMs: timestampMsSchema,
  })
  .superRefine((value, context) => {
    if (value.eventCount < value.evidence.length) {
      context.addIssue({
        code: "custom",
        message:
          "Digest event count cannot be smaller than its evidence sample.",
        path: ["eventCount"],
      });
    }
    if (value.windowStartedAtMs > value.windowEndedAtMs) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity digest start cannot follow its end.",
        path: ["windowStartedAtMs"],
      });
    }
  });

export const summarizeAgentActivityDigestRpcResponseSchema = z
  .strictObject({
    citations: z.array(agentActivityDigestCitationSchema).min(1).max(20),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_ACTIVITY_DIGEST_SUMMARY_MAX_CHARS),
  })
  .superRefine((value, context) => {
    const keys = value.citations.map(
      (citation) => `${citation.eventId}\0${citation.observedAtMs}`
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Agent Activity digest citations must be unique.",
        path: ["citations"],
      });
    }
  });

export const agentActivitySnapshotResponseSchema = z.strictObject({
  asOfMs: timestampMsSchema,
  digestsTruncated: z.boolean(),
  organizationId: boundedIdentifierSchema,
  digests: z.array(agentActivityPublicDigestSchema).max(500),
  projects: z.array(projectSchema).max(AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT),
  recentEvents: z.array(agentActivityPublicEventSchema).max(100),
  sessions: z.array(agentActivityPublicSessionSchema).max(500),
  sessionsTruncated: z.boolean(),
  stalenessThresholdMs: z.number().int().positive(),
});

export const agentActivitySnapshotRpcInputSchema = z.strictObject({
  ...agentActivityRpcContextShape,
  ...agentActivitySnapshotQuerySchema.shape,
});

export const agentActivityStatsDailySchema = z.strictObject({
  activeDurationMs: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  utcDate: z.iso.date(),
});

export const agentActivityStatsQuerySchema = z.strictObject({
  projectId: boundedIdentifierSchema.optional(),
});

export const agentActivityStatsResponseSchema = z.strictObject({
  daily: z
    .array(agentActivityStatsDailySchema)
    .max(AGENT_ACTIVITY_STATS_DAILY_LIMIT),
  dailyTruncated: z.boolean(),
  organizationId: boundedIdentifierSchema,
  sinceMs: timestampMsSchema.nullable(),
  totalActiveDurationMs: z.number().int().nonnegative(),
  totalSessions: z.number().int().nonnegative(),
});

export const agentActivityStatsRpcInputSchema = z.strictObject({
  ...agentActivityRpcContextShape,
  ...agentActivityStatsQuerySchema.shape,
});

export const centerAgentReadAgentActivityToolRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  ...agentActivitySnapshotQuerySchema.shape,
  speakerMember: centerAgentToolSpeakerSchema,
});
