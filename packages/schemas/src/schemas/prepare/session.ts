import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldProfileIdSchema } from "../daemon/profile-identity";
import {
  authProfileKindSchema,
  authProfileManagedRoleSchema,
} from "../http/profiles";
import { localAgentCatalogSchema } from "../runtime/local-agent-catalog";
import {
  startBackgroundHelperProjectionSchema,
  startSkillsReadinessProjectionSchema,
} from "../start/device-projection";

const PREPARE_BOUNDED_ID_SCHEMA = z.string().trim().min(1).max(256);
const PREPARE_REASON_CODE_SCHEMA = z.string().trim().min(1).max(256);
const PREPARE_USER_MESSAGE_SCHEMA = z.string().trim().min(1).max(512);
const PREPARE_LONG_TEXT_SCHEMA = z.string().trim().min(1).max(4096);
export const PREPARE_STEP_DIAGNOSTICS_MAX_CHARS = 16_384;
const PREPARE_STEP_DIAGNOSTICS_SCHEMA = z
  .string()
  .trim()
  .min(1)
  .max(PREPARE_STEP_DIAGNOSTICS_MAX_CHARS);
const PREPARE_ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true }).max(64);
const PREPARE_NULLABLE_DATE_TIME_SCHEMA = z.union([
  PREPARE_ISO_DATE_TIME_SCHEMA,
  z.null(),
]);
const PREPARE_STEP_DIAGNOSTICS_SHORT_TEXT_SCHEMA = z
  .string()
  .trim()
  .min(1)
  .max(256);
const PREPARE_STEP_DIAGNOSTICS_LOG_LINE_MAX_CHARS = 321;
const PREPARE_STEP_DIAGNOSTICS_LIFECYCLE_ENTRY_MAX_CHARS = 700;
const PREPARE_STEP_DIAGNOSTICS_COLLECTION_ERROR_MAX_CHARS = 64;
const PREPARE_STEP_DIAGNOSTICS_CLI_VERSION_MAX_CHARS = 64;
const PREPARE_STEP_DIAGNOSTICS_OS_PLATFORM_MAX_CHARS = 64;
const PREPARE_STEP_DIAGNOSTICS_OS_RELEASE_MAX_CHARS = 128;
const PREPARE_STEP_DIAGNOSTICS_SERVICE_JOB_TEXT_MAX_CHARS = 128;

export const prepareStepDiagnosticsServiceJobSchema = z.object({
  controller: z.enum([
    "launchd",
    "systemd",
    "windows-service",
    "legacy-detached",
    "unknown",
  ]),
  loaded: z.boolean(),
  runs: z.union([z.int().nonnegative(), z.null()]),
  state: z.union([
    z.string().trim().max(PREPARE_STEP_DIAGNOSTICS_SERVICE_JOB_TEXT_MAX_CHARS),
    z.null(),
  ]),
  lastExitCodeText: z.union([
    z.string().trim().max(PREPARE_STEP_DIAGNOSTICS_SERVICE_JOB_TEXT_MAX_CHARS),
    z.null(),
  ]),
  lastExitCode: z.union([z.int(), z.null()]),
  pendedNondemandSpawn: z.union([
    z.string().trim().max(PREPARE_STEP_DIAGNOSTICS_SERVICE_JOB_TEXT_MAX_CHARS),
    z.null(),
  ]),
  keepaliveRunAtLoad: z.boolean(),
});

export const prepareStepDiagnosticsLifecycleEventTypeSchema = z.enum([
  "connection.state",
  "daemon.crash",
  "lifecycle.command.begin",
  "lifecycle.command.end",
  "owner.snapshot",
  "route_catalog.initial_load",
  "runtime_state.takeover",
  "stop.controlled_drain",
  "stop.strategy.selected",
  "stop.signal.observed",
  "service_manager.action",
  "service_manager.registration_reconcile",
  "process_stop.action",
  "service_contract.write",
]);

