import {
  RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
  RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER,
  RUNTIME_COORDINATOR_RETIRED_TOKEN_REASON_CODE_BY_STATUS,
  RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION,
  RUNTIME_COORDINATOR_TOKEN_SECRET_FIELD_NAMES,
  runtimeCoordinatorExecutionTokenAuthorityRecordSchema,
  runtimeCoordinatorExecutionTokenSchema,
  runtimeCoordinatorTokenReasonCodeSchema,
  runtimeCoordinatorTokenStatusSchema,
} from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeCoordinatorExecutionTokenEnvelope,
  RuntimeCoordinatorTokenAuthorityScope,
  RuntimeCoordinatorTokenDeliveryProvenance,
  RuntimeCoordinatorTokenExecutionScope,
  RuntimeCoordinatorTokenReasonCode,
  RuntimeCoordinatorTokenRunAuthority,
  RuntimeCoordinatorTokenStatus,
} from "@openmeld/schemas/types";

export const REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN =
  RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER;

const EXECUTION_TOKEN_BYTE_LENGTH = 32;
const TOKEN_VALIDATION_HASH_DOMAIN =
  "openmeld.runtime_coordinator.execution_token.validation.v1";
const TOKEN_FINGERPRINT_DOMAIN =
  "openmeld.runtime_coordinator.execution_token.fingerprint.v1";
const EXECUTION_TOKEN_PATTERN = /^rcet_v1_[A-Za-z0-9_-]+$/;
const TOKEN_VALIDATION_HASH_VALUE_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DEFAULT_LATE_RESULT_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RETIRED_TOKEN_RUNS = 16;
const RETIRED_TOKEN_STATUSES = new Set<RuntimeCoordinatorTokenStatus>([
  ...runtimeCoordinatorTokenStatusSchema.options.filter(
    (status) => status !== "active"
  ),
]);
const TOKEN_REASON_CODES = new Set<RuntimeCoordinatorTokenReasonCode>([
  ...runtimeCoordinatorTokenReasonCodeSchema.options,
]);
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

export type RuntimeCoordinatorTokenScope = {
  authorityScope: RuntimeCoordinatorTokenAuthorityScope;
  executionScope: RuntimeCoordinatorTokenExecutionScope;
  runId: string;
};

export type RuntimeCoordinatorExecutionTokenIssueResult = {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  envelope: RuntimeCoordinatorExecutionTokenEnvelope;
  reusedExistingRun: boolean;
};

export type RuntimeCoordinatorExecutionTokenValidationFailureReason = Extract<
  RuntimeCoordinatorTokenReasonCode,
  | "execution_token_authority_missing"
  | "execution_token_expired"
  | "execution_token_missing"
  | "execution_token_revoked"
  | "execution_token_scope_mismatch"
  | "execution_token_superseded"
  | "execution_token_terminal_late"
  | "execution_token_unknown"
>;

export type RuntimeCoordinatorExecutionTokenValidationResult =
  | {
      ok: true;
      run: RuntimeCoordinatorTokenRunAuthority;
    }
  | {
      ok: false;
      reasonCode: RuntimeCoordinatorExecutionTokenValidationFailureReason;
      run: RuntimeCoordinatorTokenRunAuthority | null;
      tokenFingerprint: string | null;
      tokenStatus: RuntimeCoordinatorTokenStatus | null;
    };

export type RuntimeCoordinatorTokenAwareEventKind =
  | "duplicate_delivery"
  | "late_lifecycle"
  | "late_result"
  | "owner_conflict"
  | "reclaim"
  | "retry"
  | "timeout";

export type RuntimeCoordinatorOwnerConflictTokenClass =
  | "current"
  | "missing"
  | "stale";

export type RuntimeCoordinatorTokenAwareDecisionKind =
  | "record_contract_diagnostic"
  | "record_current_owner_conflict"
  | "record_stale_diagnostic"
  | "reject_missing_authority_secret"
  | "reuse_active_delivery"
  | "runtime_coordinator_decision_required";

export type RuntimeCoordinatorTokenAwareExecutionDecision = {
  coordinatorAction:
    | "decide_retry_timeout_or_reclaim"
    | "record_diagnostic_only"
    | "reuse_active_delivery";
  eventKind: RuntimeCoordinatorTokenAwareEventKind;
  kind: RuntimeCoordinatorTokenAwareDecisionKind;
  mayPublishSpaceReply: boolean;
  mayReconstructTokenFromFingerprintOrHash: false;
  mayUseD1TokenProjection: false;
  ownerConflictTokenClass: RuntimeCoordinatorOwnerConflictTokenClass | null;
  queueOrAlarmRole: "not_applicable" | "trigger_only";
  reasonCode: string;
  runId: string | null;
  tokenStatus: RuntimeCoordinatorTokenStatus | null;
  usesFinalClaimAuthority: false;
  usesLegacyClaimLeaseAuthority: false;
};

