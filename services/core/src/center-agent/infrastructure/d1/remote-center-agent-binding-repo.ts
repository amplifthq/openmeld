import type { OpenCodePermissionConfig } from "@openmeld/schemas/types";
import {
  type AgentProfileBindingRecord,
  type EnabledPrimaryAgentProfileBindingInput,
  listEnabledPrimaryAgentProfileBindingRecordsForProfile,
  readPrimaryAgentProfileBindingRecord,
} from "../../../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { isHostedCenterAgentExecutionTarget } from "../../application/hosted-center-agent-binding";

export type ReconcileRemoteCenterAgentBindingResult = {
  binding: AgentProfileBindingRecord;
  outcome: "created" | "reconnected" | "reused";
};

/**
 * Replaces every admitted enabled Binding for one Agent Profile with one
 * canonical hosted target in one D1 transaction.
 *
 * RuntimeCoordinator admission is the concurrency boundary. A replacement is
 * inserted disabled behind the exact admitted Binding inventory, and every
 * later step depends on that transition marker. Stale evidence therefore has
 * no write side effects, while D1 batch rollback preserves the previous target
 * when a database write fails.
 */
export async function reconcileRemoteCenterAgentBindingRecord(input: {
  currentBindings: readonly AgentProfileBindingRecord[];
  db: D1Database;
  noncanonicalDisabledReasonCode: string;
  record: EnabledPrimaryAgentProfileBindingInput;
}): Promise<ReconcileRemoteCenterAgentBindingResult> {
  assertReconciliationInput(input);

  const canonicalCurrent = input.currentBindings.find(
    (binding) =>
      binding.owner.kind === input.record.owner.kind &&
      binding.owner.id === input.record.owner.id
  );
  const settingsSource = resolveSettingsSource({
    currentBindings: input.currentBindings,
    record: input.record,
  });
  const reuseCanonical =
    canonicalCurrent !== undefined &&
    isSameExecutionTarget(canonicalCurrent, input.record) &&
    isHostedCenterAgentExecutionTarget(canonicalCurrent) &&
    settingsSource?.bindingId === canonicalCurrent.bindingId;
  const replacementRecord = resolveReplacementRecord({
    current: settingsSource,
    record: input.record,
  });
  const targetRecord = reuseCanonical ? canonicalCurrent : replacementRecord;
  const bindingsToDisable = reuseCanonical
    ? input.currentBindings.filter(
        (binding) => binding.bindingId !== canonicalCurrent.bindingId
      )
    : [...input.currentBindings];

  const transition = prepareReconciliationTransition({
    bindingsToDisable,
    currentBindings: input.currentBindings,
    db: input.db,
    noncanonicalDisabledReasonCode: input.noncanonicalDisabledReasonCode,
    record: input.record,
    replacementRecord,
    reuseCanonical,
    targetRecord,
  });
  const results =
    transition.statements.length > 0
      ? await input.db.batch(transition.statements)
      : [];
  assertValidatedBatchBindingTransition({
    cleanupBindingStatement: transition.cleanupBindingStatement,
    disableStatement: transition.disableStatement,
    enableBindingStatement: transition.enableBindingStatement,
    expectedCleanupCount: transition.expectedCleanupCount,
    expectedDisabledCount: bindingsToDisable.length,
    insertBindingStatement: transition.insertBindingStatement,
    results,
  });

  const [enabledBindings, binding] = await Promise.all([
    listEnabledPrimaryAgentProfileBindingRecordsForProfile({
      agentProfileId: input.record.agentProfileId,
      db: input.db,
    }),
    readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.record.agentProfileId,
      db: input.db,
      owner: input.record.owner,
    }),
  ]);
  if (
    enabledBindings.length !== 1 ||
    enabledBindings[0]?.bindingId !== targetRecord.bindingId ||
    !binding
  ) {
    throw new Error(
      "Remote Center Agent Binding reconciliation did not produce one canonical hosted target"
    );
  }
  let outcome: ReconcileRemoteCenterAgentBindingResult["outcome"] = "created";
  if (reuseCanonical) {
    outcome = "reused";
  } else if (canonicalCurrent) {
    outcome = "reconnected";
  }

  return {
    binding,
    outcome,
  };
}

