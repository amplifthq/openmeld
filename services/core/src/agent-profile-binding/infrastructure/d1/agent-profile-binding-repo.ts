import { openCodePermissionConfigSchema } from "@openmeld/schemas";
import type { OpenCodePermissionConfig } from "@openmeld/schemas/types";
import {
  type AgentActivitySessionResumeEligibility,
  buildAgentActivitySessionResumeEligibilityQuery,
  canResumeAgentActivitySessionSelection,
} from "../../../agent-activity/activity-session-inventory-repository";
import type {
  AgentProfileBindingAgentControllerCollaborationModePatch,
  AgentProfileBindingAgentControllerPermissionModePatch,
  AgentProfileBindingCommandStore,
  AgentProfileBindingModelSelectionPatch,
  AgentProfileBindingOpenCodePermissionPatch,
  AgentProfileBindingSettingsWriteResult,
} from "../../application/agent-profile-binding-command-service";
import type { AgentProfileBindingLookupStore } from "../../application/agent-profile-binding-lookup-service";

export type AgentProfileBindingOwner = {
  id: string;
  kind: "owner_account";
};

export type EnabledPrimaryAgentProfileBindingInput = {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  agentControllerConversationId?: string | null;
  createdAtMs: number;
  createdByProfileId?: string | null;
  owner: AgentProfileBindingOwner;
  reasonCode?: string | null;
  openMeldServiceRuntimeId: string;
  runtimeKind?: "openmeld_service" | "hosted_center_agent";
  hostedRuntimeIdentityJson?: string | null;
  agentControllerCollaborationMode?: string | null;
  agentControllerPermissionMode?: string | null;
  modelId?: string | null;
  openCodePermission?: OpenCodePermissionConfig | null;
  reasoningLevel?: string | null;
  updatedAtMs: number;
};

export type AgentProfileBindingRecord =
  EnabledPrimaryAgentProfileBindingInput & {
    bindingState: "enabled_primary" | "disabled_historical";
    configurationRevision: number;
    disabledAtMs: number | null;
  };

export type AcquireAgentProfileExecutionTargetMutationAdmission = (input: {
  currentBinding: AgentProfileBindingRecord | null;
}) => Promise<void>;

export type EnsurePrimaryAgentProfileBindingResult =
  | {
      binding: AgentProfileBindingRecord;
      outcome: "created" | "reused" | "reconnected";
      status: "accepted";
    }
  | {
      existingBinding?: AgentProfileBindingRecord;
      reason:
        | "controller_conversation_conflict"
        | "primary_conflict"
        | "session_resume_unavailable";
      status: "rejected";
    };

type AgentProfileBindingRow = {
  agent_profile_id: string;
  binding_id: string;
  binding_state: "enabled_primary" | "disabled_historical";
  agent_controller_conversation_id: string | null;
  agent_controller_ref: string;
  created_at_ms: number;
  created_by_profile_id: string | null;
  configuration_revision: number;
  disabled_at_ms: number | null;
  owner_id: string;
  owner_kind: "owner_account";
  reason_code: string | null;
  openmeld_service_runtime_id: string;
  runtime_kind: "openmeld_service" | "hosted_center_agent" | null;
  hosted_runtime_identity_json: string | null;
  agent_controller_collaboration_mode: string | null;
  agent_controller_permission_mode: string | null;
  model_id: string | null;
  opencode_permission: string | null;
  reasoning_level: string | null;
  updated_at_ms: number;
};

export function createD1AgentProfileBindingCommandStore(input: {
  acquireExecutionTargetMutationAdmission?: AcquireAgentProfileExecutionTargetMutationAdmission;
  db: D1Database;
  readNowMs?: () => number;
  sessionInventoryEligibility?: Omit<
    AgentActivitySessionResumeEligibility,
    "nowMs"
  >;
}): AgentProfileBindingCommandStore {
  const resolveSessionInventoryEligibility = () =>
    input.sessionInventoryEligibility
      ? {
          ...input.sessionInventoryEligibility,
          nowMs: (input.readNowMs ?? Date.now)(),
        }
      : undefined;
  return {
    readPrimaryBinding: ({ agentProfileId, owner }) =>
      readPrimaryAgentProfileBindingRecord({
        agentProfileId,
        db: input.db,
        owner,
      }),
    ensurePrimaryBinding: ({
      agentControllerCollaborationModePatch,
      agentControllerPermissionModePatch,
      modelSelectionPatch,
      openCodePermissionPatch,
      record,
    }) =>
      ensurePrimaryAgentProfileBindingRecord({
        ...(agentControllerCollaborationModePatch
          ? { agentControllerCollaborationModePatch }
          : {}),
        ...(agentControllerPermissionModePatch
          ? { agentControllerPermissionModePatch }
          : {}),
        db: input.db,
        ...(modelSelectionPatch ? { modelSelectionPatch } : {}),
        ...(openCodePermissionPatch ? { openCodePermissionPatch } : {}),
        record,
        sessionInventoryEligibility: resolveSessionInventoryEligibility(),
      }),
    reconnectPrimaryBinding: ({
      agentControllerCollaborationModePatch,
      agentControllerPermissionModePatch,
      modelSelectionPatch,
      openCodePermissionPatch,
      record,
    }) =>
      reconnectPrimaryAgentProfileBindingRecord({
        acquireExecutionTargetMutationAdmission:
          input.acquireExecutionTargetMutationAdmission ??
          rejectMissingExecutionTargetMutationAdmission,
        ...(agentControllerCollaborationModePatch
          ? { agentControllerCollaborationModePatch }
          : {}),
        ...(agentControllerPermissionModePatch
          ? { agentControllerPermissionModePatch }
          : {}),
        db: input.db,
        ...(modelSelectionPatch ? { modelSelectionPatch } : {}),
        ...(openCodePermissionPatch ? { openCodePermissionPatch } : {}),
        record,
        sessionInventoryEligibility: resolveSessionInventoryEligibility(),
      }),
    updatePrimaryBindingAgentControllerCollaborationMode: ({
      agentProfileId,
      agentControllerCollaborationModePatch,
      owner,
      updatedAtMs,
    }) =>
      updatePrimaryAgentProfileBindingAgentControllerCollaborationModeRecord({
        agentProfileId,
        agentControllerCollaborationModePatch,
        db: input.db,
        owner,
        updatedAtMs,
      }),
    updatePrimaryBindingAgentControllerPermissionMode: ({
      agentProfileId,
      agentControllerPermissionModePatch,
      owner,
      updatedAtMs,
    }) =>
      updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord({
        agentProfileId,
        agentControllerPermissionModePatch,
        db: input.db,
        owner,
        updatedAtMs,
      }),
    updatePrimaryBindingModelSelection: ({
      agentProfileId,
      modelSelectionPatch,
      owner,
      updatedAtMs,
    }) =>
      updatePrimaryAgentProfileBindingModelSelectionRecord({
        agentProfileId,
        db: input.db,
        modelSelectionPatch,
        owner,
        updatedAtMs,
      }),
    updatePrimaryBindingOpenCodePermission: ({
      agentProfileId,
      openCodePermissionPatch,
      owner,
      updatedAtMs,
    }) =>
      updatePrimaryAgentProfileBindingOpenCodePermissionRecord({
        agentProfileId,
        db: input.db,
        openCodePermissionPatch,
        owner,
        updatedAtMs,
      }),
  };
}