export const resolveRuntimeCoordinatorTokenAwareExecutionDecision = (input: {
  activeTokenSecretAvailable?: boolean;
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  eventKind: RuntimeCoordinatorTokenAwareEventKind;
  observedRun?: RuntimeCoordinatorTokenRunAuthority | null;
  observedRunId?: string | null;
  ownerConflictTokenClass?: RuntimeCoordinatorOwnerConflictTokenClass | null;
  trigger?: "alarm" | "daemon" | "queue";
}): RuntimeCoordinatorTokenAwareExecutionDecision => {
  const authority = input.authority
    ? normalizeTokenAuthorityForDecision(input.authority)
    : null;
  const context = buildRuntimeCoordinatorTokenAwareDecisionContext({
    authority,
    observedRun: input.observedRun,
    observedRunId: input.observedRunId ?? null,
    trigger: input.trigger,
  });

  if (input.eventKind === "duplicate_delivery") {
    return resolveDuplicateRuntimeCoordinatorDeliveryDecision({
      activeTokenSecretAvailable: input.activeTokenSecretAvailable,
      context,
      eventKind: input.eventKind,
    });
  }

  if (input.eventKind === "owner_conflict") {
    return resolveOwnerConflictRuntimeCoordinatorDecision({
      eventKind: input.eventKind,
      ownerConflictTokenClass: input.ownerConflictTokenClass ?? null,
      context,
    });
  }

  return resolveRuntimeCoordinatorProgressTriggerDecision({
    authority,
    eventKind: input.eventKind,
    context,
  });
};

export const issueRuntimeCoordinatorExecutionToken = async (input: {
  authorityScope: RuntimeCoordinatorTokenAuthorityScope;
  deliveryProvenance: RuntimeCoordinatorTokenDeliveryProvenance;
  existingAuthority?: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  executionScope: RuntimeCoordinatorTokenExecutionScope;
  expiresAtMs?: number | null;
  lateResultWindowMs?: number;
  maxRetiredRuns?: number;
  nowMs: number;
  randomBytes?: (byteLength: number) => Uint8Array;
  runId?: string;
}): Promise<RuntimeCoordinatorExecutionTokenIssueResult> => {
  const existingAuthority = input.existingAuthority
    ? assertValidTokenAuthority(input.existingAuthority)
    : null;
  if (existingAuthority) {
    assertTokenAuthorityScopeMatches(existingAuthority, {
      authorityScope: input.authorityScope,
      executionScope: input.executionScope,
    });
    const activeRun = resolveCurrentTokenRun(existingAuthority);
    if (!activeRun) {
      throw new Error("runtime_coordinator.execution_token_active_run_missing");
    }
    const executionToken = activeRun.tokenSecretRefOrSealedToken;
    if (!executionToken) {
      throw new Error("runtime_coordinator.execution_token_secret_missing");
    }
    return {
      authority: existingAuthority,
      envelope: buildRuntimeCoordinatorExecutionTokenEnvelope({
        authority: existingAuthority,
        executionToken,
        run: activeRun,
      }),
      reusedExistingRun: true,
    };
  }

  const runId = input.runId ?? `rctr_${getWebCrypto().randomUUID()}`;
  const scope: RuntimeCoordinatorTokenScope = {
    authorityScope: input.authorityScope,
    executionScope: input.executionScope,
    runId,
  };
  const executionToken = generateRuntimeCoordinatorExecutionToken({
    randomBytes: input.randomBytes,
  });
  const [tokenValidationHash, tokenFingerprint] = await Promise.all([
    createRuntimeCoordinatorTokenValidationHash({
      executionToken,
      scope,
    }),
    createRuntimeCoordinatorTokenFingerprint({
      executionToken,
      scope,
    }),
  ]);
  const deliveryIdempotencyKey = `${input.executionScope.runtimeCoordinatorExecutionId}:${runId}`;
  const run: RuntimeCoordinatorTokenRunAuthority = {
    deliveryIdempotencyKey,
    deliveryProvenance: input.deliveryProvenance,
    expiresAtMs: input.expiresAtMs ?? null,
    issuedAtMs: input.nowMs,
    retentionExpiresAtMs: null,
    retiredAtMs: null,
    retiredReasonCode: null,
    runId,
    supersededByRunId: null,
    supersedesRunId: null,
    tokenFingerprint,
    tokenSecretRefOrSealedToken: executionToken,
    tokenStatus: "active",
    tokenValidationHash,
  };
  const authority = assertValidTokenAuthority({
    authorityScope: input.authorityScope,
    currentRunId: runId,
    executionScope: input.executionScope,
    modelVersion: RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION,
    retention: {
      lastPrunedAtMs: null,
      lateResultWindowMs:
        input.lateResultWindowMs ?? DEFAULT_LATE_RESULT_WINDOW_MS,
      maxRetiredRuns: input.maxRetiredRuns ?? DEFAULT_MAX_RETIRED_TOKEN_RUNS,
    },
    runtimeCoordinatorExecutionId:
      input.executionScope.runtimeCoordinatorExecutionId,
    runsById: {
      [runId]: run,
    },
    terminalOutcome: null,
    tokenValidationHashIndex: {
      [tokenValidationHash]: runId,
    },
  });

  return {
    authority,
    envelope: buildRuntimeCoordinatorExecutionTokenEnvelope({
      authority,
      executionToken,
      run,
    }),
    reusedExistingRun: false,
  };
};