function assertReconciliationInput(input: {
  currentBindings: readonly AgentProfileBindingRecord[];
  record: EnabledPrimaryAgentProfileBindingInput;
}): void {
  const bindingIds = new Set<string>();
  for (const binding of input.currentBindings) {
    if (
      binding.agentProfileId !== input.record.agentProfileId ||
      binding.bindingState !== "enabled_primary" ||
      bindingIds.has(binding.bindingId)
    ) {
      throw new Error(
        "Remote Center Agent Binding reconciliation requires one admitted enabled inventory"
      );
    }
    bindingIds.add(binding.bindingId);
  }
}

function isSameExecutionTarget(
  binding: AgentProfileBindingRecord,
  record: EnabledPrimaryAgentProfileBindingInput
): boolean {
  return (
    binding.openMeldServiceRuntimeId === record.openMeldServiceRuntimeId &&
    binding.agentControllerRef === record.agentControllerRef &&
    normalizeNullableText(binding.agentControllerConversationId) ===
      normalizeNullableText(record.agentControllerConversationId)
  );
}

function resolveSettingsSource(input: {
  currentBindings: readonly AgentProfileBindingRecord[];
  record: EnabledPrimaryAgentProfileBindingInput;
}): AgentProfileBindingRecord | undefined {
  return input.currentBindings
    .filter(
      (binding) =>
        binding.agentControllerRef === input.record.agentControllerRef
    )
    .sort(
      (left, right) =>
        right.updatedAtMs - left.updatedAtMs ||
        right.configurationRevision - left.configurationRevision ||
        left.bindingId.localeCompare(right.bindingId)
    )[0];
}

function resolveReplacementRecord(input: {
  current: AgentProfileBindingRecord | undefined;
  record: EnabledPrimaryAgentProfileBindingInput;
}): EnabledPrimaryAgentProfileBindingInput {
  const preserveSettings =
    input.current?.agentControllerRef === input.record.agentControllerRef;
  if (!(input.current && preserveSettings)) {
    return input.record;
  }
  return {
    ...input.record,
    agentControllerCollaborationMode:
      input.current.agentControllerCollaborationMode,
    agentControllerPermissionMode: input.current.agentControllerPermissionMode,
    modelId: input.current.modelId,
    openCodePermission: input.current.openCodePermission,
    reasoningLevel: input.current.reasoningLevel,
  };
}

function prepareReconciliationTransition(input: {
  bindingsToDisable: readonly AgentProfileBindingRecord[];
  currentBindings: readonly AgentProfileBindingRecord[];
  db: D1Database;
  noncanonicalDisabledReasonCode: string;
  record: EnabledPrimaryAgentProfileBindingInput;
  replacementRecord: EnabledPrimaryAgentProfileBindingInput;
  reuseCanonical: boolean;
  targetRecord:
    | AgentProfileBindingRecord
    | EnabledPrimaryAgentProfileBindingInput;
}): {
  cleanupBindingStatement: D1PreparedStatement | null;
  disableStatement: D1PreparedStatement | null;
  enableBindingStatement: D1PreparedStatement | null;
  expectedCleanupCount: number;
  insertBindingStatement: D1PreparedStatement | null;
  statements: D1PreparedStatement[];
} {
  const transitionRecord = input.reuseCanonical
    ? input.record
    : input.replacementRecord;
  const insertBindingStatement =
    input.reuseCanonical && input.bindingsToDisable.length === 0
      ? null
      : prepareGuardedDisabledBindingInsert({
          currentBindings: input.currentBindings,
          db: input.db,
          record: transitionRecord,
        });
  const disableStatement = prepareGuardedBindingDisable({
    bindingsToDisable: input.bindingsToDisable,
    currentBindings: input.currentBindings,
    db: input.db,
    disabledAtMs: input.record.updatedAtMs,
    noncanonicalDisabledReasonCode: input.noncanonicalDisabledReasonCode,
    record: input.record,
    transitionBindingId: insertBindingStatement
      ? transitionRecord.bindingId
      : null,
  });
  const enableBindingStatement = input.reuseCanonical
    ? null
    : prepareGuardedBindingEnable({
        db: input.db,
        record: input.replacementRecord,
      });
  const cleanupBindingStatement = insertBindingStatement
    ? prepareIncompleteTransitionCleanup({
        db: input.db,
        record: transitionRecord,
      })
    : null;

  return {
    cleanupBindingStatement,
    disableStatement,
    enableBindingStatement,
    expectedCleanupCount:
      input.reuseCanonical && cleanupBindingStatement ? 1 : 0,
    insertBindingStatement,
    statements: [
      ...(insertBindingStatement ? [insertBindingStatement] : []),
      ...(disableStatement ? [disableStatement] : []),
      ...(enableBindingStatement ? [enableBindingStatement] : []),
      ...(cleanupBindingStatement ? [cleanupBindingStatement] : []),
    ],
  };
}