export const prepareStepDiagnosticsLifecycleJournalEntrySchema = z
  .object({
    schema: z.literal("openmeld-daemon-lifecycle-event-v1"),
    v: z.literal(1),
    type: prepareStepDiagnosticsLifecycleEventTypeSchema,
    timestamp: PREPARE_ISO_DATE_TIME_SCHEMA,
    lane: z.string().trim().min(1).max(64),
    intent: z.string().trim().min(1).max(64),
    command: z.string().trim().min(1).max(256),
    pid: z.int().nonnegative(),
    sessionId: z.union([PREPARE_STEP_DIAGNOSTICS_SHORT_TEXT_SCHEMA, z.null()]),
    result: z.string().trim().min(1).max(64),
    metadata: z
      .record(z.string().trim().min(1).max(64), z.unknown())
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      JSON.stringify(value).length >
      PREPARE_STEP_DIAGNOSTICS_LIFECYCLE_ENTRY_MAX_CHARS
    ) {
      ctx.addIssue({
        code: "custom",
        message: "lifecycle journal entry exceeds diagnostics size budget",
      });
    }
  });

export const prepareStepDiagnosticsBundleSchema = z.object({
  // Any positive integer, not a pinned literal: a v1 bundle from an
  // un-upgraded CLI must keep parsing on a newer core, and bumping the format
  // (v2 added deviceId, serviceLogNote, and metadata whitelisting) must not
  // require a coordinated schema/core redeploy just to lift a `literal`. The
  // structural contract is enforced by the fields below, which stay additive
  // and optional across versions.
  bundleVersion: z.int().positive(),
  collectedAt: PREPARE_ISO_DATE_TIME_SCHEMA,
  supportCode: PREPARE_STEP_DIAGNOSTICS_SHORT_TEXT_SCHEMA,
  stepId: PREPARE_STEP_DIAGNOSTICS_SHORT_TEXT_SCHEMA,
  // Stable OpenMeld-internal device UUID read from the local service contract. It
  // is not user-identifying data; it lets Workers Logs correlate a machine's
  // failures across prepare sessions when the session snapshot deviceId is
  // null. Omitted when the contract is unreadable.
  deviceId: PREPARE_STEP_DIAGNOSTICS_SHORT_TEXT_SCHEMA.optional(),
  cliVersion: z
    .string()
    .trim()
    .min(1)
    .max(PREPARE_STEP_DIAGNOSTICS_CLI_VERSION_MAX_CHARS),
  os: z.object({
    platform: z
      .string()
      .trim()
      .min(1)
      .max(PREPARE_STEP_DIAGNOSTICS_OS_PLATFORM_MAX_CHARS),
    release: z
      .string()
      .trim()
      .max(PREPARE_STEP_DIAGNOSTICS_OS_RELEASE_MAX_CHARS),
  }),
  inventoryAnomalies: z.union([
    z.array(PREPARE_STEP_DIAGNOSTICS_SHORT_TEXT_SCHEMA).max(32),
    z.null(),
  ]),
  serviceJob: z.union([prepareStepDiagnosticsServiceJobSchema, z.null()]),
  lifecycleJournalTail: z.union([
    z.array(prepareStepDiagnosticsLifecycleJournalEntrySchema).max(10),
    z.null(),
  ]),
  serviceLogTail: z.union([
    z
      .array(z.string().trim().max(PREPARE_STEP_DIAGNOSTICS_LOG_LINE_MAX_CHARS))
      .max(30),
    z.null(),
  ]),
  // Distinguishes an absent (never-spawned service, so the stdout redirect
  // file was never created) or empty daemon-system-service.log from a genuine
  // collection failure: when set, serviceLogTail is null but collectionErrors
  // stays clean. Omitted when the log was collected normally.
  serviceLogNote: z.enum(["file_missing", "file_empty"]).optional(),
  collectionErrors: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(PREPARE_STEP_DIAGNOSTICS_COLLECTION_ERROR_MAX_CHARS)
    )
    .max(8),
  truncated: z.boolean(),
});

export type PrepareStepDiagnosticsBundle = zod.infer<
  typeof prepareStepDiagnosticsBundleSchema
>;