export function createD1AgentProfileBindingLookupStore(input: {
  db: D1Database;
}): AgentProfileBindingLookupStore {
  return {
    readPrimaryBinding: ({ agentProfileId, owner }) =>
      readPrimaryAgentProfileBindingRecord({
        agentProfileId,
        db: input.db,
        owner,
      }),
  };
}

function isSameEnabledPrimaryBindingTarget(input: {
  binding: AgentProfileBindingRecord;
  record: EnabledPrimaryAgentProfileBindingInput;
}): boolean {
  return (
    input.binding.openMeldServiceRuntimeId ===
      input.record.openMeldServiceRuntimeId &&
    input.binding.agentControllerRef === input.record.agentControllerRef &&
    normalizeNullableText(input.binding.agentControllerConversationId) ===
      normalizeNullableText(input.record.agentControllerConversationId)
  );
}

type AgentProfileBindingWriteRequest = {
  agentControllerCollaborationModePatch?: AgentProfileBindingAgentControllerCollaborationModePatch;
  agentControllerPermissionModePatch?: AgentProfileBindingAgentControllerPermissionModePatch;
  db: D1Database;
  modelSelectionPatch?: AgentProfileBindingModelSelectionPatch;
  openCodePermissionPatch?: AgentProfileBindingOpenCodePermissionPatch;
  record: EnabledPrimaryAgentProfileBindingInput;
  sessionInventoryEligibility?: AgentActivitySessionResumeEligibility;
};

type AgentProfileBindingReconnectRequest = AgentProfileBindingWriteRequest & {
  acquireExecutionTargetMutationAdmission: AcquireAgentProfileExecutionTargetMutationAdmission;
};

const MAX_AGENT_PROFILE_BINDING_RECONNECT_ATTEMPTS = 3;
export const MAX_ENABLED_PRIMARY_BINDING_OWNERS_PER_AGENT_PROFILE = 16;

export class AgentProfileBindingOwnerInventoryLimitError extends Error {
  readonly agentProfileId: string;

  constructor(agentProfileId: string) {
    super(
      `Agent Profile ${agentProfileId} has more enabled Binding owners than can be reconciled safely`
    );
    this.name = "AgentProfileBindingOwnerInventoryLimitError";
    this.agentProfileId = agentProfileId;
  }
}

export async function ensurePrimaryAgentProfileBindingRecord(
  input: AgentProfileBindingWriteRequest
): Promise<EnsurePrimaryAgentProfileBindingResult> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.record.agentProfileId,
    db: input.db,
    owner: input.record.owner,
  });
  if (
    current &&
    isSameEnabledPrimaryBindingTarget({
      binding: current,
      record: input.record,
    })
  ) {
    if (!(await isSessionInventoryEligibilityCurrent(input))) {
      return sessionResumeUnavailableResult();
    }
    const updated = await maybeUpdatePrimaryAgentProfileBindingMetadata({
      agentControllerCollaborationModePatch:
        input.agentControllerCollaborationModePatch,
      agentControllerPermissionModePatch:
        input.agentControllerPermissionModePatch,
      current,
      db: input.db,
      modelSelectionPatch: input.modelSelectionPatch,
      openCodePermissionPatch: input.openCodePermissionPatch,
      record: input.record,
    });
    if (updated) {
      return {
        binding: updated,
        outcome: "reused",
        status: "accepted",
      };
    }
    return {
      binding: current,
      outcome: "reused",
      status: "accepted",
    };
  }

  const conversationConflict = await readControllerConversationConflict({
    db: input.db,
    record: input.record,
  });
  if (conversationConflict) {
    return conversationConflict;
  }

  const agentControllerCollaborationMode = normalizeNullableText(
    input.record.agentControllerCollaborationMode
  );
  const sessionEligibility = buildSessionInventoryEligibilityClause(input);
  const insertResult = await input.db
    .prepare(
      `
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
	        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled_primary', ?, ?, null, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM openMeldDaemon_agent_profile_bindings existing
          WHERE existing.owner_kind = ?
            AND existing.owner_id = ?
            AND existing.agent_controller_ref = ?
            AND existing.agent_controller_conversation_id = ?
            AND existing.binding_state = 'enabled_primary'
            AND existing.agent_profile_id <> ?
        )
        ${sessionEligibility.sql}
        ON CONFLICT(owner_kind, owner_id, agent_profile_id)
          WHERE binding_state = 'enabled_primary'
          DO NOTHING
      `
    )
    .bind(
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
      input.record.createdByProfileId ?? null,
      input.record.reasonCode ?? null,
      agentControllerCollaborationMode,
      input.record.agentControllerPermissionMode ?? null,
      input.record.modelId ?? null,
      serializeOpenCodePermission(input.record.openCodePermission),
      input.record.reasoningLevel ?? null,
      input.record.owner.kind,
      input.record.owner.id,
      input.record.agentControllerRef,
      input.record.agentControllerConversationId ?? null,
      input.record.agentProfileId,
      ...sessionEligibility.bindings
    )
    .run();

  return await resolveEnsuredPrimaryAgentProfileBinding({
    current,
    insertResult,
    request: input,
  });
}