function prepareGuardedDisabledBindingInsert(input: {
  currentBindings: readonly AgentProfileBindingRecord[];
  db: D1Database;
  record: EnabledPrimaryAgentProfileBindingInput;
}): D1PreparedStatement {
  const admittedRows = input.currentBindings
    .map(() => "(?, ?, ?, ?)")
    .join(", ");
  const admittedBindings = input.currentBindings.flatMap((binding) => [
    binding.bindingId,
    binding.owner.kind,
    binding.owner.id,
    binding.configurationRevision,
  ]);
  const inventoryGuard =
    input.currentBindings.length === 0
      ? `NOT EXISTS (
          SELECT 1
          FROM openMeldDaemon_agent_profile_bindings
          WHERE agent_profile_id = ?
            AND binding_state = 'enabled_primary'
        )`
      : `(
          SELECT COUNT(*)
          FROM openMeldDaemon_agent_profile_bindings AS enabled
          WHERE enabled.agent_profile_id = ?
            AND enabled.binding_state = 'enabled_primary'
        ) = ?
        AND NOT EXISTS (
          SELECT 1
          FROM openMeldDaemon_agent_profile_bindings AS enabled
          LEFT JOIN admitted
            ON admitted.binding_id = enabled.binding_id
            AND admitted.owner_kind = enabled.owner_kind
            AND admitted.owner_id = enabled.owner_id
            AND admitted.configuration_revision = enabled.configuration_revision
          WHERE enabled.agent_profile_id = ?
            AND enabled.binding_state = 'enabled_primary'
            AND admitted.binding_id IS NULL
        )`;
  const admittedCte =
    input.currentBindings.length === 0
      ? ""
      : `WITH admitted (
          binding_id,
          owner_kind,
          owner_id,
          configuration_revision
        ) AS (VALUES ${admittedRows})`;
  return input.db
    .prepare(
      `
        ${admittedCte}
        INSERT INTO openMeldDaemon_agent_profile_bindings (
          binding_id,
          owner_kind,
          owner_id,
          agent_profile_id,
          openmeld_service_runtime_id,
          runtime_kind,
          hosted_runtime_identity_json,
          agent_controller_ref,
          agent_controller_conversation_id,
          binding_state,
          created_at_ms,
          updated_at_ms,
          disabled_at_ms,
          created_by_profile_id,
          reason_code,
          agent_controller_collaboration_mode,
          agent_controller_permission_mode,
          model_id,
          opencode_permission,
          reasoning_level
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disabled_historical', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ${inventoryGuard}
      `
    )
    .bind(
      ...admittedBindings,
      input.record.bindingId,
      input.record.owner.kind,
      input.record.owner.id,
      input.record.agentProfileId,
      input.record.openMeldServiceRuntimeId,
      input.record.runtimeKind ?? "openmeld_service",
      input.record.hostedRuntimeIdentityJson ?? null,
      input.record.agentControllerRef,
      input.record.agentControllerConversationId ?? null,
      input.record.createdAtMs,
      input.record.updatedAtMs,
      input.record.updatedAtMs,
      input.record.createdByProfileId ?? null,
      input.record.reasonCode ?? null,
      input.record.agentControllerCollaborationMode ?? null,
      input.record.agentControllerPermissionMode ?? null,
      input.record.modelId ?? null,
      serializeOpenCodePermission(input.record.openCodePermission),
      input.record.reasoningLevel ?? null,
      input.record.agentProfileId,
      ...(input.currentBindings.length === 0
        ? []
        : [input.currentBindings.length, input.record.agentProfileId])
    );
}