const PREPARE_STEP_DIAGNOSTICS_REDACTION_REPLACEMENTS: readonly [
  RegExp,
  string,
][] = [
  [/\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, "$1[redacted]"],
  [/\b(x-openmeld-prepare-token\s*[:=]\s*["']?)[^"',;\s]+/gi, "$1[redacted]"],
  [/\b((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, "$1[redacted]"],
  [/\bopenMeldDaemon_[A-Za-z0-9._~:/+=-]+/g, "[redacted]"],
  [/\b[A-Fa-f0-9]{40,}\b/g, "[redacted]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}/g, "[redacted]"],
];

export function redactPrepareStepDiagnosticsText(value: string): string {
  let redacted = value;
  for (const [
    pattern,
    replacement,
  ] of PREPARE_STEP_DIAGNOSTICS_REDACTION_REPLACEMENTS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactPrepareStepDiagnosticsValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactPrepareStepDiagnosticsText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPrepareStepDiagnosticsValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactPrepareStepDiagnosticsValue(entry),
      ])
    );
  }
  return value;
}

export function redactPrepareStepDiagnosticsBundle(
  bundle: PrepareStepDiagnosticsBundle
): PrepareStepDiagnosticsBundle {
  return redactPrepareStepDiagnosticsValue(
    bundle
  ) as PrepareStepDiagnosticsBundle;
}
const PREPARE_URL_SCHEMA = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "expected a valid URL" }
  );

export const PREPARE_SESSION_STREAM_PROTOCOL_VERSION = 1;

export const prepareOpaqueTokenSchema = z.string().trim().min(1).max(2048);

export const prepareSessionLifecycleStatusSchema = z.enum([
  "active",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

export const prepareSessionPhaseSchema = z.enum([
  "waiting_for_terminal",
  "terminal_connected",
  "checking_computer",
  "waiting_for_agent_selection",
  "preparing_local_agents",
  "starting_service",
  "reporting_runtime",
  "verifying_readiness",
  "ready",
  "blocked",
  "terminal_disconnected",
  "failed",
  "expired",
]);

export const prepareStepIdSchema = z.enum([
  "computer",
  "connect_terminal",
  "choose_local_agents",
  "prepare_selected_agents",
  "refresh_service",
  "report_runtime",
  "verify_setup",
  "ready",
]);

export const prepareStepStateSchema = z.enum([
  "pending",
  "active",
  "waiting_for_user",
  "complete",
  "blocked",
  "terminal_disconnected",
]);

export const prepareStepSchema = z
  .strictObject({
    id: prepareStepIdSchema,
    state: prepareStepStateSchema,
    title: PREPARE_USER_MESSAGE_SCHEMA,
    summary: z.union([PREPARE_USER_MESSAGE_SCHEMA, z.null()]),
    blockerReasonCode: z.union([PREPARE_REASON_CODE_SCHEMA, z.null()]),
    startedAt: PREPARE_NULLABLE_DATE_TIME_SCHEMA,
    completedAt: PREPARE_NULLABLE_DATE_TIME_SCHEMA,
    updatedAt: PREPARE_ISO_DATE_TIME_SCHEMA,
  })
  .superRefine((value, ctx) => {
    if (value.state === "blocked" && value.blockerReasonCode === null) {
      ctx.addIssue({
        code: "custom",
        message: "blocked prepare steps must include blockerReasonCode",
        path: ["blockerReasonCode"],
      });
    }
    if (value.state !== "blocked" && value.blockerReasonCode !== null) {
      ctx.addIssue({
        code: "custom",
        message: "non-blocked prepare steps must use a null blockerReasonCode",
        path: ["blockerReasonCode"],
      });
    }
    if (value.state === "complete" && value.completedAt === null) {
      ctx.addIssue({
        code: "custom",
        message: "complete prepare steps must include completedAt",
        path: ["completedAt"],
      });
    }
  });

export const prepareTerminalConnectionStatusSchema = z.enum([
  "never_connected",
  "connected",
  "disconnected",
  "replaced",
]);

export const prepareTerminalConnectionSchema = z
  .strictObject({
    status: prepareTerminalConnectionStatusSchema,
    connectionId: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]),
    connectionEpoch: z.union([z.int().positive(), z.null()]),
    connectedAt: PREPARE_NULLABLE_DATE_TIME_SCHEMA,
    lastSeenAt: PREPARE_NULLABLE_DATE_TIME_SCHEMA,
    disconnectedAt: PREPARE_NULLABLE_DATE_TIME_SCHEMA,
    disconnectReason: z.union([PREPARE_REASON_CODE_SCHEMA, z.null()]),
  })
  .superRefine((value, ctx) => {
    if (value.status === "connected") {
      if (value.connectionId === null) {
        ctx.addIssue({
          code: "custom",
          message: "connected terminal must include connectionId",
          path: ["connectionId"],
        });
      }
      if (value.connectionEpoch === null) {
        ctx.addIssue({
          code: "custom",
          message: "connected terminal must include connectionEpoch",
          path: ["connectionEpoch"],
        });
      }
      if (value.connectedAt === null) {
        ctx.addIssue({
          code: "custom",
          message: "connected terminal must include connectedAt",
          path: ["connectedAt"],
        });
      }
    }
  });

export const prepareBlockerSeveritySchema = z.enum([
  "user_action_required",
  "system_blocked",
]);

export const prepareBlockerRetryActionSchema = z.enum([
  "run_prepare_command",
  "copy_fresh_command",
  "choose_agents",
  "refresh",
  "contact_support",
]);

export const prepareBlockerSchema = z.strictObject({
  blockerId: PREPARE_BOUNDED_ID_SCHEMA,
  stepId: prepareStepIdSchema,
  reasonCode: PREPARE_REASON_CODE_SCHEMA,
  message: PREPARE_USER_MESSAGE_SCHEMA,
  severity: prepareBlockerSeveritySchema,
  retryAction: prepareBlockerRetryActionSchema,
  createdAt: PREPARE_ISO_DATE_TIME_SCHEMA,
});

export const prepareLocalAgentIdsSchema = z
  .array(PREPARE_BOUNDED_ID_SCHEMA)
  .superRefine((value, ctx) => {
    if (new Set(value).size !== value.length) {
      ctx.addIssue({
        code: "custom",
        message: "localAgentIds must not contain duplicates",
      });
    }
  });

export const prepareLocalAgentCatalogSchema = localAgentCatalogSchema;

export const prepareLocalReadinessSnapshotSchema = z.strictObject({
  observedAt: PREPARE_ISO_DATE_TIME_SCHEMA,
  service: startBackgroundHelperProjectionSchema,
  skills: startSkillsReadinessProjectionSchema,
});

export const prepareSetupBootstrapStepSchema = z.enum([
  "human_profile",
  "assistant_profile",
  "account_space_index",
  "space_create",
  "space_membership",
  "binding",
  "welcome_message",
  "unknown",
]);

export const prepareSetupBootstrapProfileSummarySchema = z.strictObject({
  openMeldProfileId: PREPARE_BOUNDED_ID_SCHEMA,
  profileKind: authProfileKindSchema,
  profileName: PREPARE_USER_MESSAGE_SCHEMA,
});

export const prepareSetupBootstrapFactsSchema = z.strictObject({
  ownerUserId: PREPARE_BOUNDED_ID_SCHEMA,
  assistantProfileId: PREPARE_BOUNDED_ID_SCHEMA,
  spaceId: PREPARE_BOUNDED_ID_SCHEMA,
  spaceUrl: PREPARE_URL_SCHEMA,
  createdAt: PREPARE_ISO_DATE_TIME_SCHEMA,
});

const legacyPrepareSetupBootstrapAssistantProfileSchema =
  prepareSetupBootstrapProfileSummarySchema.extend({
    managedRole: authProfileManagedRoleSchema.extract(["openmeld_assistant"]),
    profileKind: z.literal("agent"),
  });

const legacyPrepareSetupBootstrapMembershipSchema = z.strictObject({
  addedMemberIds: z.array(PREPARE_BOUNDED_ID_SCHEMA),
  alreadyMemberIds: z.array(PREPARE_BOUNDED_ID_SCHEMA),
  assistantProfileId: PREPARE_BOUNDED_ID_SCHEMA,
  humanProfileId: PREPARE_BOUNDED_ID_SCHEMA,
});

const legacyPrepareSetupBootstrapWelcomingSpaceSchema = z.strictObject({
  createdAt: PREPARE_ISO_DATE_TIME_SCHEMA,
  name: PREPARE_USER_MESSAGE_SCHEMA,
  outcome: z.enum(["created", "reused"]).optional(),
  spaceId: PREPARE_BOUNDED_ID_SCHEMA,
  url: PREPARE_URL_SCHEMA,
});

export const prepareSetupBootstrapResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("completed"),
      assistantProfile: z.union([
        legacyPrepareSetupBootstrapAssistantProfileSchema,
        z.null(),
      ]),
      binding: z.union([
        z.strictObject({
          agentControllerRef: PREPARE_BOUNDED_ID_SCHEMA,
          openMeldServiceRuntimeId: PREPARE_BOUNDED_ID_SCHEMA,
          outcome: z.enum(["created", "reused", "reconnected"]),
          reason: z.union([PREPARE_REASON_CODE_SCHEMA, z.null()]).optional(),
          reasonCodes: z.array(PREPARE_REASON_CODE_SCHEMA),
          routable: z.literal(true),
          source: z.literal("agent_profile_binding_api"),
          status: z.literal("accepted"),
        }),
        z.null(),
      ]),
      // Legacy completed bootstrap results may include a degraded Binding
      // warning. Current setup bootstrap no longer creates a welcoming Binding.
      bindingWarning: z
        .union([
          z.strictObject({
            code: PREPARE_REASON_CODE_SCHEMA,
            message: PREPARE_USER_MESSAGE_SCHEMA,
            retryCommand: PREPARE_LONG_TEXT_SCHEMA,
          }),
          z.null(),
        ])
        .optional(),
      humanProfile: prepareSetupBootstrapProfileSummarySchema.extend({
        profileKind: z.literal("human"),
      }),
      facts: z.union([prepareSetupBootstrapFactsSchema, z.null()]),
      membership: z.union([
        legacyPrepareSetupBootstrapMembershipSchema,
        z.null(),
      ]),
      retryCommand: z.null(),
      warnings: z.array(
        z.strictObject({
          code: PREPARE_REASON_CODE_SCHEMA,
          message: PREPARE_USER_MESSAGE_SCHEMA,
          profileId: PREPARE_BOUNDED_ID_SCHEMA,
        })
      ),
      welcomeMessage: z.union([
        z.strictObject({
          signalId: PREPARE_BOUNDED_ID_SCHEMA,
          text: PREPARE_LONG_TEXT_SCHEMA,
        }),
        z.null(),
      ]),
      welcomingSpace: z.union([
        legacyPrepareSetupBootstrapWelcomingSpaceSchema,
        z.null(),
      ]),
    }),
    z.strictObject({
      status: z.literal("failed"),
      diagnostics: z.strictObject({
        errorName: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]),
        selectedAgentIds: prepareLocalAgentIdsSchema,
      }),
      failedStep: prepareSetupBootstrapStepSchema,
      message: PREPARE_LONG_TEXT_SCHEMA,
      reason: z.literal("bootstrap_failed"),
      retryCommand: PREPARE_LONG_TEXT_SCHEMA,
    }),
  ]
);