export async function reconnectPrimaryAgentProfileBindingRecord(
  input: AgentProfileBindingReconnectRequest
): Promise<EnsurePrimaryAgentProfileBindingResult> {
  for (
    let attempt = 0;
    attempt < MAX_AGENT_PROFILE_BINDING_RECONNECT_ATTEMPTS;
    attempt += 1
  ) {
    const attemptResult =
      await reconnectPrimaryAgentProfileBindingRecordAttempt(input);
    if (attemptResult.status === "completed") {
      return attemptResult.result;
    }
  }
  throw new Error(
    "Agent Profile Binding reconnect could not serialize concurrent Binding changes"
  );
}

async function reconnectPrimaryAgentProfileBindingRecordAttempt(
  input: AgentProfileBindingReconnectRequest
): Promise<
  | { result: EnsurePrimaryAgentProfileBindingResult; status: "completed" }
  | { status: "retry" }
> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.record.agentProfileId,
    db: input.db,
    owner: input.record.owner,
  });
  if (current) {
    const reused = await reuseMatchingReconnectTarget({ current, input });
    if (reused) {
      return { result: reused, status: "completed" };
    }
  }

  await input.acquireExecutionTargetMutationAdmission({
    currentBinding: current,
  });

  if (!current) {
    const ensured = await ensurePrimaryAgentProfileBindingRecord(input);
    return ensured.status === "rejected" &&
      ensured.reason === "primary_conflict"
      ? { status: "retry" }
      : { result: ensured, status: "completed" };
  }

  const conversationConflict = await readControllerConversationConflict({
    db: input.db,
    record: input.record,
  });
  if (conversationConflict) {
    return { result: conversationConflict, status: "completed" };
  }

  const sessionEligibility = buildSessionInventoryEligibilityClause(input);
  const controllerSettings = resolveReconnectControllerSettings({
    current,
    input,
  });
  const writeResults = await input.db.batch([
    input.db
      .prepare(
        `
          UPDATE openMeldDaemon_agent_profile_bindings
          SET
            binding_state = 'disabled_historical',
            disabled_at_ms = ?,
            updated_at_ms = ?
          WHERE owner_kind = ?
            AND owner_id = ?
            AND agent_profile_id = ?
            AND binding_id = ?
            AND binding_state = 'enabled_primary'
            AND configuration_revision = ?
            AND NOT EXISTS (
              SELECT 1
              FROM openMeldDaemon_agent_profile_bindings existing
              WHERE existing.owner_kind = ?
                AND existing.owner_id = ?
                AND existing.agent_controller_ref = ?
                AND existing.agent_controller_conversation_id = ?
                AND existing.binding_state = 'enabled_primary'
                AND existing.agent_profile_id <> ?
            )
            ${sessionEligibility.sql}
        `
      )
      .bind(
        input.record.updatedAtMs,
        input.record.updatedAtMs,
        input.record.owner.kind,
        input.record.owner.id,
        input.record.agentProfileId,
        current.bindingId,
        current.configurationRevision,
        input.record.owner.kind,
        input.record.owner.id,
        input.record.agentControllerRef,
        input.record.agentControllerConversationId ?? null,
        input.record.agentProfileId,
        ...sessionEligibility.bindings
      ),
    input.db
      .prepare(
        `
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
	          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled_primary', ?, ?, null, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1
            FROM openMeldDaemon_agent_profile_bindings existing
            WHERE existing.owner_kind = ?
              AND existing.owner_id = ?
              AND existing.agent_controller_ref = ?
              AND existing.agent_controller_conversation_id = ?
              AND existing.binding_state = 'enabled_primary'
              AND existing.agent_profile_id <> ?
          )
          ${sessionEligibility.sql}
          ON CONFLICT(owner_kind, owner_id, agent_profile_id)
            WHERE binding_state = 'enabled_primary'
            DO NOTHING
        `
      )
      .bind(
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
        input.record.createdByProfileId ?? null,
        input.record.reasonCode ?? null,
        controllerSettings.agentControllerCollaborationMode,
        controllerSettings.agentControllerPermissionMode,
        controllerSettings.modelId,
        serializeOpenCodePermission(controllerSettings.openCodePermission),
        controllerSettings.reasoningLevel,
        input.record.owner.kind,
        input.record.owner.id,
        input.record.agentControllerRef,
        input.record.agentControllerConversationId ?? null,
        input.record.agentProfileId,
        ...sessionEligibility.bindings
      ),
  ]);

  if (
    await shouldRetryNoopReconnect({
      current,
      input,
      writeResults,
    })
  ) {
    return { status: "retry" };
  }

  return {
    result: await resolveReconnectedPrimaryAgentProfileBinding({
      ...input,
      writeResults,
    }),
    status: "completed",
  };
}

function rejectMissingExecutionTargetMutationAdmission(): Promise<never> {
  return Promise.reject(
    new Error(
      "Agent Profile Binding reconnect requires execution-target mutation admission"
    )
  );
}

async function shouldRetryNoopReconnect(input: {
  current: AgentProfileBindingRecord;
  input: AgentProfileBindingWriteRequest;
  writeResults: D1Result[];
}): Promise<boolean> {
  if (input.writeResults.some((result) => getChangedRows(result) > 0)) {
    return false;
  }
  const latest = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.input.record.agentProfileId,
    db: input.input.db,
    owner: input.input.record.owner,
  });
  return (
    latest?.bindingId !== input.current.bindingId ||
    latest.configurationRevision !== input.current.configurationRevision
  );
}