function prepareGuardedBindingEnable(input: {
  db: D1Database;
  record: EnabledPrimaryAgentProfileBindingInput;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          binding_state = 'enabled_primary',
          disabled_at_ms = NULL,
          updated_at_ms = ?
        WHERE binding_id = ?
          AND owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND openmeld_service_runtime_id = ?
          AND runtime_kind = ?
          AND hosted_runtime_identity_json = ?
          AND agent_controller_ref = ?
          AND agent_controller_conversation_id IS NULL
          AND binding_state = 'disabled_historical'
          AND NOT EXISTS (
            SELECT 1
            FROM openMeldDaemon_agent_profile_bindings AS enabled
            WHERE enabled.agent_profile_id = ?
              AND enabled.binding_state = 'enabled_primary'
          )
      `
    )
    .bind(
      input.record.updatedAtMs,
      input.record.bindingId,
      input.record.owner.kind,
      input.record.owner.id,
      input.record.agentProfileId,
      input.record.openMeldServiceRuntimeId,
      input.record.runtimeKind ?? "openmeld_service",
      input.record.hostedRuntimeIdentityJson ?? null,
      input.record.agentControllerRef,
      input.record.agentProfileId
    );
}

function prepareIncompleteTransitionCleanup(input: {
  db: D1Database;
  record: EnabledPrimaryAgentProfileBindingInput;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        DELETE FROM openMeldDaemon_agent_profile_bindings
        WHERE binding_id = ?
          AND owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_state = 'disabled_historical'
          AND created_at_ms = ?
      `
    )
    .bind(
      input.record.bindingId,
      input.record.owner.kind,
      input.record.owner.id,
      input.record.agentProfileId,
      input.record.createdAtMs
    );
}

