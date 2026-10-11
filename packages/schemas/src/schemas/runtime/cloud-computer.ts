import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

/** Account identity is independent of a provider's resource address. */
export const cloudComputerSchema = z.strictObject({
  id: z.string().min(1),
  ownerUserId: z.string().min(1),
  provider: z.literal("cloudflare"),
  createdAtMs: z.number().int().nonnegative(),
});

export type CloudComputer = zod.infer<typeof cloudComputerSchema>;

export const cloudComputerStorageSchema = z.strictObject({
  scope: z.literal("persistent"),
  databaseBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
  growthHeadroomBytes: z.number().int().nonnegative(),
  status: z.enum(["available", "near_limit", "at_limit"]),
  observedAtMs: z.number().int().nonnegative(),
  guidance: z.string(),
});
export type CloudComputerStorage = zod.infer<typeof cloudComputerStorageSchema>;

const path = z.string().min(1).max(4096);
const key = z.string().min(1).max(256);
export const cloudComputerBackendSchema = z.enum([
  "container",
  "worker-shell",
  "worker-javascript",
]);
/** A receipt address, never execution or account authorization. */
export const cloudComputerCommandReferenceSchema = z.strictObject({
  invocationId: key,
  key,
  id: key,
  backend: cloudComputerBackendSchema,
});
export type CloudComputerCommandReference = zod.infer<
  typeof cloudComputerCommandReferenceSchema
>;
export const cloudComputerCommandPhaseSchema = z.enum([
  "accepted",
  "launch_unknown",
  "running",
  "process_exited",
  "sync_pending",
  "completed",
  "result_unavailable",
]);
export type CloudComputerCommandPhase = zod.infer<
  typeof cloudComputerCommandPhaseSchema
>;
/** Automatic receipt observation only; never execution state or authority. */
export const cloudComputerCommandCollectionSchema = z.strictObject({
  unconfirmedAttempts: z.number().int().nonnegative(),
  nextAttemptAtMs: z.number().int().nonnegative().nullable(),
});
export type CloudComputerCommandCollection = zod.infer<
  typeof cloudComputerCommandCollectionSchema
>;
export const cloudComputerCommandErrorSchema = z.strictObject({
  status: z.number().int().min(400).max(599),
  code: z.enum([
    "computer.command_not_found",
    "computer.command_reference_mismatch",
    "computer.execution_result_unavailable",
  ]),
  message: z.string().min(1),
});
export const cloudComputerCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    key,
    command: z.string().min(1).max(64_000),
    backend: cloudComputerBackendSchema.optional(),
    env: z.record(z.string(), z.string()).optional(),
    stdin: z.string().max(2_000_000).optional(),
    input: z.json().optional(),
    timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  }),
  z.strictObject({
    action: z.literal("poll"),
    key,
    reference: cloudComputerCommandReferenceSchema.optional(),
    after: z.number().nonnegative().optional(),
    waitSeconds: z.number().int().min(0).max(20).optional(),
  }),
  z.strictObject({
    action: z.literal("stop"),
    key,
    reference: cloudComputerCommandReferenceSchema.optional(),
    signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional(),
  }),
  z.strictObject({
    action: z.literal("list"),
    includeReceiptDetails: z.boolean().optional(),
  }),
]);
export const cloudComputerOperationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("describe") }),
  z.strictObject({
    action: z.literal("browser"),
    code: z.string().min(1).max(32_000),
  }),
  z.strictObject({
    action: z.literal("preview"),
    port: z.number().int().min(1024).max(65_535),
    path,
    expectedText: z.string().min(1).max(500),
  }),
  z.strictObject({
    action: z.literal("files"),
    tool: z.enum(["read", "ls", "find", "grep", "write", "edit", "delete"]),
    input: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ action: z.literal("read"), path }),
  z.strictObject({
    action: z.literal("write"),
    path,
    content: z.string().max(2_000_000),
    expectedContent: z.string().max(2_000_000).optional(),
  }),
  z.strictObject({
    action: z.literal("edit"),
    path,
    oldText: z.string().min(1).max(2_000_000),
    newText: z.string().max(2_000_000),
    replaceAll: z.boolean().optional(),
  }),
  z.strictObject({ action: z.literal("list"), path }),
  z.strictObject({
    action: z.literal("command"),
    invocationId: key,
    cwd: path.optional(),
    command: cloudComputerCommandSchema,
  }),
]);
export type CloudComputerOperation = zod.infer<
  typeof cloudComputerOperationSchema
>;

export const cloudComputerRpcRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  operation: cloudComputerOperationSchema.optional(),
});
export const cloudComputerWorkerRequestSchema = z.strictObject({
  computer: cloudComputerSchema,
  operation: cloudComputerOperationSchema,
});
export const REMOTE_AGENT_COMPUTER_CLEANUP_FAILED_CODE =
  "remote_agent.computer.command_cleanup_failed";

