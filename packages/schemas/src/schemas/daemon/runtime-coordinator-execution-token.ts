import * as z from "zod/v4";

export const RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION =
  "openmeld.runtime_coordinator.execution_token.v1" as const;
export const RUNTIME_COORDINATOR_TOKEN_DIAGNOSTIC_MODEL_VERSION =
  "openmeld.runtime_coordinator.token_diagnostic.v1" as const;
export const RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION =
  "openmeld.runtime_coordinator.token_authority.v1" as const;
export const RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER =
  "[REDACTED_EXECUTION_TOKEN]" as const;

export const RUNTIME_COORDINATOR_TOKEN_SECRET_FIELD_NAMES = [
  "executionToken",
  "rawExecutionToken",
  "rawToken",
  "sealedExecutionToken",
  "sealedToken",
  "tokenSecret",
  "tokenSecretRefOrSealedToken",
  "tokenValidationHash",
  "validationHash",
] as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const boundedNullableIdentifierSchema = boundedIdentifierSchema.nullable();
const boundedReasonCodeSchema = z.string().trim().min(1).max(160);
const nullablePositiveIntegerSchema = z.number().int().positive().nullable();
const nullableTimestampSchema = z.number().int().nonnegative().nullable();

export const runtimeCoordinatorExecutionTokenSchema = z
  .string()
  .trim()
  .min(32)
  .max(256)
  .regex(/^rcet_v1_[A-Za-z0-9_-]+$/);

export const runtimeCoordinatorTokenValidationHashSchema = z
  .string()
  .trim()
  .regex(/^sha256:[a-f0-9]{64}$/);

export const runtimeCoordinatorTokenFingerprintSchema = z
  .string()
  .trim()
  .regex(/^etfp_v1_[a-f0-9]{16,64}$/);

export const runtimeCoordinatorTokenStatusSchema = z.enum([
  "active",
  "superseded",
  "expired",
  "revoked",
  "terminal",
]);

export const runtimeCoordinatorTokenReasonCodeSchema = z.enum([
  "delivery_accepted",
  "execution_token_authority_missing",
  "execution_token_expired",
  "execution_token_issued",
  "execution_token_mismatch",
  "execution_token_missing",
  "execution_token_revoked",
  "execution_token_scope_mismatch",
  "execution_token_superseded",
  "execution_token_terminal_late",
  "execution_token_unknown",
  "token_history_pruned",
  "token_history_retained",
]);

export const RUNTIME_COORDINATOR_RETIRED_TOKEN_REASON_CODE_BY_STATUS = {
  expired: "execution_token_expired",
  revoked: "execution_token_revoked",
  superseded: "execution_token_superseded",
  terminal: "execution_token_terminal_late",
} as const;

export const runtimeCoordinatorTokenExecutionScopeSchema = z.strictObject({
  dispatchId: boundedIdentifierSchema,
  runtimeCoordinatorExecutionId: boundedIdentifierSchema,
  sourceClientMessageId: boundedIdentifierSchema.nullable(),
  spaceId: boundedIdentifierSchema,
  targetProfileId: boundedIdentifierSchema,
});

export const runtimeCoordinatorTokenAuthorityScopeSchema = z.strictObject({
  bindingId: boundedIdentifierSchema,
  agentControllerRef: boundedIdentifierSchema,
  openMeldServiceRuntimeId: boundedIdentifierSchema,
});

export const runtimeCoordinatorTokenDeliveryProvenanceSchema = z.strictObject({
  connectionGeneration: nullablePositiveIntegerSchema,
  daemonSessionId: boundedNullableIdentifierSchema,
  leaseEpoch: nullablePositiveIntegerSchema,
});

export const runtimeCoordinatorExecutionTokenEnvelopeSchema = z.strictObject({
  authorityScope: runtimeCoordinatorTokenAuthorityScopeSchema,
  deliveryIdempotencyKey: boundedIdentifierSchema,
  deliveryProvenance: runtimeCoordinatorTokenDeliveryProvenanceSchema,
  executionScope: runtimeCoordinatorTokenExecutionScopeSchema,
  executionToken: runtimeCoordinatorExecutionTokenSchema,
  expiresAtMs: nullableTimestampSchema,
  issuedAtMs: z.number().int().nonnegative(),
  modelVersion: z.literal(RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION),
  runId: boundedIdentifierSchema,
  tokenFingerprint: runtimeCoordinatorTokenFingerprintSchema,
  tokenStatus: z.literal("active"),
});