export const generateRuntimeCoordinatorExecutionToken = (
  input: { randomBytes?: (byteLength: number) => Uint8Array } = {}
): string => {
  const bytes =
    input.randomBytes?.(EXECUTION_TOKEN_BYTE_LENGTH) ??
    getWebCrypto().getRandomValues(new Uint8Array(EXECUTION_TOKEN_BYTE_LENGTH));
  const token = `rcet_v1_${toHex(bytes)}`;
  const parsed = runtimeCoordinatorExecutionTokenSchema.safeParse(token);
  if (!parsed.success) {
    throw new Error("runtime_coordinator.execution_token_generation_failed");
  }
  return parsed.data;
};

export const createRuntimeCoordinatorTokenValidationHash = async (input: {
  executionToken: string;
  scope: RuntimeCoordinatorTokenScope;
}): Promise<string> => {
  return `sha256:${await digestSha256Hex(
    buildTokenProofMaterial({
      domain: TOKEN_VALIDATION_HASH_DOMAIN,
      executionToken: input.executionToken,
      scope: input.scope,
    })
  )}`;
};

export const createRuntimeCoordinatorTokenFingerprint = async (input: {
  executionToken: string;
  scope: RuntimeCoordinatorTokenScope;
}): Promise<string> => {
  const digest = await digestSha256Hex(
    buildTokenProofMaterial({
      domain: TOKEN_FINGERPRINT_DOMAIN,
      executionToken: input.executionToken,
      scope: input.scope,
    })
  );
  return `etfp_v1_${digest.slice(0, 32)}`;
};

export const validateRuntimeCoordinatorExecutionToken = async (input: {
  executionToken: string;
  expectedValidationHash: string;
  scope: RuntimeCoordinatorTokenScope;
}): Promise<{
  computedValidationHash: string;
  valid: boolean;
}> => {
  const computedValidationHash =
    await createRuntimeCoordinatorTokenValidationHash({
      executionToken: input.executionToken,
      scope: input.scope,
    });
  return {
    computedValidationHash,
    valid: constantTimeStringEqual(
      computedValidationHash,
      input.expectedValidationHash
    ),
  };
};

export async function validateRuntimeCoordinatorExecutionTokenAgainstAuthority(input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  executionTokenEcho?: RuntimeCoordinatorExecutionTokenEcho | null;
  expectedAuthorityScope?: RuntimeCoordinatorTokenAuthorityScope | null;
  expectedExecutionScope?: RuntimeCoordinatorTokenExecutionScope | null;
  nowMs: number;
}): Promise<RuntimeCoordinatorExecutionTokenValidationResult> {
  const executionTokenEcho = input.executionTokenEcho ?? null;
  if (!executionTokenEcho) {
    return {
      ok: false,
      reasonCode: "execution_token_missing",
      run: null,
      tokenFingerprint: null,
      tokenStatus: null,
    };
  }

  const authority = input.authority
    ? assertValidTokenAuthority(input.authority)
    : null;
  if (!authority) {
    return {
      ok: false,
      reasonCode: "execution_token_authority_missing",
      run: null,
      tokenFingerprint: executionTokenEcho.tokenFingerprint,
      tokenStatus: null,
    };
  }

  const hasScopeMismatch =
    executionTokenEcho.runtimeCoordinatorExecutionId !==
      authority.runtimeCoordinatorExecutionId ||
    hasTokenExecutionScopeMismatch({
      actual: authority.executionScope,
      expected: input.expectedExecutionScope ?? null,
    }) ||
    hasTokenAuthorityScopeMismatch({
      actual: authority.authorityScope,
      expected: input.expectedAuthorityScope ?? null,
    });
  if (hasScopeMismatch) {
    return {
      ok: false,
      reasonCode: "execution_token_scope_mismatch",
      run: null,
      tokenFingerprint: executionTokenEcho.tokenFingerprint,
      tokenStatus: null,
    };
  }

  const matchedRun = await findRuntimeCoordinatorTokenRunByExecutionToken({
    authority,
    executionToken: executionTokenEcho.executionToken,
  });
  if (!matchedRun) {
    return {
      ok: false,
      reasonCode: "execution_token_unknown",
      run: null,
      tokenFingerprint: executionTokenEcho.tokenFingerprint,
      tokenStatus: null,
    };
  }

  const inactiveValidation = resolveInactiveTokenValidation({
    authority,
    nowMs: input.nowMs,
    run: matchedRun,
  });
  if (inactiveValidation) {
    return inactiveValidation;
  }

  return {
    ok: true,
    run: matchedRun,
  };
}