function prepareGuardedBindingDisable(input: {
  bindingsToDisable: readonly AgentProfileBindingRecord[];
  currentBindings: readonly AgentProfileBindingRecord[];
  db: D1Database;
  disabledAtMs: number;
  noncanonicalDisabledReasonCode: string;
  record: EnabledPrimaryAgentProfileBindingInput;
  transitionBindingId: string | null;
}): D1PreparedStatement | null {
  if (input.bindingsToDisable.length === 0) {
    return null;
  }
  const admittedRows = input.currentBindings
    .map(() => "(?, ?, ?, ?)")
    .join(", ");
  const disabledBindingIds = input.bindingsToDisable.map(() => "?").join(", ");
  const reasonCases = input.bindingsToDisable
    .map(() => "WHEN ? THEN ?")
    .join(" ");
  const admittedBindings = input.currentBindings.flatMap((binding) => [
    binding.bindingId,
    binding.owner.kind,
    binding.owner.id,
    binding.configurationRevision,
  ]);
  const reasonBindings = input.bindingsToDisable.flatMap((binding) => [
    binding.bindingId,
    binding.owner.id === input.record.owner.id
      ? binding.reasonCode
      : input.noncanonicalDisabledReasonCode,
  ]);
  const transitionGuard = input.transitionBindingId
    ? `AND EXISTS (
        SELECT 1
        FROM openMeldDaemon_agent_profile_bindings AS transition_target
        WHERE transition_target.binding_id = ?
          AND transition_target.agent_profile_id = ?
          AND transition_target.binding_state = 'disabled_historical'
      )`
    : "";
  return input.db
    .prepare(
      `
        WITH admitted (
          binding_id,
          owner_kind,
          owner_id,
          configuration_revision
        ) AS (VALUES ${admittedRows})
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          binding_state = 'disabled_historical',
          disabled_at_ms = ?,
          updated_at_ms = ?,
          reason_code = CASE binding_id ${reasonCases} ELSE reason_code END
        WHERE agent_profile_id = ?
          AND binding_state = 'enabled_primary'
          AND binding_id IN (${disabledBindingIds})
          ${transitionGuard}
          AND (
            SELECT COUNT(*)
            FROM openMeldDaemon_agent_profile_bindings AS enabled
            WHERE enabled.agent_profile_id = ?
              AND enabled.binding_state = 'enabled_primary'
          ) = ?
          AND NOT EXISTS (
            SELECT 1
            FROM openMeldDaemon_agent_profile_bindings AS enabled
            LEFT JOIN admitted
              ON admitted.binding_id = enabled.binding_id
              AND admitted.owner_kind = enabled.owner_kind
              AND admitted.owner_id = enabled.owner_id
              AND admitted.configuration_revision = enabled.configuration_revision
            WHERE enabled.agent_profile_id = ?
              AND enabled.binding_state = 'enabled_primary'
              AND admitted.binding_id IS NULL
          )
      `
    )
    .bind(
      ...admittedBindings,
      input.disabledAtMs,
      input.disabledAtMs,
      ...reasonBindings,
      input.record.agentProfileId,
      ...input.bindingsToDisable.map((binding) => binding.bindingId),
      ...(input.transitionBindingId
        ? [input.transitionBindingId, input.record.agentProfileId]
        : []),
      input.record.agentProfileId,
      input.currentBindings.length,
      input.record.agentProfileId
    );
}

function serializeOpenCodePermission(
  value: OpenCodePermissionConfig | null | undefined
): string | null {
  return value ? JSON.stringify(value) : null;
}

function normalizeNullableText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertValidatedBatchBindingTransition(input: {
  cleanupBindingStatement: D1PreparedStatement | null;
  disableStatement: D1PreparedStatement | null;
  enableBindingStatement: D1PreparedStatement | null;
  expectedCleanupCount: number;
  expectedDisabledCount: number;
  insertBindingStatement: D1PreparedStatement | null;
  results: D1Result[];
}): void {
  let resultIndex = 0;
  const insertResult = input.insertBindingStatement
    ? input.results[resultIndex++]
    : null;
  const disableResult = input.disableStatement
    ? input.results[resultIndex++]
    : null;
  const enableResult = input.enableBindingStatement
    ? input.results[resultIndex++]
    : null;
  const cleanupResult = input.cleanupBindingStatement
    ? input.results[resultIndex++]
    : null;
  if (insertResult && getChangedRows(insertResult) !== 1) {
    throw new Error(
      "Remote Center Agent Binding reconciliation used stale admission evidence"
    );
  }
  if (
    disableResult &&
    getChangedRows(disableResult) !== input.expectedDisabledCount
  ) {
    throw new Error(
      "Remote Center Agent Binding reconciliation used stale admission evidence"
    );
  }
  if (enableResult && getChangedRows(enableResult) !== 1) {
    throw new Error(
      "Remote Center Agent Binding reconciliation did not create its hosted target"
    );
  }
  if (
    cleanupResult &&
    getChangedRows(cleanupResult) !== input.expectedCleanupCount
  ) {
    throw new Error(
      "Remote Center Agent Binding reconciliation did not finish its hosted target transition"
    );
  }
  if (resultIndex !== input.results.length) {
    throw new Error(
      "Remote Center Agent Binding reconciliation returned an unexpected result set"
    );
  }
}

function getChangedRows(result: D1Result): number {
  return Number(result.meta?.changes ?? 0);
}