export const runtimeCoordinatorExecutionTokenEchoSchema = z.strictObject({
  executionToken: runtimeCoordinatorExecutionTokenSchema,
  runId: boundedIdentifierSchema,
  runtimeCoordinatorExecutionId: boundedIdentifierSchema,
  tokenFingerprint: runtimeCoordinatorTokenFingerprintSchema,
});

export const runtimeCoordinatorTokenProjectionSchema = z.strictObject({
  deliveryIdempotencyKey: boundedIdentifierSchema,
  expiresAtMs: nullableTimestampSchema,
  issuedAtMs: z.number().int().nonnegative(),
  modelVersion: z.literal(RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION),
  reasonCode: runtimeCoordinatorTokenReasonCodeSchema.nullable(),
  retiredAtMs: nullableTimestampSchema,
  retentionExpiresAtMs: nullableTimestampSchema,
  runId: boundedIdentifierSchema,
  tokenFingerprint: runtimeCoordinatorTokenFingerprintSchema,
  tokenStatus: runtimeCoordinatorTokenStatusSchema,
});

export const runtimeCoordinatorTokenDiagnosticEventSchema = z.strictObject({
  ignoredEventSummary: z.string().trim().min(1).max(1000).nullable(),
  modelVersion: z.literal(RUNTIME_COORDINATOR_TOKEN_DIAGNOSTIC_MODEL_VERSION),
  observedAtMs: z.number().int().nonnegative(),
  reasonCode: runtimeCoordinatorTokenReasonCodeSchema,
  runId: boundedNullableIdentifierSchema,
  runtimeCoordinatorExecutionId: boundedIdentifierSchema,
  tokenFingerprint: runtimeCoordinatorTokenFingerprintSchema.nullable(),
  tokenStatus: runtimeCoordinatorTokenStatusSchema.nullable(),
});

export const runtimeCoordinatorTokenRunAuthoritySchema = z.strictObject({
  deliveryIdempotencyKey: boundedIdentifierSchema,
  deliveryProvenance: runtimeCoordinatorTokenDeliveryProvenanceSchema,
  expiresAtMs: nullableTimestampSchema,
  issuedAtMs: z.number().int().nonnegative(),
  retentionExpiresAtMs: nullableTimestampSchema,
  retiredAtMs: nullableTimestampSchema,
  retiredReasonCode: runtimeCoordinatorTokenReasonCodeSchema.nullable(),
  runId: boundedIdentifierSchema,
  supersededByRunId: boundedNullableIdentifierSchema,
  supersedesRunId: boundedNullableIdentifierSchema,
  tokenFingerprint: runtimeCoordinatorTokenFingerprintSchema,
  tokenSecretRefOrSealedToken: z.string().trim().min(1).max(4096).nullable(),
  tokenStatus: runtimeCoordinatorTokenStatusSchema,
  tokenValidationHash: runtimeCoordinatorTokenValidationHashSchema,
});

const runtimeCoordinatorExecutionTokenAuthorityRecordBaseSchema =
  z.strictObject({
    authorityScope: runtimeCoordinatorTokenAuthorityScopeSchema,
    currentRunId: boundedNullableIdentifierSchema,
    executionScope: runtimeCoordinatorTokenExecutionScopeSchema,
    modelVersion: z.literal(RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION),
    retention: z.strictObject({
      lastPrunedAtMs: nullableTimestampSchema,
      lateResultWindowMs: z.number().int().nonnegative(),
      maxRetiredRuns: z.number().int().positive(),
    }),
    runtimeCoordinatorExecutionId: boundedIdentifierSchema,
    runsById: z.record(
      boundedIdentifierSchema,
      runtimeCoordinatorTokenRunAuthoritySchema
    ),
    terminalOutcome: z
      .strictObject({
        finalizedAtMs: z.number().int().nonnegative(),
        reasonCode: boundedReasonCodeSchema,
        replySignalId: boundedNullableIdentifierSchema,
        status: z.enum(["reply_published", "failed_terminal", "cancelled"]),
      })
      .nullable(),
    tokenValidationHashIndex: z.record(
      runtimeCoordinatorTokenValidationHashSchema,
      boundedIdentifierSchema
    ),
  });

export const runtimeCoordinatorExecutionTokenAuthorityRecordSchema =
  runtimeCoordinatorExecutionTokenAuthorityRecordBaseSchema.superRefine(
    (record, context) => {
      validateCurrentTokenRun(record, context);
      validateRetiredTokenHistoryLimit(record, context);
      validateTokenRunAuthorityEntries(record, context);
    }
  );

type RuntimeCoordinatorTokenAuthorityRecordInput = z.infer<
  typeof runtimeCoordinatorExecutionTokenAuthorityRecordBaseSchema