export const prepareSetupBootstrapWriteSchema = z.strictObject({
  prepareSessionId: PREPARE_BOUNDED_ID_SCHEMA,
  setupBootstrap: prepareSetupBootstrapResultSchema,
});

export const prepareSessionSnapshotSchema = z
  .strictObject({
    prepareSessionId: PREPARE_BOUNDED_ID_SCHEMA,
    ownerUserId: PREPARE_BOUNDED_ID_SCHEMA,
    // Present only for an explicit reconnect flow. The stable Computer identity
    // survives local service reinstalls that legitimately rotate deviceId.
    connectedComputerId: z
      .union([PREPARE_BOUNDED_ID_SCHEMA, z.null()])
      .optional(),
    humanProfileId: z.union([openMeldProfileIdSchema, z.null()]),
    deviceId: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]),
    runtimeLane: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]),
    targetSpaceId: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]),
    sessionRevision: z.int().nonnegative(),
    lifecycleStatus: prepareSessionLifecycleStatusSchema,
    phase: prepareSessionPhaseSchema,
    steps: z.array(prepareStepSchema),
    localAgentCatalog: z
      .union([prepareLocalAgentCatalogSchema, z.null()])
      .default(null),
    localReadinessSnapshot: z
      .union([prepareLocalReadinessSnapshotSchema, z.null()])
      .default(null),
    setupBootstrap: prepareSetupBootstrapResultSchema.optional(),
    selectedLocalAgentIds: prepareLocalAgentIdsSchema,
    terminalConnection: prepareTerminalConnectionSchema,
    blockers: z.array(prepareBlockerSchema),
    diagnosticCorrelationId: PREPARE_BOUNDED_ID_SCHEMA,
    createdAt: PREPARE_ISO_DATE_TIME_SCHEMA,
    updatedAt: PREPARE_ISO_DATE_TIME_SCHEMA,
    completedAt: PREPARE_NULLABLE_DATE_TIME_SCHEMA,
    expiresAt: PREPARE_ISO_DATE_TIME_SCHEMA,
  })
  .superRefine((value, ctx) => {
    const terminalLifecycle =
      value.lifecycleStatus === "completed" ||
      value.lifecycleStatus === "failed" ||
      value.lifecycleStatus === "cancelled" ||
      value.lifecycleStatus === "expired";
    if (terminalLifecycle && value.completedAt === null) {
      ctx.addIssue({
        code: "custom",
        message: "terminal prepare sessions must include completedAt",
        path: ["completedAt"],
      });
    }
    if (!terminalLifecycle && value.completedAt !== null) {
      ctx.addIssue({
        code: "custom",
        message: "active prepare sessions must use a null completedAt",
        path: ["completedAt"],
      });
    }
    if (value.phase === "blocked" && value.blockers.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "blocked prepare sessions must include at least one blocker",
        path: ["blockers"],
      });
    }
  });