export const constantTimeStringEqual = (
  first: string,
  second: string
): boolean => {
  const firstBytes = new TextEncoder().encode(first);
  const secondBytes = new TextEncoder().encode(second);
  const byteLength = Math.max(firstBytes.length, secondBytes.length);
  let isDifferent = firstBytes.length !== secondBytes.length;

  for (let index = 0; index < byteLength; index += 1) {
    if ((firstBytes[index] ?? 0) !== (secondBytes[index] ?? 0)) {
      isDifferent = true;
    }
  }

  return !isDifferent;
};

export const redactRuntimeCoordinatorExecutionTokenSecrets = (
  value: unknown
): unknown => {
  if (typeof value === "string") {
    return isRuntimeCoordinatorTokenSecretValue(value)
      ? REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN
      : value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactRuntimeCoordinatorExecutionTokenSecrets(item)
    );
  }

  const redacted: Record<string, unknown> = {};
  for (const [fieldName, fieldValue] of Object.entries(value)) {
    if (isSensitiveTokenFieldName(fieldName)) {
      redacted[`${fieldName}Redacted`] =
        REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN;
      continue;
    }
    redacted[fieldName] =
      redactRuntimeCoordinatorExecutionTokenSecrets(fieldValue);
  }
  return redacted;
};

export const stringifyRuntimeCoordinatorEventPayload = (
  payload: Record<string, unknown>
): string => {
  return JSON.stringify(redactRuntimeCoordinatorExecutionTokenSecrets(payload));
};

export const retireRuntimeCoordinatorTokenRun = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  reasonCode: RuntimeCoordinatorTokenReasonCode;
  retiredAtMs: number;
  retentionExpiresAtMs: number;
  runId: string;
  tokenStatus: Exclude<RuntimeCoordinatorTokenStatus, "active">;
}): RuntimeCoordinatorExecutionTokenAuthorityRecord => {
  const parsedAuthority = assertValidTokenAuthority(input.authority);
  if (!RETIRED_TOKEN_STATUSES.has(input.tokenStatus)) {
    throw new Error("runtime_coordinator.token_retired_status_required");
  }
  if (!TOKEN_REASON_CODES.has(input.reasonCode)) {
    throw new Error("runtime_coordinator.token_reason_code_invalid");
  }
  if (
    input.reasonCode !==
    RUNTIME_COORDINATOR_RETIRED_TOKEN_REASON_CODE_BY_STATUS[input.tokenStatus]
  ) {
    throw new Error("runtime_coordinator.token_retired_reason_mismatch");
  }
  const run = parsedAuthority.runsById[input.runId];
  if (!run) {
    throw new Error("runtime_coordinator.token_run_not_found");
  }
  if (run.tokenStatus !== "active") {
    throw new Error("runtime_coordinator.token_run_already_retired");
  }

  return assertValidTokenAuthority({
    ...parsedAuthority,
    currentRunId:
      parsedAuthority.currentRunId === input.runId
        ? null
        : parsedAuthority.currentRunId,
    runsById: {
      ...parsedAuthority.runsById,
      [input.runId]: {
        ...run,
        retentionExpiresAtMs: input.retentionExpiresAtMs,
        retiredAtMs: input.retiredAtMs,
        retiredReasonCode: input.reasonCode,
        tokenSecretRefOrSealedToken: null,
        tokenStatus: input.tokenStatus,
      },
    },
  });
};

export const pruneRuntimeCoordinatorTokenHistory = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nowMs: number;
}): {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  prunedRunIds: string[];
} => {
  const parsedAuthority = assertValidTokenAuthority(input.authority);

  const prunedRunIds = resolvePrunableRunIds({
    authority: parsedAuthority,
    nowMs: input.nowMs,
  });
  if (prunedRunIds.length === 0) {
    return {
      authority: parsedAuthority,
      prunedRunIds,
    };
  }

  const runsById = { ...parsedAuthority.runsById };
  const tokenValidationHashIndex = {
    ...parsedAuthority.tokenValidationHashIndex,
  };
  for (const runId of prunedRunIds) {
    const run = runsById[runId];
    if (!run) {
      continue;
    }
    delete tokenValidationHashIndex[run.tokenValidationHash];
    delete runsById[runId];
  }

  return {
    authority: assertValidTokenAuthority({
      ...parsedAuthority,
      retention: {
        ...parsedAuthority.retention,
        lastPrunedAtMs: input.nowMs,
      },
      runsById,
      tokenValidationHashIndex,
    }),
    prunedRunIds,
  };
};