>;
type RuntimeCoordinatorTokenRunAuthorityInput =
  RuntimeCoordinatorTokenAuthorityRecordInput["runsById"][string];
type RuntimeCoordinatorTokenIssueContext = {
  addIssue: (issue: {
    code: "custom";
    message: string;
    path?: Array<number | string>;
  }) => void;
};

function validateCurrentTokenRun(
  record: RuntimeCoordinatorTokenAuthorityRecordInput,
  context: RuntimeCoordinatorTokenIssueContext
): void {
  const activeRunIds = Object.values(record.runsById)
    .filter((run) => run.tokenStatus === "active")
    .map((run) => run.runId);

  if (record.currentRunId === null && activeRunIds.length > 0) {
    addTokenAuthorityIssue(
      context,
      ["currentRunId"],
      "active token run requires currentRunId"
    );
  }
  if (
    record.currentRunId !== null &&
    (activeRunIds.length !== 1 || activeRunIds[0] !== record.currentRunId)
  ) {
    addTokenAuthorityIssue(
      context,
      ["runsById"],
      "authority record must have exactly one current active run"
    );
  }
  if (record.currentRunId === null) {
    return;
  }

  const currentRun = record.runsById[record.currentRunId];
  if (!currentRun) {
    addTokenAuthorityIssue(
      context,
      ["currentRunId"],
      "currentRunId must reference an existing run"
    );
    return;
  }
  if (currentRun.tokenStatus !== "active") {
    addTokenAuthorityIssue(
      context,
      ["runsById", record.currentRunId, "tokenStatus"],
      "current run must be active"
    );
  }
}

function validateRetiredTokenHistoryLimit(
  record: RuntimeCoordinatorTokenAuthorityRecordInput,
  context: RuntimeCoordinatorTokenIssueContext
): void {
  const retiredRunCount = Object.values(record.runsById).filter(
    (run) => run.tokenStatus !== "active"
  ).length;
  if (retiredRunCount > record.retention.maxRetiredRuns) {
    addTokenAuthorityIssue(
      context,
      ["retention", "maxRetiredRuns"],
      "retired token history exceeds maxRetiredRuns"
    );
  }
}

function validateTokenRunAuthorityEntries(
  record: RuntimeCoordinatorTokenAuthorityRecordInput,
  context: RuntimeCoordinatorTokenIssueContext
): void {
  for (const [runKey, run] of Object.entries(record.runsById)) {
    if (run.runId !== runKey) {
      addTokenAuthorityIssue(
        context,
        ["runsById", runKey, "runId"],
        "run key must match runId"
      );
    }
    validateTokenRunSecretBoundary(runKey, run, context);
    validateTokenValidationHashIndex(record, run, context);
  }
}

function validateTokenRunSecretBoundary(
  runKey: string,
  run: RuntimeCoordinatorTokenRunAuthorityInput,
  context: RuntimeCoordinatorTokenIssueContext
): void {
  if (run.tokenStatus === "active") {
    validateActiveTokenRunSecretBoundary(runKey, run, context);
    return;
  }
  validateRetiredTokenRunSecretBoundary(runKey, run, context);
}

function validateActiveTokenRunSecretBoundary(
  runKey: string,
  run: RuntimeCoordinatorTokenRunAuthorityInput,
  context: RuntimeCoordinatorTokenIssueContext
): void {
  if (!run.tokenSecretRefOrSealedToken) {
    addTokenAuthorityIssue(
      context,
      ["runsById", runKey, "tokenSecretRefOrSealedToken"],
      "active run must retain a resendable token secret"
    );
  }
  if (
    run.retiredAtMs !== null ||
    run.retentionExpiresAtMs !== null ||
    run.retiredReasonCode !== null
  ) {
    addTokenAuthorityIssue(
      context,
      ["runsById", runKey],
      "active run must not carry retired metadata"
    );
  }
}

function validateRetiredTokenRunSecretBoundary(
  runKey: string,
  run: RuntimeCoordinatorTokenRunAuthorityInput,
  context: RuntimeCoordinatorTokenIssueContext
): void {
  if (run.tokenSecretRefOrSealedToken !== null) {
    addTokenAuthorityIssue(
      context,
      ["runsById", runKey, "tokenSecretRefOrSealedToken"],
      "retired run must not retain a resendable token secret"
    );
    return;
  }
  if (
    run.retiredAtMs === null ||
    run.retentionExpiresAtMs === null ||
    run.retiredReasonCode === null
  ) {
    addTokenAuthorityIssue(
      context,
      ["runsById", runKey],
      "retired run must carry retired metadata"
    );
    return;
  }
  if (run.tokenStatus === "active") {
    return;
  }

  if (
    run.retiredReasonCode !==
    RUNTIME_COORDINATOR_RETIRED_TOKEN_REASON_CODE_BY_STATUS[run.tokenStatus]
  ) {
    addTokenAuthorityIssue(
      context,
      ["runsById", runKey, "retiredReasonCode"],
      "retired run reason must match token status"
    );
  }
}