export const prepareSessionEventTypeSchema = z.enum([
  "session.created",
  "session.snapshot_updated",
  "session.completed",
  "session.failed",
  "session.cancelled",
  "session.expired",
  "token.minted",
  "token.revoked",
  "terminal.connected",
  "terminal.disconnected",
  "terminal.connection_replaced",
  "terminal.local_agent_catalog_reported",
  "terminal.agent_selection_saved",
  "terminal.setup_bootstrap_recorded",
  "terminal.step_started",
  "terminal.step_completed",
  "terminal.step_failed",
  "web.agent_selection_saved",
  "blocker.added",
  "blocker.cleared",
]);

export const prepareSessionEventActorSchema = z.enum([
  "web",
  "terminal",
  "system",
]);

export const prepareSessionEventSchema = z.strictObject({
  eventId: PREPARE_BOUNDED_ID_SCHEMA,
  prepareSessionId: PREPARE_BOUNDED_ID_SCHEMA,
  sessionRevision: z.int().nonnegative(),
  eventType: prepareSessionEventTypeSchema,
  actor: prepareSessionEventActorSchema,
  stepId: z.union([prepareStepIdSchema, z.null()]),
  connectionEpoch: z.union([z.int().positive(), z.null()]),
  reasonCode: z.union([PREPARE_REASON_CODE_SCHEMA, z.null()]),
  message: z.union([PREPARE_USER_MESSAGE_SCHEMA, z.null()]),
  localAgentIds: prepareLocalAgentIdsSchema,
  createdAt: PREPARE_ISO_DATE_TIME_SCHEMA,
});