export const cloudComputerOperationResultSchema = z.union([
  z.strictObject({
    kind: z.literal("capabilities"),
    capabilities: z
      .object({ storage: cloudComputerStorageSchema.optional() })
      .catchall(z.unknown()),
  }),
  z.strictObject({ kind: z.literal("files"), result: z.unknown() }),
  z.strictObject({ kind: z.enum(["browser", "preview"]), result: z.unknown() }),
  z.strictObject({ path, content: z.string() }),
  z.strictObject({ path, written: z.literal(true) }),
  z.strictObject({ path, replacements: z.number().int().positive() }),
  z.strictObject({ path, entries: z.array(z.string()) }),
  z.array(
    z.strictObject({
      id: key,
      key,
      createdAt: z.number(),
      reference: cloudComputerCommandReferenceSchema.optional(),
      phase: cloudComputerCommandPhaseSchema.optional(),
      recordExpiresAtMs: z.number().int().nonnegative().optional(),
      collection: cloudComputerCommandCollectionSchema.optional(),
    })
  ),
  z.object({
    id: key,
    key,
    reference: cloudComputerCommandReferenceSchema.optional(),
    phase: cloudComputerCommandPhaseSchema.optional(),
    recordExpiresAtMs: z.number().int().nonnegative().optional(),
    collection: cloudComputerCommandCollectionSchema.optional(),
    status: z.enum(["running", "completed", "stop_requested"]),
    exitCode: z.number().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    after: z.number().optional(),
    outputPending: z.literal(true).optional(),
    syncPending: z.literal(true).optional(),
    syncError: z.enum(["ENOENT", "EEXEC_LOST", "ESYNC_READ_ONLY"]).optional(),
    syncSkipped: z
      .object({ paths: z.array(z.string()).max(16), truncated: z.boolean() })
      .optional(),
    outputTruncated: z.literal(true).optional(),
    result: z.json().optional(),
    nextAction: z.string().optional(),
  }),
]);
export const cloudComputerResponseSchema = z.strictObject({
  computer: cloudComputerSchema,
  observedAtMs: z.number().int(),
  result: cloudComputerOperationResultSchema.optional(),
});

export const cloudComputerCleanupResultSchema = z.strictObject({
  unfinished: z.number().int().nonnegative(),
  lostDuringCleanup: z.boolean(),
});

// Read projection of the original command receipts. Model completion and
// process cleanup are separate facts; this projection cannot start work.
export const cloudComputerInvocationStateSchema = z.strictObject({
  invocationId: key,
  total: z.number().int().nonnegative(),
  unfinished: z.number().int().nonnegative(),
  pendingResults: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
  commands: z
    .array(
      z.strictObject({
        reference: cloudComputerCommandReferenceSchema,
        phase: cloudComputerCommandPhaseSchema,
        after: z.number().nonnegative(),
        exitCode: z.number().nullable(),
        outputRetained: z.boolean(),
        filesSynced: z.boolean(),
        stopRequested: z.boolean(),
        terminationConfirmed: z.boolean(),
        resultUnavailable: z.boolean(),
        collection: cloudComputerCommandCollectionSchema.nullable(),
      })
    )
    .max(32),
});
export type CloudComputerInvocationState = zod.infer<
  typeof cloudComputerInvocationStateSchema
>;
export const cloudComputerCleanupReportSchema = z.strictObject({
  stopAccepted: z.boolean(),
  automaticRetryPaused: z.boolean(),
  state: cloudComputerInvocationStateSchema.nullable(),
});
export type CloudComputerCleanupReport = zod.infer<
  typeof cloudComputerCleanupReportSchema
>;

/** Immutable disclosure scope for receipts, independent of Flue generation. */
export const cloudComputerRecoveryScopeSchema = z.strictObject({
  organizationId: key,
  spaceId: key,
  agentProfileId: key,
});
export const cloudComputerInvocationOwnerSchema =
  cloudComputerRecoveryScopeSchema.extend({
    invocationId: key,
  });
export type CloudComputerInvocationOwner = zod.infer<
  typeof cloudComputerInvocationOwnerSchema
>;
export const cloudComputerRecoveryQuerySchema =
  cloudComputerRecoveryScopeSchema.extend({
    invocationId: key.optional(),
    cursor: key.optional(),
  });
export type CloudComputerRecoveryQuery = zod.infer<
  typeof cloudComputerRecoveryQuerySchema
>;
export const cloudComputerRecoveryResultSchema = z.strictObject({
  invocations: z.array(cloudComputerInvocationStateSchema).max(32),
  nextCursor: key.nullable(),
});