async function reuseMatchingReconnectTarget(input: {
  current: AgentProfileBindingRecord;
  input: AgentProfileBindingWriteRequest;
}): Promise<EnsurePrimaryAgentProfileBindingResult | null> {
  if (
    !isSameEnabledPrimaryBindingTarget({
      binding: input.current,
      record: input.input.record,
    })
  ) {
    return null;
  }
  if (!(await isSessionInventoryEligibilityCurrent(input.input))) {
    return sessionResumeUnavailableResult();
  }
  const updated = await maybeUpdatePrimaryAgentProfileBindingMetadata({
    agentControllerCollaborationModePatch:
      input.input.agentControllerCollaborationModePatch,
    agentControllerPermissionModePatch:
      input.input.agentControllerPermissionModePatch,
    current: input.current,
    db: input.input.db,
    modelSelectionPatch: input.input.modelSelectionPatch,
    openCodePermissionPatch: input.input.openCodePermissionPatch,
    record: input.input.record,
  });
  return {
    binding: updated ?? input.current,
    outcome: "reused",
    status: "accepted",
  };
}

function resolveReconnectControllerSettings(input: {
  current: AgentProfileBindingRecord;
  input: AgentProfileBindingWriteRequest;
}): Pick<
  EnabledPrimaryAgentProfileBindingInput,
  | "agentControllerCollaborationMode"
  | "agentControllerPermissionMode"
  | "modelId"
  | "openCodePermission"
  | "reasoningLevel"
> {
  const preserveCurrent =
    input.current.agentControllerRef === input.input.record.agentControllerRef;
  const fallback = preserveCurrent ? input.current : input.input.record;
  const modelSelection = input.input.modelSelectionPatch;
  const openCodePermission = input.input.openCodePermissionPatch;
  return {
    agentControllerCollaborationMode:
      input.input.agentControllerCollaborationModePatch
        ?.agentControllerCollaborationMode ??
      fallback.agentControllerCollaborationMode ??
      null,
    agentControllerPermissionMode:
      input.input.agentControllerPermissionModePatch
        ?.agentControllerPermissionMode ??
      fallback.agentControllerPermissionMode ??
      null,
    modelId: modelSelection
      ? modelSelection.modelId
      : (fallback.modelId ?? null),
    openCodePermission: openCodePermission
      ? openCodePermission.openCodePermission
      : (fallback.openCodePermission ?? null),
    reasoningLevel: modelSelection
      ? modelSelection.reasoningLevel
      : (fallback.reasoningLevel ?? null),
  };
}

async function resolveEnsuredPrimaryAgentProfileBinding(context: {
  current: AgentProfileBindingRecord | null;
  insertResult: D1Result;
  request: AgentProfileBindingWriteRequest;
}): Promise<EnsurePrimaryAgentProfileBindingResult> {
  const binding =
    context.current ??
    (await readPrimaryAgentProfileBindingRecord({
      agentProfileId: context.request.record.agentProfileId,
      db: context.request.db,
      owner: context.request.record.owner,
    }));
  if (!binding) {
    return await rejectControllerConversationConflictOrThrow({
      errorMessage: "Agent Profile Binding write did not produce a row",
      request: context.request,
    });
  }
  if (getChangedRows(context.insertResult) > 0) {
    return { binding, outcome: "created", status: "accepted" };
  }
  if (
    !isSameEnabledPrimaryBindingTarget({
      binding,
      record: context.request.record,
    })
  ) {
    return {
      existingBinding: binding,
      reason: "primary_conflict",
      status: "rejected",
    };
  }
  if (!(await isSessionInventoryEligibilityCurrent(context.request))) {
    return sessionResumeUnavailableResult();
  }
  const updated = await maybeUpdatePrimaryAgentProfileBindingMetadata({
    agentControllerCollaborationModePatch:
      context.request.agentControllerCollaborationModePatch,
    agentControllerPermissionModePatch:
      context.request.agentControllerPermissionModePatch,
    current: binding,
    db: context.request.db,
    modelSelectionPatch: context.request.modelSelectionPatch,
    openCodePermissionPatch: context.request.openCodePermissionPatch,
    record: context.request.record,
  });
  return {
    binding: updated ?? binding,
    outcome: "reused",
    status: "accepted",
  };
}

async function resolveReconnectedPrimaryAgentProfileBinding(
  input: AgentProfileBindingWriteRequest & { writeResults: D1Result[] }
): Promise<EnsurePrimaryAgentProfileBindingResult> {
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.record.agentProfileId,
    db: input.db,
    owner: input.record.owner,
  });
  if (!binding) {
    return await rejectControllerConversationConflictOrThrow({
      errorMessage: "Agent Profile Binding reconnect did not produce a row",
      request: input,
    });
  }
  if (!isSameEnabledPrimaryBindingTarget({ binding, record: input.record })) {
    const conversationConflict = await readControllerConversationConflict({
      db: input.db,
      record: input.record,
    });
    if (conversationConflict) {
      return conversationConflict;
    }
    if (
      input.writeResults.every((result) => getChangedRows(result) === 0) &&
      !(await isSessionInventoryEligibilityCurrent(input))
    ) {
      return sessionResumeUnavailableResult();
    }
    return {
      existingBinding: binding,
      reason: "primary_conflict",
      status: "rejected",
    };
  }
  return { binding, outcome: "reconnected", status: "accepted" };
}

async function rejectControllerConversationConflictOrThrow(input: {
  errorMessage: string;
  request: AgentProfileBindingWriteRequest;
}): Promise<
  Extract<EnsurePrimaryAgentProfileBindingResult, { status: "rejected" }>
> {
  const conversationConflict = await readControllerConversationConflict({
    db: input.request.db,
    record: input.request.record,
  });
  if (conversationConflict) {
    return conversationConflict;
  }
  if (!(await isSessionInventoryEligibilityCurrent(input.request))) {
    return sessionResumeUnavailableResult();
  }
  throw new Error(input.errorMessage);
}