export const createPrepareSessionRequestSchema = z.strictObject({
  connectedComputerId: z
    .union([PREPARE_BOUNDED_ID_SCHEMA, z.null()])
    .optional(),
  humanProfileId: z.union([openMeldProfileIdSchema, z.null()]).optional(),
  deviceId: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]).optional(),
  runtimeLane: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]).optional(),
  targetSpaceId: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]).optional(),
  selectedLocalAgentIds: prepareLocalAgentIdsSchema.optional(),
  sourceNavigationAction: z
    .strictObject({
      signalId: PREPARE_BOUNDED_ID_SCHEMA,
      spaceId: PREPARE_BOUNDED_ID_SCHEMA,
    })
    .optional(),
});

export const prepareSessionWithTokenResponseSchema = z.strictObject({
  snapshot: prepareSessionSnapshotSchema,
  opaqueToken: prepareOpaqueTokenSchema,
  opaqueTokenExpiresAt: PREPARE_ISO_DATE_TIME_SCHEMA,
});

export const createPrepareSessionResponseSchema =
  prepareSessionWithTokenResponseSchema;

export const prepareSessionResponseSchema = z.strictObject({
  snapshot: prepareSessionSnapshotSchema,
});

export const terminalStepWriteStatusSchema = z.enum([
  "started",
  "completed",
  "failed",
]);