export const findRuntimeCoordinatorTokenRunByValidationHash = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  tokenValidationHash: string;
}): RuntimeCoordinatorTokenRunAuthority | null => {
  const runId =
    input.authority.tokenValidationHashIndex[input.tokenValidationHash];
  return runId ? (input.authority.runsById[runId] ?? null) : null;
};

const findRuntimeCoordinatorTokenRunByExecutionToken = async (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  executionToken: string;
}): Promise<RuntimeCoordinatorTokenRunAuthority | null> => {
  const runs = Object.values(input.authority.runsById);
  for (const run of runs) {
    const validation = await validateRuntimeCoordinatorExecutionToken({
      executionToken: input.executionToken,
      expectedValidationHash: run.tokenValidationHash,
      scope: {
        authorityScope: input.authority.authorityScope,
        executionScope: input.authority.executionScope,
        runId: run.runId,
      },
    });
    if (validation.valid) {
      return run;
    }
  }
  return null;
};

const resolveInactiveTokenValidation = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nowMs: number;
  run: RuntimeCoordinatorTokenRunAuthority;
}): RuntimeCoordinatorExecutionTokenValidationResult | null => {
  if (input.authority.terminalOutcome) {
    return {
      ok: false,
      reasonCode: "execution_token_terminal_late",
      run: input.run,
      tokenFingerprint: input.run.tokenFingerprint,
      tokenStatus: "terminal",
    };
  }
  if (input.run.tokenStatus !== "active") {
    return {
      ok: false,
      reasonCode: resolveRetiredTokenValidationReason(input.run.tokenStatus),
      run: input.run,
      tokenFingerprint: input.run.tokenFingerprint,
      tokenStatus: input.run.tokenStatus,
    };
  }
  if (isRuntimeCoordinatorTokenRunExpired(input.run, input.nowMs)) {
    return {
      ok: false,
      reasonCode: "execution_token_expired",
      run: input.run,
      tokenFingerprint: input.run.tokenFingerprint,
      tokenStatus: "expired",
    };
  }
  if (input.authority.currentRunId !== input.run.runId) {
    return {
      ok: false,
      reasonCode: "execution_token_superseded",
      run: input.run,
      tokenFingerprint: input.run.tokenFingerprint,
      tokenStatus: "superseded",
    };
  }
  return null;
};

const resolveRetiredTokenValidationReason = (
  tokenStatus: Exclude<RuntimeCoordinatorTokenStatus, "active">
): RuntimeCoordinatorExecutionTokenValidationFailureReason => {
  switch (tokenStatus) {
    case "expired":
      return "execution_token_expired";
    case "revoked":
      return "execution_token_revoked";
    case "superseded":
      return "execution_token_superseded";
    case "terminal":
      return "execution_token_terminal_late";
    default:
      throw new Error("runtime_coordinator.token_status_invalid");
  }
};

const isRuntimeCoordinatorTokenRunExpired = (
  run: RuntimeCoordinatorTokenRunAuthority,
  nowMs: number
): boolean => run.expiresAtMs !== null && run.expiresAtMs <= nowMs;

const hasTokenExecutionScopeMismatch = (input: {
  actual: RuntimeCoordinatorTokenExecutionScope;
  expected: RuntimeCoordinatorTokenExecutionScope | null;
}): boolean => {
  if (!input.expected) {
    return false;
  }
  return (
    input.actual.dispatchId !== input.expected.dispatchId ||
    input.actual.runtimeCoordinatorExecutionId !==
      input.expected.runtimeCoordinatorExecutionId ||
    input.actual.sourceClientMessageId !==
      input.expected.sourceClientMessageId ||
    input.actual.spaceId !== input.expected.spaceId ||
    input.actual.targetProfileId !== input.expected.targetProfileId
  );
};

const hasTokenAuthorityScopeMismatch = (input: {
  actual: RuntimeCoordinatorTokenAuthorityScope;
  expected: RuntimeCoordinatorTokenAuthorityScope | null;
}): boolean => {
  if (!input.expected) {
    return false;
  }
  return (
    input.actual.bindingId !== input.expected.bindingId ||
    input.actual.agentControllerRef !== input.expected.agentControllerRef ||
    input.actual.openMeldServiceRuntimeId !==
      input.expected.openMeldServiceRuntimeId
  );
};