function buildSessionInventoryEligibilityClause(
  input: AgentProfileBindingWriteRequest
): { bindings: unknown[]; sql: string } {
  if (!input.sessionInventoryEligibility) {
    return { bindings: [], sql: "" };
  }
  const query = buildAgentActivitySessionResumeEligibilityQuery(
    input.sessionInventoryEligibility
  );
  return query
    ? { bindings: query.bindings, sql: `AND EXISTS (${query.sql})` }
    : { bindings: [], sql: "AND 0 = 1" };
}

async function isSessionInventoryEligibilityCurrent(
  input: AgentProfileBindingWriteRequest
): Promise<boolean> {
  return input.sessionInventoryEligibility
    ? await canResumeAgentActivitySessionSelection({
        ...input.sessionInventoryEligibility,
        db: input.db,
      })
    : true;
}

function sessionResumeUnavailableResult(): Extract<
  EnsurePrimaryAgentProfileBindingResult,
  { status: "rejected" }
> {
  return {
    reason: "session_resume_unavailable",
    status: "rejected",
  };
}

async function readControllerConversationConflict(input: {
  db: D1Database;
  record: EnabledPrimaryAgentProfileBindingInput;
}): Promise<Extract<
  EnsurePrimaryAgentProfileBindingResult,
  { status: "rejected" }
> | null> {
  const existingBinding =
    await readPrimaryAgentProfileBindingRecordByControllerConversation({
      agentControllerConversationId:
        input.record.agentControllerConversationId ?? null,
      agentControllerRef: input.record.agentControllerRef,
      db: input.db,
      excludeAgentProfileId: input.record.agentProfileId,
      owner: input.record.owner,
    });
  return existingBinding
    ? {
        existingBinding,
        reason: "controller_conversation_conflict",
        status: "rejected",
      }
    : null;
}

export async function readPrimaryAgentProfileBindingRecord(input: {
  agentProfileId: string;
  db: D1Database;
  owner: AgentProfileBindingOwner;
}): Promise<AgentProfileBindingRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
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
	          configuration_revision,
	          model_id,
	          opencode_permission,
	          reasoning_level
	        FROM openMeldDaemon_agent_profile_bindings
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_state = 'enabled_primary'
        LIMIT 1
      `
    )
    .bind(input.owner.kind, input.owner.id, input.agentProfileId)
    .first<AgentProfileBindingRow>();

  return row ? mapAgentProfileBindingRow(row) : null;
}

export async function listEnabledPrimaryAgentProfileBindingRecordsForProfile(input: {
  agentProfileId: string;
  db: D1Database;
}): Promise<AgentProfileBindingRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
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
	          configuration_revision,
	          model_id,
	          opencode_permission,
	          reasoning_level
	        FROM openMeldDaemon_agent_profile_bindings
        WHERE agent_profile_id = ?
          AND binding_state = 'enabled_primary'
        ORDER BY owner_kind ASC, owner_id ASC, binding_id ASC
        LIMIT ?
      `
    )
    .bind(
      input.agentProfileId,
      MAX_ENABLED_PRIMARY_BINDING_OWNERS_PER_AGENT_PROFILE + 1
    )
    .all<AgentProfileBindingRow>();

  const rows = result.results ?? [];
  if (rows.length > MAX_ENABLED_PRIMARY_BINDING_OWNERS_PER_AGENT_PROFILE) {
    throw new AgentProfileBindingOwnerInventoryLimitError(input.agentProfileId);
  }
  return rows.map((row) => mapAgentProfileBindingRow(row));
}

// One query returns every enabled-primary binding for the owner; the
// expected-routes projection scopes the result to one runtime afterwards.
// Served by the partial unique index on
// (owner_kind, owner_id, agent_profile_id) WHERE binding_state =
// 'enabled_primary' (migration 0048).
export async function listEnabledPrimaryAgentProfileBindingRecords(input: {
  db: D1Database;
  owner: AgentProfileBindingOwner;
}): Promise<AgentProfileBindingRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
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
	          configuration_revision,
	          model_id,
	          opencode_permission,
	          reasoning_level
	        FROM openMeldDaemon_agent_profile_bindings
        WHERE owner_kind = ?
          AND owner_id = ?
          AND binding_state = 'enabled_primary'
        ORDER BY agent_profile_id ASC
      `
    )
    .bind(input.owner.kind, input.owner.id)
    .all<AgentProfileBindingRow>();

  return (result.results ?? []).map((row) => mapAgentProfileBindingRow(row));
}

export async function listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController(input: {
  agentControllerRef: string;
  db: D1Database;
  openMeldServiceRuntimeId: string;
  owner: AgentProfileBindingOwner;
}): Promise<AgentProfileBindingRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
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
	          configuration_revision,
	          model_id,
	          opencode_permission,
	          reasoning_level
	        FROM openMeldDaemon_agent_profile_bindings
        WHERE openmeld_service_runtime_id = ?
          AND agent_controller_ref = ?
          AND owner_kind = ?
          AND owner_id = ?
          AND runtime_kind = 'openmeld_service'
          AND binding_state = 'enabled_primary'
        ORDER BY agent_profile_id ASC
      `
    )
    .bind(
      input.openMeldServiceRuntimeId,
      input.agentControllerRef,
      input.owner.kind,
      input.owner.id
    )
    .all<AgentProfileBindingRow>();

  return (result.results ?? []).map((row) => mapAgentProfileBindingRow(row));
}