export const terminalStepWriteSchema = z.strictObject({
  prepareSessionId: PREPARE_BOUNDED_ID_SCHEMA,
  connectionEpoch: z.int().positive(),
  expectedRevision: z.int().nonnegative(),
  deviceId: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]).optional(),
  runtimeLane: z.union([PREPARE_BOUNDED_ID_SCHEMA, z.null()]).optional(),
  stepAttemptId: PREPARE_BOUNDED_ID_SCHEMA,
  stepId: prepareStepIdSchema,
  status: terminalStepWriteStatusSchema,
  localReadinessSnapshot: z
    .union([prepareLocalReadinessSnapshotSchema, z.null()])
    .optional(),
  reasonCode: z.union([PREPARE_REASON_CODE_SCHEMA, z.null()]).optional(),
  message: z.union([PREPARE_USER_MESSAGE_SCHEMA, z.null()]).optional(),
  // Best-effort local failure evidence (serialized whitelist-only JSON).
  // Diagnostic-only: core may log it, but it must never enter snapshots,
  // events, or availability/Wake decisions.
  diagnostics: PREPARE_STEP_DIAGNOSTICS_SCHEMA.optional(),
});

export const terminalLocalAgentCatalogWriteSchema = z.strictObject({
  prepareSessionId: PREPARE_BOUNDED_ID_SCHEMA,
  connectionEpoch: z.int().positive(),
  localAgentCatalog: prepareLocalAgentCatalogSchema,
});

export const terminalAgentSelectionWriteSchema = z.strictObject({
  prepareSessionId: PREPARE_BOUNDED_ID_SCHEMA,
  connectionEpoch: z.int().positive(),
  expectedRevision: z.int().nonnegative(),
  localAgentIds: prepareLocalAgentIdsSchema,
});

export const webAgentSelectionWriteSchema = z.strictObject({
  prepareSessionId: PREPARE_BOUNDED_ID_SCHEMA,
  expectedRevision: z.int().nonnegative(),
  localAgentIds: prepareLocalAgentIdsSchema,
});

export const prepareDiagnosticResponseSchema = z.strictObject({
  snapshot: prepareSessionSnapshotSchema,
  events: z.array(prepareSessionEventSchema),
});

export const prepareSessionStreamRoleSchema = z.enum(["web", "terminal"]);

export const prepareSessionStreamClientFrameSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      type: z.literal("client.ping"),
      payload: z.strictObject({
        sentAt: PREPARE_ISO_DATE_TIME_SCHEMA,
      }),
    }),
    z.strictObject({
      type: z.literal("client.hello"),
      payload: z.strictObject({
        cliVersion: PREPARE_BOUNDED_ID_SCHEMA,
        protocolVersion: z.int().positive(),
      }),
    }),
    z.strictObject({
      type: z.literal("terminal.step.write"),
      payload: terminalStepWriteSchema,
    }),
    z.strictObject({
      type: z.literal("terminal.local_agent_catalog.write"),
      payload: terminalLocalAgentCatalogWriteSchema,
    }),
    z.strictObject({
      type: z.literal("terminal.agent_selection.write"),
      payload: terminalAgentSelectionWriteSchema,
    }),
    z.strictObject({
      type: z.literal("web.agent_selection.write"),
      payload: webAgentSelectionWriteSchema,
    }),
  ]
);

export const prepareSessionStreamServerFrameSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      type: z.literal("server.pong"),
      payload: z.strictObject({
        sentAt: PREPARE_ISO_DATE_TIME_SCHEMA,
      }),
    }),
    z.strictObject({
      type: z.literal("snapshot"),
      payload: z.strictObject({
        snapshot: prepareSessionSnapshotSchema,
      }),
    }),
    z.strictObject({
      type: z.literal("snapshot_changed"),
      payload: z.strictObject({
        snapshot: prepareSessionSnapshotSchema,
      }),
    }),
    z.strictObject({
      type: z.literal("terminal.replaced"),
      payload: z.strictObject({
        reasonCode: PREPARE_REASON_CODE_SCHEMA,
        message: PREPARE_USER_MESSAGE_SCHEMA,
      }),
    }),
    z.strictObject({
      type: z.literal("server.error"),
      payload: z.strictObject({
        code: PREPARE_REASON_CODE_SCHEMA,
        message: PREPARE_USER_MESSAGE_SCHEMA,
      }),
    }),
  ]
);