const resolvePrunableRunIds = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nowMs: number;
}): string[] => {
  const expiredRetiredRuns = Object.values(input.authority.runsById)
    .filter(
      (run) =>
        run.tokenStatus !== "active" &&
        run.retentionExpiresAtMs !== null &&
        run.retentionExpiresAtMs <= input.nowMs
    )
    .sort((first, second) => {
      return (first.retiredAtMs ?? 0) - (second.retiredAtMs ?? 0);
    });

  return expiredRetiredRuns.map((run) => run.runId);
};

type RuntimeCoordinatorTokenAwareDecisionContext = {
  currentRun: RuntimeCoordinatorTokenRunAuthority | null;
  observedRun: RuntimeCoordinatorTokenRunAuthority | null;
  queueOrAlarmRole: RuntimeCoordinatorTokenAwareExecutionDecision["queueOrAlarmRole"];
};

const buildRuntimeCoordinatorTokenAwareDecisionContext = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  observedRun?: RuntimeCoordinatorTokenRunAuthority | null;
  observedRunId: string | null;
  trigger?: "alarm" | "daemon" | "queue";
}): RuntimeCoordinatorTokenAwareDecisionContext => {
  const observedRun =
    input.observedRun ??
    resolveObservedTokenRun({
      authority: input.authority,
      observedRunId: input.observedRunId,
    });
  return {
    currentRun: input.authority
      ? resolveCurrentTokenRun(input.authority)
      : null,
    observedRun,
    queueOrAlarmRole:
      input.trigger === "queue" || input.trigger === "alarm"
        ? "trigger_only"
        : "not_applicable",
  };
};

const resolveDuplicateRuntimeCoordinatorDeliveryDecision = (input: {
  activeTokenSecretAvailable?: boolean;
  context: RuntimeCoordinatorTokenAwareDecisionContext;
  eventKind: Extract<
    RuntimeCoordinatorTokenAwareEventKind,
    "duplicate_delivery"
  >;
}): RuntimeCoordinatorTokenAwareExecutionDecision => {
  const currentRun = input.context.currentRun;
  if (!currentRun) {
    return buildRuntimeCoordinatorTokenAwareDecision({
      eventKind: input.eventKind,
      kind: "record_contract_diagnostic",
      queueOrAlarmRole: input.context.queueOrAlarmRole,
      reasonCode: "runtime_coordinator.active_token_run_missing",
    });
  }
  if (
    input.activeTokenSecretAvailable === false ||
    !currentRun.tokenSecretRefOrSealedToken
  ) {
    return buildRuntimeCoordinatorTokenAwareDecision({
      eventKind: input.eventKind,
      kind: "reject_missing_authority_secret",
      queueOrAlarmRole: input.context.queueOrAlarmRole,
      reasonCode: "runtime_coordinator.active_token_secret_unavailable",
      run: currentRun,
    });
  }
  return buildRuntimeCoordinatorTokenAwareDecision({
    eventKind: input.eventKind,
    kind: "reuse_active_delivery",
    queueOrAlarmRole: input.context.queueOrAlarmRole,
    reasonCode: "runtime_coordinator.duplicate_delivery_reuses_authority_token",
    run: currentRun,
  });
};

const resolveOwnerConflictRuntimeCoordinatorDecision = (input: {
  context: RuntimeCoordinatorTokenAwareDecisionContext;
  eventKind: Extract<RuntimeCoordinatorTokenAwareEventKind, "owner_conflict">;
  ownerConflictTokenClass: RuntimeCoordinatorOwnerConflictTokenClass | null;
}): RuntimeCoordinatorTokenAwareExecutionDecision => {
  const ownerConflictTokenClass =
    input.ownerConflictTokenClass ??
    resolveOwnerConflictTokenClass({
      currentRun: input.context.currentRun,
      observedRun: input.context.observedRun,
    });
  if (ownerConflictTokenClass === "missing") {
    return buildRuntimeCoordinatorTokenAwareDecision({
      eventKind: input.eventKind,
      kind: "record_contract_diagnostic",
      ownerConflictTokenClass,
      queueOrAlarmRole: input.context.queueOrAlarmRole,
      reasonCode: "runtime_coordinator.owner_conflict_token_missing",
    });
  }
  if (ownerConflictTokenClass === "stale") {
    return buildRuntimeCoordinatorTokenAwareDecision({
      eventKind: input.eventKind,
      kind: "record_stale_diagnostic",
      ownerConflictTokenClass,
      queueOrAlarmRole: input.context.queueOrAlarmRole,
      reasonCode: resolveTokenRunDiagnosticReason(input.context.observedRun),
      run: input.context.observedRun,
    });
  }
  return buildRuntimeCoordinatorTokenAwareDecision({
    eventKind: input.eventKind,
    kind: "record_current_owner_conflict",
    ownerConflictTokenClass,
    queueOrAlarmRole: input.context.queueOrAlarmRole,
    reasonCode: "runtime_coordinator.owner_conflict_current_token",
    run: input.context.currentRun ?? input.context.observedRun,
  });
};