export async function disablePrimaryAgentProfileBindingRecord(input: {
  agentProfileId: string;
  db: D1Database;
  disabledAtMs: number;
  owner: AgentProfileBindingOwner;
  reasonCode?: string | null;
}): Promise<AgentProfileBindingRecord | null> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!current) {
    return null;
  }

  const disabledReasonCode = input.reasonCode ?? current.reasonCode;
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          binding_state = 'disabled_historical',
          disabled_at_ms = ?,
          updated_at_ms = ?,
          reason_code = ?
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_id = ?
          AND binding_state = 'enabled_primary'
      `
    )
    .bind(
      input.disabledAtMs,
      input.disabledAtMs,
      disabledReasonCode,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      current.bindingId
    )
    .run();

  return {
    ...current,
    bindingState: "disabled_historical",
    disabledAtMs: input.disabledAtMs,
    reasonCode: disabledReasonCode,
    updatedAtMs: input.disabledAtMs,
  };
}

export async function readPrimaryAgentProfileBindingRecordByControllerConversation(input: {
  agentControllerConversationId: string | null | undefined;
  agentControllerRef: string;
  db: D1Database;
  excludeAgentProfileId?: string | null;
  owner: AgentProfileBindingOwner;
}): Promise<AgentProfileBindingRecord | null> {
  const agentControllerConversationId = normalizeNullableText(
    input.agentControllerConversationId
  );
  if (!agentControllerConversationId) {
    return null;
  }

  const row = await input.db
    .prepare(
      `
        SELECT
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
	          configuration_revision,
	          model_id,
	          opencode_permission,
	          reasoning_level
	        FROM openMeldDaemon_agent_profile_bindings
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_controller_ref = ?
          AND agent_controller_conversation_id = ?
          AND agent_profile_id != ?
          AND binding_state = 'enabled_primary'
        ORDER BY updated_at_ms DESC, created_at_ms DESC, binding_id DESC
        LIMIT 1
      `
    )
    .bind(
      input.owner.kind,
      input.owner.id,
      input.agentControllerRef,
      agentControllerConversationId,
      input.excludeAgentProfileId ?? ""
    )
    .first<AgentProfileBindingRow>();

  return row ? mapAgentProfileBindingRow(row) : null;
}

export async function updatePrimaryAgentProfileBindingConversationId(input: {
  agentControllerConversationId: string | null;
  agentProfileId: string;
  bindingId: string;
  db: D1Database;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          agent_controller_conversation_id = ?,
          updated_at_ms = ?
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_id = ?
          AND binding_state = 'enabled_primary'
      `
    )
    .bind(
      input.agentControllerConversationId,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId
    )
    .run();

  return await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
}

export async function updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord(input: {
  agentProfileId: string;
  agentControllerPermissionModePatch: AgentProfileBindingAgentControllerPermissionModePatch;
  db: D1Database;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteResult> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!current) {
    return { binding: null, status: "missing" };
  }
  if (
    agentControllerPermissionModeEqual(
      current,
      input.agentControllerPermissionModePatch
    )
  ) {
    return { binding: current, status: "unchanged" };
  }
  const attempt =
    await updatePrimaryAgentProfileBindingAgentControllerPermissionMode({
      agentProfileId: input.agentProfileId,
      agentControllerPermissionMode:
        input.agentControllerPermissionModePatch.agentControllerPermissionMode,
      bindingId: current.bindingId,
      db: input.db,
      expectedConfigurationRevision: current.configurationRevision,
      owner: input.owner,
      updatedAtMs: input.updatedAtMs,
    });
  return resolveAgentProfileBindingSettingsWriteResult({
    attempt,
    matches: (binding) =>
      agentControllerPermissionModeEqual(
        binding,
        input.agentControllerPermissionModePatch
      ),
  });
}

export async function updatePrimaryAgentProfileBindingAgentControllerCollaborationModeRecord(input: {
  agentProfileId: string;
  agentControllerCollaborationModePatch: AgentProfileBindingAgentControllerCollaborationModePatch;
  db: D1Database;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteResult> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!current) {
    return { binding: null, status: "missing" };
  }
  if (
    agentControllerCollaborationModeEqual(
      current,
      input.agentControllerCollaborationModePatch
    )
  ) {
    return { binding: current, status: "unchanged" };
  }
  const attempt =
    await updatePrimaryAgentProfileBindingAgentControllerCollaborationMode({
      agentProfileId: input.agentProfileId,
      agentControllerCollaborationMode:
        input.agentControllerCollaborationModePatch
          .agentControllerCollaborationMode,
      bindingId: current.bindingId,
      db: input.db,
      expectedConfigurationRevision: current.configurationRevision,
      owner: input.owner,
      updatedAtMs: input.updatedAtMs,
    });
  return resolveAgentProfileBindingSettingsWriteResult({
    attempt,
    matches: (binding) =>
      agentControllerCollaborationModeEqual(
        binding,
        input.agentControllerCollaborationModePatch
      ),
  });
}

export async function updatePrimaryAgentProfileBindingModelSelectionRecord(input: {
  agentProfileId: string;
  db: D1Database;
  modelSelectionPatch: AgentProfileBindingModelSelectionPatch;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteResult> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!current) {
    return { binding: null, status: "missing" };
  }
  if (modelSelectionEqual(current, input.modelSelectionPatch)) {
    return { binding: current, status: "unchanged" };
  }
  const attempt = await updatePrimaryAgentProfileBindingModelSelection({
    agentProfileId: input.agentProfileId,
    bindingId: current.bindingId,
    db: input.db,
    expectedConfigurationRevision: current.configurationRevision,
    modelId: input.modelSelectionPatch.modelId,
    owner: input.owner,
    reasoningLevel: input.modelSelectionPatch.reasoningLevel,
    updatedAtMs: input.updatedAtMs,
  });
  return resolveAgentProfileBindingSettingsWriteResult({
    attempt,
    matches: (binding) =>
      modelSelectionEqual(binding, input.modelSelectionPatch),
  });
}

export type CompareAndSetAgentProfileBindingModelSelectionResult =
  | {
      binding: AgentProfileBindingRecord;
      status: "conflict" | "unchanged" | "updated";
    }
  | {
      binding: null;
      status: "not_found";
    };