function validateTokenValidationHashIndex(
  record: RuntimeCoordinatorTokenAuthorityRecordInput,
  run: RuntimeCoordinatorTokenRunAuthorityInput,
  context: RuntimeCoordinatorTokenIssueContext
): void {
  const indexedRunId = record.tokenValidationHashIndex[run.tokenValidationHash];
  if (indexedRunId !== run.runId) {
    addTokenAuthorityIssue(
      context,
      ["tokenValidationHashIndex", run.tokenValidationHash],
      "tokenValidationHashIndex must map each hash to its run"
    );
  }
}

function addTokenAuthorityIssue(
  context: RuntimeCoordinatorTokenIssueContext,
  path: Array<number | string>,
  message: string
): void {
  context.addIssue({
    code: "custom",
    message,
    path,
  });
}

export const runtimeCoordinatorSafeEventPayloadJsonSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      context.addIssue({
        code: "custom",
        message: "runtime coordinator event payloadJson must be valid JSON",
      });
      return;
    }

    const sensitivePath = findSensitiveTokenFieldPath(parsed);
    if (sensitivePath) {
      context.addIssue({
        code: "custom",
        message:
          "runtime coordinator event payloadJson must not contain execution token secrets",
        path: sensitivePath,
      });
    }
  });

const findSensitiveTokenFieldPath = (
  value: unknown,
  path: Array<string | number> = []
): Array<string | number> | null => {
  if (typeof value === "string") {
    if (isRuntimeCoordinatorTokenSecretValue(value)) {
      return path;
    }
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const match = findSensitiveTokenFieldPath(item, [...path, index]);
      if (match) {
        return match;
      }
    }
    return null;
  }

  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const nextPath = [...path, fieldName];
    if (isAllowedRedactedTokenField(fieldName, fieldValue)) {
      continue;
    }
    if (isSensitiveTokenFieldName(fieldName)) {
      return nextPath;
    }
    const match = findSensitiveTokenFieldPath(fieldValue, nextPath);
    if (match) {
      return match;
    }
  }

  return null;
};

const TOKEN_SECRET_FIELD_NAME_SET = new Set(
  RUNTIME_COORDINATOR_TOKEN_SECRET_FIELD_NAMES.map((fieldName) =>
    normalizePayloadFieldName(fieldName)
  )
);
const SAFE_TOKEN_METADATA_FIELD_NAME_SET = new Set([
  "reasoncode",
  "tokenfingerprint",
  "tokenstatus",
]);
const RAW_EXECUTION_TOKEN_VALUE_PATTERN = /^rcet_v1_[A-Za-z0-9_-]+$/;
const TOKEN_VALIDATION_HASH_VALUE_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isSensitiveTokenFieldName(fieldName: string): boolean {
  const normalized = normalizePayloadFieldName(fieldName);
  if (SAFE_TOKEN_METADATA_FIELD_NAME_SET.has(normalized)) {
    return false;
  }
  if (TOKEN_SECRET_FIELD_NAME_SET.has(normalized)) {
    return true;
  }

  const referencesToken =
    normalized.includes("token") ||
    normalized.includes("credential") ||
    normalized.includes("bearer");
  const referencesProof =
    normalized.includes("hash") ||
    normalized.includes("validation") ||
    normalized.includes("validator") ||
    normalized.includes("digest") ||
    normalized.includes("proof") ||
    normalized.includes("secret") ||
    normalized.includes("sealed") ||
    normalized.includes("signature") ||
    normalized.includes("raw");

  return referencesToken && referencesProof;
}

function isRuntimeCoordinatorTokenSecretValue(value: string): boolean {
  const normalized = value.trim();
  return (
    RAW_EXECUTION_TOKEN_VALUE_PATTERN.test(normalized) ||
    TOKEN_VALIDATION_HASH_VALUE_PATTERN.test(normalized)
  );
}

function isAllowedRedactedTokenField(
  fieldName: string,
  fieldValue: unknown
): boolean {
  return (
    normalizePayloadFieldName(fieldName).endsWith("redacted") &&
    fieldValue === RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER
  );
}

function normalizePayloadFieldName(fieldName: string): string {
  return fieldName.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}