const resolveRuntimeCoordinatorProgressTriggerDecision = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  context: RuntimeCoordinatorTokenAwareDecisionContext;
  eventKind: Exclude<
    RuntimeCoordinatorTokenAwareEventKind,
    "duplicate_delivery" | "owner_conflict"
  >;
}): RuntimeCoordinatorTokenAwareExecutionDecision => {
  const observedRun = input.context.observedRun;
  if (observedRun && observedRun.tokenStatus !== "active") {
    return buildRuntimeCoordinatorTokenAwareDecision({
      eventKind: input.eventKind,
      kind: "record_stale_diagnostic",
      queueOrAlarmRole: input.context.queueOrAlarmRole,
      reasonCode: resolveTokenRunDiagnosticReason(observedRun),
      run: observedRun,
    });
  }
  if (input.authority?.terminalOutcome) {
    return buildRuntimeCoordinatorTokenAwareDecision({
      eventKind: input.eventKind,
      kind: "record_stale_diagnostic",
      queueOrAlarmRole: input.context.queueOrAlarmRole,
      reasonCode: "execution_token_terminal_late",
      run: observedRun ?? input.context.currentRun,
    });
  }
  return buildRuntimeCoordinatorTokenAwareDecision({
    eventKind: input.eventKind,
    kind: "runtime_coordinator_decision_required",
    queueOrAlarmRole: input.context.queueOrAlarmRole,
    reasonCode:
      input.context.queueOrAlarmRole === "trigger_only"
        ? "runtime_coordinator.queue_or_alarm_trigger_only"
        : "runtime_coordinator.decision_required",
    run: observedRun ?? input.context.currentRun,
  });
};

const resolveObservedTokenRun = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  observedRunId: string | null;
}): RuntimeCoordinatorTokenRunAuthority | null => {
  if (!(input.authority && input.observedRunId)) {
    return null;
  }
  return input.authority.runsById[input.observedRunId] ?? null;
};

const resolveOwnerConflictTokenClass = (input: {
  currentRun: RuntimeCoordinatorTokenRunAuthority | null;
  observedRun: RuntimeCoordinatorTokenRunAuthority | null;
}): RuntimeCoordinatorOwnerConflictTokenClass => {
  if (!input.observedRun) {
    return "missing";
  }
  if (
    input.currentRun &&
    input.observedRun.runId === input.currentRun.runId &&
    input.observedRun.tokenStatus === "active"
  ) {
    return "current";
  }
  return "stale";
};

const resolveTokenRunDiagnosticReason = (
  run: RuntimeCoordinatorTokenRunAuthority | null
): string => {
  if (!run) {
    return "execution_token_unknown";
  }
  if (run.tokenStatus === "active") {
    return "runtime_coordinator.decision_required";
  }
  return (
    run.retiredReasonCode ??
    RUNTIME_COORDINATOR_RETIRED_TOKEN_REASON_CODE_BY_STATUS[run.tokenStatus]
  );
};

const buildRuntimeCoordinatorTokenAwareDecision = (input: {
  eventKind: RuntimeCoordinatorTokenAwareEventKind;
  kind: RuntimeCoordinatorTokenAwareDecisionKind;
  ownerConflictTokenClass?: RuntimeCoordinatorOwnerConflictTokenClass | null;
  queueOrAlarmRole: RuntimeCoordinatorTokenAwareExecutionDecision["queueOrAlarmRole"];
  reasonCode: string;
  run?: RuntimeCoordinatorTokenRunAuthority | null;
}): RuntimeCoordinatorTokenAwareExecutionDecision => {
  const coordinatorAction =
    resolveRuntimeCoordinatorTokenAwareCoordinatorAction(input.kind);
  return {
    coordinatorAction,
    eventKind: input.eventKind,
    kind: input.kind,
    mayPublishSpaceReply: false,
    mayReconstructTokenFromFingerprintOrHash: false,
    mayUseD1TokenProjection: false,
    ownerConflictTokenClass: input.ownerConflictTokenClass ?? null,
    queueOrAlarmRole: input.queueOrAlarmRole,
    reasonCode: input.reasonCode,
    runId: input.run?.runId ?? null,
    tokenStatus: input.run?.tokenStatus ?? null,
    usesFinalClaimAuthority: false,
    usesLegacyClaimLeaseAuthority: false,
  };
};

const resolveRuntimeCoordinatorTokenAwareCoordinatorAction = (
  kind: RuntimeCoordinatorTokenAwareDecisionKind
): RuntimeCoordinatorTokenAwareExecutionDecision["coordinatorAction"] => {
  if (kind === "reuse_active_delivery") {
    return "reuse_active_delivery";
  }
  if (
    kind === "record_contract_diagnostic" ||
    kind === "record_stale_diagnostic"
  ) {
    return "record_diagnostic_only";
  }
  return "decide_retry_timeout_or_reclaim";
};