export async function compareAndSetPrimaryAgentProfileBindingModelSelectionRecord(input: {
  agentProfileId: string;
  db: D1Database;
  expectedConfigurationRevision: number;
  modelSelectionPatch: AgentProfileBindingModelSelectionPatch;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<CompareAndSetAgentProfileBindingModelSelectionResult> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!current) {
    return { binding: null, status: "not_found" };
  }
  if (current.configurationRevision !== input.expectedConfigurationRevision) {
    return { binding: current, status: "conflict" };
  }
  if (modelSelectionEqual(current, input.modelSelectionPatch)) {
    return { binding: current, status: "unchanged" };
  }

  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          model_id = ?,
          reasoning_level = ?,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = ?
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_id = ?
          AND binding_state = 'enabled_primary'
          AND configuration_revision = ?
      `
    )
    .bind(
      input.modelSelectionPatch.modelId,
      input.modelSelectionPatch.modelId
        ? input.modelSelectionPatch.reasoningLevel
        : null,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      current.bindingId,
      input.expectedConfigurationRevision
    )
    .run();

  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!binding) {
    return { binding: null, status: "not_found" };
  }
  return result.meta.changes === 1
    ? { binding, status: "updated" }
    : { binding, status: "conflict" };
}

export async function updatePrimaryAgentProfileBindingOpenCodePermissionRecord(input: {
  agentProfileId: string;
  db: D1Database;
  openCodePermissionPatch: AgentProfileBindingOpenCodePermissionPatch;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteResult> {
  const current = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!current) {
    return { binding: null, status: "missing" };
  }
  if (openCodePermissionEqual(current, input.openCodePermissionPatch)) {
    return { binding: current, status: "unchanged" };
  }
  const attempt = await updatePrimaryAgentProfileBindingOpenCodePermission({
    agentProfileId: input.agentProfileId,
    bindingId: current.bindingId,
    db: input.db,
    expectedConfigurationRevision: current.configurationRevision,
    openCodePermission: input.openCodePermissionPatch.openCodePermission,
    owner: input.owner,
    updatedAtMs: input.updatedAtMs,
  });
  return resolveAgentProfileBindingSettingsWriteResult({
    attempt,
    matches: (binding) =>
      openCodePermissionEqual(binding, input.openCodePermissionPatch),
  });
}

async function maybeUpdatePrimaryAgentProfileBindingMetadata(input: {
  agentControllerCollaborationModePatch?: AgentProfileBindingAgentControllerCollaborationModePatch;
  agentControllerPermissionModePatch?: AgentProfileBindingAgentControllerPermissionModePatch;
  current: AgentProfileBindingRecord;
  db: D1Database;
  modelSelectionPatch?: AgentProfileBindingModelSelectionPatch;
  openCodePermissionPatch?: AgentProfileBindingOpenCodePermissionPatch;
  record: EnabledPrimaryAgentProfileBindingInput;
}): Promise<AgentProfileBindingRecord | null> {
  let current = input.current;
  let changed = false;

  if (
    input.agentControllerCollaborationModePatch &&
    !agentControllerCollaborationModeEqual(
      current,
      input.agentControllerCollaborationModePatch
    )
  ) {
    const updated =
      await updatePrimaryAgentProfileBindingAgentControllerCollaborationMode({
        agentProfileId: input.record.agentProfileId,
        agentControllerCollaborationMode:
          input.agentControllerCollaborationModePatch
            .agentControllerCollaborationMode,
        bindingId: current.bindingId,
        db: input.db,
        expectedConfigurationRevision: current.configurationRevision,
        owner: input.record.owner,
        updatedAtMs: input.record.updatedAtMs,
      });
    current = updated.binding ?? current;
    changed = true;
  }

  if (
    input.agentControllerPermissionModePatch &&
    !agentControllerPermissionModeEqual(
      current,
      input.agentControllerPermissionModePatch
    )
  ) {
    const updated =
      await updatePrimaryAgentProfileBindingAgentControllerPermissionMode({
        agentProfileId: input.record.agentProfileId,
        agentControllerPermissionMode:
          input.agentControllerPermissionModePatch
            .agentControllerPermissionMode,
        bindingId: current.bindingId,
        db: input.db,
        expectedConfigurationRevision: current.configurationRevision,
        owner: input.record.owner,
        updatedAtMs: input.record.updatedAtMs,
      });
    current = updated.binding ?? current;
    changed = true;
  }

  if (
    input.modelSelectionPatch &&
    !modelSelectionEqual(current, input.modelSelectionPatch)
  ) {
    const updated = await updatePrimaryAgentProfileBindingModelSelection({
      agentProfileId: input.record.agentProfileId,
      bindingId: current.bindingId,
      db: input.db,
      expectedConfigurationRevision: current.configurationRevision,
      modelId: input.modelSelectionPatch.modelId,
      owner: input.record.owner,
      reasoningLevel: input.modelSelectionPatch.reasoningLevel,
      updatedAtMs: input.record.updatedAtMs,
    });
    current = updated.binding ?? current;
    changed = true;
  }

  if (
    input.openCodePermissionPatch &&
    !openCodePermissionEqual(current, input.openCodePermissionPatch)
  ) {
    const updated = await updatePrimaryAgentProfileBindingOpenCodePermission({
      agentProfileId: input.record.agentProfileId,
      bindingId: current.bindingId,
      db: input.db,
      expectedConfigurationRevision: current.configurationRevision,
      openCodePermission: input.openCodePermissionPatch.openCodePermission,
      owner: input.record.owner,
      updatedAtMs: input.record.updatedAtMs,
    });
    current = updated.binding ?? current;
    changed = true;
  }

  return changed ? current : null;
}

type AgentProfileBindingSettingsWriteAttempt = {
  binding: AgentProfileBindingRecord | null;
  changed: boolean;
};

function resolveAgentProfileBindingSettingsWriteResult(input: {
  attempt: AgentProfileBindingSettingsWriteAttempt;
  matches: (binding: AgentProfileBindingRecord) => boolean;
}): AgentProfileBindingSettingsWriteResult {
  if (!input.attempt.binding) {
    return { binding: null, status: "missing" };
  }
  if (!input.matches(input.attempt.binding)) {
    return { binding: input.attempt.binding, status: "conflict" };
  }
  return {
    binding: input.attempt.binding,
    status: input.attempt.changed ? "updated" : "unchanged",
  };
}

async function updatePrimaryAgentProfileBindingAgentControllerPermissionMode(input: {
  agentProfileId: string;
  agentControllerPermissionMode: string;
  bindingId: string;
  db: D1Database;
  expectedConfigurationRevision: number;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          agent_controller_permission_mode = ?,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = ?
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_id = ?
          AND binding_state = 'enabled_primary'
          AND configuration_revision = ?
      `
    )
    .bind(
      input.agentControllerPermissionMode,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision
    )
    .run();

  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.meta.changes === 1,
  };
}

async function updatePrimaryAgentProfileBindingAgentControllerCollaborationMode(input: {
  agentProfileId: string;
  agentControllerCollaborationMode: string;
  bindingId: string;
  db: D1Database;
  expectedConfigurationRevision: number;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          agent_controller_collaboration_mode = ?,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = ?
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_id = ?
          AND binding_state = 'enabled_primary'
          AND configuration_revision = ?
      `
    )
    .bind(
      input.agentControllerCollaborationMode,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision
    )
    .run();

  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.meta.changes === 1,
  };
}

async function updatePrimaryAgentProfileBindingModelSelection(input: {
  agentProfileId: string;
  bindingId: string;
  db: D1Database;
  expectedConfigurationRevision: number;
  modelId: string | null;
  owner: AgentProfileBindingOwner;
  reasoningLevel: string | null;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          model_id = ?,
          reasoning_level = ?,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = ?
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_id = ?
          AND binding_state = 'enabled_primary'
          AND configuration_revision = ?
      `
    )
    .bind(
      input.modelId,
      input.modelId ? input.reasoningLevel : null,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision
    )
    .run();

  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.meta.changes === 1,
  };
}

async function updatePrimaryAgentProfileBindingOpenCodePermission(input: {
  agentProfileId: string;
  bindingId: string;
  db: D1Database;
  expectedConfigurationRevision: number;
  openCodePermission: OpenCodePermissionConfig | null;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET
          opencode_permission = ?,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = ?
        WHERE owner_kind = ?
          AND owner_id = ?
          AND agent_profile_id = ?
          AND binding_id = ?
          AND binding_state = 'enabled_primary'
          AND configuration_revision = ?
      `
    )
    .bind(
      serializeOpenCodePermission(input.openCodePermission),
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision
    )
    .run();

  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.meta.changes === 1,
  };
}

function mapAgentProfileBindingRow(
  row: AgentProfileBindingRow
): AgentProfileBindingRecord {
  return {
    agentProfileId: row.agent_profile_id,
    bindingId: row.binding_id,
    bindingState: row.binding_state,
    agentControllerRef: row.agent_controller_ref,
    agentControllerConversationId: row.agent_controller_conversation_id,
    createdAtMs: row.created_at_ms,
    createdByProfileId: row.created_by_profile_id,
    configurationRevision: row.configuration_revision,
    disabledAtMs: row.disabled_at_ms,
    owner: {
      id: row.owner_id,
      kind: row.owner_kind,
    },
    reasonCode: row.reason_code,
    openMeldServiceRuntimeId: row.openmeld_service_runtime_id,
    runtimeKind: row.runtime_kind ?? "openmeld_service",
    hostedRuntimeIdentityJson: row.hosted_runtime_identity_json,
    agentControllerCollaborationMode: row.agent_controller_collaboration_mode,
    agentControllerPermissionMode: row.agent_controller_permission_mode,
    modelId: row.model_id,
    openCodePermission: parseStoredOpenCodePermission(row.opencode_permission),
    reasoningLevel: row.model_id ? row.reasoning_level : null,
    updatedAtMs: row.updated_at_ms,
  };
}

function normalizeNullableText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function agentControllerPermissionModeEqual(
  left: {
    agentControllerPermissionMode?: string | null;
  },
  right: {
    agentControllerPermissionMode?: string | null;
  }
): boolean {
  return (
    normalizeNullableText(left.agentControllerPermissionMode) ===
    normalizeNullableText(right.agentControllerPermissionMode)
  );
}

function agentControllerCollaborationModeEqual(
  left: {
    agentControllerCollaborationMode?: string | null;
  },
  right: {
    agentControllerCollaborationMode?: string | null;
  }
): boolean {
  return (
    normalizeNullableText(left.agentControllerCollaborationMode) ===
    normalizeNullableText(right.agentControllerCollaborationMode)
  );
}

function modelSelectionEqual(
  left: {
    modelId?: string | null;
    reasoningLevel?: string | null;
  },
  right: {
    modelId?: string | null;
    reasoningLevel?: string | null;
  }
): boolean {
  const leftModelId = normalizeNullableText(left.modelId);
  const rightModelId = normalizeNullableText(right.modelId);
  if (leftModelId !== rightModelId) {
    return false;
  }
  if (!leftModelId) {
    return true;
  }
  return (
    normalizeNullableText(left.reasoningLevel) ===
    normalizeNullableText(right.reasoningLevel)
  );
}

function openCodePermissionEqual(
  left: {
    openCodePermission?: OpenCodePermissionConfig | null;
  },
  right: {
    openCodePermission?: OpenCodePermissionConfig | null;
  }
): boolean {
  return (
    serializeOpenCodePermission(left.openCodePermission) ===
    serializeOpenCodePermission(right.openCodePermission)
  );
}

function serializeOpenCodePermission(
  value: OpenCodePermissionConfig | null | undefined
): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseStoredOpenCodePermission(
  value: string | null | undefined
): OpenCodePermissionConfig | null {
  const raw = normalizeNullableText(value);
  if (!raw) {
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Agent Profile Binding opencode_permission is invalid JSON: ${toErrorMessage(error)}`
    );
  }
  const parsed = openCodePermissionConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("Agent Profile Binding opencode_permission is invalid");
  }
  return parsed.data;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getChangedRows(result: D1Result): number {
  const changes = (result.meta as { changes?: unknown } | undefined)?.changes;
  if (typeof changes !== "number") {
    throw new Error(
      "Agent Profile Binding write result is missing changed row count"
    );
  }
  return changes;
}