const normalizeTokenAuthorityForDecision = (
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
): RuntimeCoordinatorExecutionTokenAuthorityRecord => {
  const parsed =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(authority);
  return parsed.success ? parsed.data : authority;
};

const assertValidTokenAuthority = (
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
): RuntimeCoordinatorExecutionTokenAuthorityRecord => {
  const parsed =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(authority);
  if (!parsed.success) {
    throw new Error("runtime_coordinator.token_authority_invalid");
  }
  return parsed.data;
};

const resolveCurrentTokenRun = (
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
): RuntimeCoordinatorTokenRunAuthority | null => {
  const currentRunId = authority.currentRunId;
  if (!currentRunId) {
    return null;
  }
  const run = authority.runsById[currentRunId] ?? null;
  return run?.tokenStatus === "active" ? run : null;
};

const buildRuntimeCoordinatorExecutionTokenEnvelope = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  executionToken: string;
  run: RuntimeCoordinatorTokenRunAuthority;
}): RuntimeCoordinatorExecutionTokenEnvelope => {
  return {
    authorityScope: input.authority.authorityScope,
    deliveryIdempotencyKey: input.run.deliveryIdempotencyKey,
    deliveryProvenance: input.run.deliveryProvenance,
    executionScope: input.authority.executionScope,
    executionToken: input.executionToken,
    expiresAtMs: input.run.expiresAtMs,
    issuedAtMs: input.run.issuedAtMs,
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
    runId: input.run.runId,
    tokenFingerprint: input.run.tokenFingerprint,
    tokenStatus: "active",
  };
};

const assertTokenAuthorityScopeMatches = (
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord,
  expected: {
    authorityScope: RuntimeCoordinatorTokenAuthorityScope;
    executionScope: RuntimeCoordinatorTokenExecutionScope;
  }
): void => {
  if (
    authority.runtimeCoordinatorExecutionId !==
    expected.executionScope.runtimeCoordinatorExecutionId
  ) {
    throw new Error("runtime_coordinator.execution_token_scope_mismatch");
  }
  if (
    authority.executionScope.dispatchId !==
      expected.executionScope.dispatchId ||
    authority.executionScope.spaceId !== expected.executionScope.spaceId ||
    authority.executionScope.targetProfileId !==
      expected.executionScope.targetProfileId ||
    authority.executionScope.sourceClientMessageId !==
      expected.executionScope.sourceClientMessageId
  ) {
    throw new Error("runtime_coordinator.execution_token_scope_mismatch");
  }
  if (
    authority.authorityScope.bindingId !== expected.authorityScope.bindingId ||
    authority.authorityScope.agentControllerRef !==
      expected.authorityScope.agentControllerRef ||
    authority.authorityScope.openMeldServiceRuntimeId !==
      expected.authorityScope.openMeldServiceRuntimeId
  ) {
    throw new Error("runtime_coordinator.execution_token_scope_mismatch");
  }
};

const buildTokenProofMaterial = (input: {
  domain: string;
  executionToken: string;
  scope: RuntimeCoordinatorTokenScope;
}): string => {
  const scope = input.scope;
  return JSON.stringify({
    authorityScope: {
      bindingId: scope.authorityScope.bindingId,
      agentControllerRef: scope.authorityScope.agentControllerRef,
      openMeldServiceRuntimeId: scope.authorityScope.openMeldServiceRuntimeId,
    },
    domain: input.domain,
    executionScope: {
      dispatchId: scope.executionScope.dispatchId,
      runtimeCoordinatorExecutionId:
        scope.executionScope.runtimeCoordinatorExecutionId,
      sourceClientMessageId: scope.executionScope.sourceClientMessageId,
      spaceId: scope.executionScope.spaceId,
      targetProfileId: scope.executionScope.targetProfileId,
    },
    executionToken: input.executionToken,
    runId: scope.runId,
  });
};

const digestSha256Hex = async (value: string): Promise<string> => {
  const digest = await getWebCrypto().subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return toHex(new Uint8Array(digest));
};

const toHex = (bytes: Uint8Array): string => {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

const getWebCrypto = (): Crypto => {
  const cryptoValue = (globalThis as typeof globalThis & { crypto?: Crypto })
    .crypto;
  if (!cryptoValue?.subtle) {
    throw new Error("WebCrypto API is unavailable");
  }
  return cryptoValue;
};

function normalizePayloadFieldName(fieldName: string): string {
  return fieldName.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

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
    EXECUTION_TOKEN_PATTERN.test(normalized) ||
    TOKEN_VALIDATION_HASH_VALUE_PATTERN.test(normalized)
  );
}
