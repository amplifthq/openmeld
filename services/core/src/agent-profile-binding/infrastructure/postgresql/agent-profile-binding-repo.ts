import type {
  PoolClient,
  PostgresDatabase,
  QueryResult,
} from "@openmeld/db/postgresql";
import {
  agentProfileBindingModelSelectionSchema,
  harnessKindFromAgentControllerRef,
  openCodePermissionConfigSchema,
} from "@openmeld/schemas";
import type {
  AgentProfileBindingModelSelection,
  OpenCodePermissionConfig,
} from "@openmeld/schemas/types";
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
  kind: "owner_account" | "organization";
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
  runtimeKind?:
    | "openmeld_service"
    | "hosted_center_agent"
    | "hosted_remote_agent";
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
        | "member_agent_harness_locked"
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
  owner_kind: "owner_account" | "organization";
  reason_code: string | null;
  openmeld_service_runtime_id: string;
  runtime_kind:
    | "openmeld_service"
    | "hosted_center_agent"
    | "hosted_remote_agent"
    | null;
  hosted_runtime_identity_json: string | null;
  agent_controller_collaboration_mode: string | null;
  agent_controller_permission_mode: string | null;
  model_id: string | null;
  opencode_permission: string | null;
  reasoning_level: string | null;
  updated_at_ms: number;
};
export function createPostgresAgentProfileBindingCommandStore(input: {
  acquireExecutionTargetMutationAdmission?: AcquireAgentProfileExecutionTargetMutationAdmission;
  db: PostgresDatabase;
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
      initializeOnly,
      agentControllerCollaborationModePatch,
      agentControllerPermissionModePatch,
      modelSelectionPatch,
      openCodePermissionPatch,
      record,
    }) =>
      ensurePrimaryAgentProfileBindingRecord({
        initializeOnly,
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
export function createPostgresAgentProfileBindingLookupStore(input: {
  db: PostgresDatabase;
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
  initializeOnly?: boolean;
  agentControllerCollaborationModePatch?: AgentProfileBindingAgentControllerCollaborationModePatch;
  agentControllerPermissionModePatch?: AgentProfileBindingAgentControllerPermissionModePatch;
  db: PostgresDatabase;
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
// PostgreSQL permits concurrent writers. Serialize this owner's Binding admission
// before taking the next statement snapshot; historical rows are not rewritten.
async function lockBindingOwner(
  client: PoolClient,
  owner: AgentProfileBindingOwner
): Promise<void> {
  const table = owner.kind === "owner_account" ? "users" : "organizations";
  const result = await client.query({
    text: `SELECT id FROM "openmeld"."${table}" WHERE id = $1 FOR UPDATE`,
    values: [owner.id],
  });
  if (result.rowCount !== 1) {
    throw new Error("Agent Profile Binding owner is missing");
  }
}
// Serializes a Binding write with a MemberAgent assignment of the same
// Profile. The assignment holds this lock while Auth writes the Profile row,
// whose account guard takes the owner row FOR SHARE; Binding writes therefore
// take it before the owner lock, never after.
export async function lockAgentProfileMemberAgentAssignment(
  client: PoolClient,
  agentProfileId: string
): Promise<void> {
  await client.query({
    text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    values: [`agent_profile_member_agent:${agentProfileId}`],
  });
}
// A Profile that belongs to a MemberAgent cannot change harness
// (developing/product/agent-profiles.md, MemberAgent Layer). Read under the
// assignment lock, so the assignment this sees is the one the write commits
// with.
// Unassigned Profiles, custom controllers included, may change freely.
async function hasMemberAgentHarnessConflict(
  client: PoolClient,
  record: EnabledPrimaryAgentProfileBindingInput
): Promise<boolean> {
  const result = await client.query<{ harness_kind: string }>({
    text: `
      SELECT member_agent.harness_kind
      FROM "openmeld"."openmeld_profiles" AS profile
      INNER JOIN "openmeld"."member_agents" AS member_agent
        ON member_agent.id = profile.member_agent_id
      WHERE profile.profile_id = $1
    `,
    values: [record.agentProfileId],
  });
  const assignedHarnessKind = result.rows[0]?.harness_kind;
  return (
    assignedHarnessKind !== undefined &&
    assignedHarnessKind !==
      harnessKindFromAgentControllerRef(record.agentControllerRef)
  );
}
function memberAgentHarnessLockedResult(): EnsurePrimaryAgentProfileBindingResult {
  return { reason: "member_agent_harness_locked", status: "rejected" };
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
    if (input.initializeOnly) {
      return { binding: current, outcome: "reused", status: "accepted" };
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
  const sessionEligibility = buildSessionInventoryEligibilityClause(input, 23);
  const insertResult = await input.db.transaction(async (client) => {
    await lockAgentProfileMemberAgentAssignment(
      client,
      input.record.agentProfileId
    );
    await lockBindingOwner(client, input.record.owner);
    if (await hasMemberAgentHarnessConflict(client, input.record)) {
      return null;
    }
    return client.query({
      text: `
        INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
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
\t          created_by_profile_id,
\t          reason_code,
\t          agent_controller_collaboration_mode,
\t          agent_controller_permission_mode,
\t          model_id,
\t          opencode_permission,
\t          reasoning_level
\t        )
\t        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'enabled_primary', $10, $11, null, $12, $13, $14, $15, $16, $17, $18
        WHERE NOT EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldDaemon_agent_profile_bindings" existing
          WHERE existing.owner_kind = $19
            AND existing.owner_id = $20
            AND existing.agent_controller_ref = $21
            AND existing.agent_controller_conversation_id = $22
            AND existing.binding_state = 'enabled_primary'
            AND existing.agent_profile_id <> $23
        )
        ${sessionEligibility.sql}
        ON CONFLICT(owner_kind, owner_id, agent_profile_id)
          WHERE binding_state = 'enabled_primary'
          DO NOTHING
      `,
      values: [
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
        ...sessionEligibility.bindings,
      ],
    });
  });
  if (!insertResult) {
    return memberAgentHarnessLockedResult();
  }
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
  | {
      result: EnsurePrimaryAgentProfileBindingResult;
      status: "completed";
    }
  | {
      status: "retry";
    }
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
  const sessionEligibility = buildSessionInventoryEligibilityClause(input, 23);
  const disableSessionEligibility = buildSessionInventoryEligibilityClause(
    input,
    12
  );
  const controllerSettings = resolveReconnectControllerSettings({
    current,
    input,
  });
  const writeResults = await input.db.transaction(async (client) => {
    await lockAgentProfileMemberAgentAssignment(
      client,
      input.record.agentProfileId
    );
    await lockBindingOwner(client, input.record.owner);
    if (await hasMemberAgentHarnessConflict(client, input.record)) {
      return null;
    }
    return [
      await client.query({
        text: `
          UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
          SET
            binding_state = 'disabled_historical',
            disabled_at_ms = $1,
            updated_at_ms = $2
          WHERE owner_kind = $3
            AND owner_id = $4
            AND agent_profile_id = $5
            AND binding_id = $6
            AND binding_state = 'enabled_primary'
            AND configuration_revision = $7
            AND NOT EXISTS (
              SELECT 1
              FROM "openmeld"."openMeldDaemon_agent_profile_bindings" existing
              WHERE existing.owner_kind = $8
                AND existing.owner_id = $9
                AND existing.agent_controller_ref = $10
                AND existing.agent_controller_conversation_id = $11
                AND existing.binding_state = 'enabled_primary'
                AND existing.agent_profile_id <> $12
            )
            ${disableSessionEligibility.sql}
        `,
        values: [
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
          ...disableSessionEligibility.bindings,
        ],
      }),
      await client.query({
        text: `
          INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
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
\t            created_by_profile_id,
\t            reason_code,
\t            agent_controller_collaboration_mode,
\t            agent_controller_permission_mode,
\t            model_id,
\t            opencode_permission,
\t            reasoning_level
\t          )
\t          SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'enabled_primary', $10, $11, null, $12, $13, $14, $15, $16, $17, $18
          WHERE NOT EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldDaemon_agent_profile_bindings" existing
            WHERE existing.owner_kind = $19
              AND existing.owner_id = $20
              AND existing.agent_controller_ref = $21
              AND existing.agent_controller_conversation_id = $22
              AND existing.binding_state = 'enabled_primary'
              AND existing.agent_profile_id <> $23
          )
          ${sessionEligibility.sql}
          ON CONFLICT(owner_kind, owner_id, agent_profile_id)
            WHERE binding_state = 'enabled_primary'
            DO NOTHING
        `,
        values: [
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
          ...sessionEligibility.bindings,
        ],
      }),
    ] as const;
  });
  if (!writeResults) {
    return { result: memberAgentHarnessLockedResult(), status: "completed" };
  }
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
  writeResults: readonly QueryResult[];
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
  insertResult: QueryResult;
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
  if (context.request.initializeOnly) {
    return { binding, outcome: "reused", status: "accepted" };
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
  input: AgentProfileBindingWriteRequest & {
    writeResults: readonly QueryResult[];
  }
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
  Extract<
    EnsurePrimaryAgentProfileBindingResult,
    {
      status: "rejected";
    }
  >
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
  input: AgentProfileBindingWriteRequest,
  parameterOffset: number
): {
  bindings: unknown[];
  sql: string;
} {
  if (!input.sessionInventoryEligibility) {
    return { bindings: [], sql: "" };
  }
  const query = buildAgentActivitySessionResumeEligibilityQuery(
    input.sessionInventoryEligibility,
    parameterOffset
  );
  return query
    ? { bindings: query.bindings, sql: `AND EXISTS (${query.sql})` }
    : { bindings: [], sql: "AND FALSE" };
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
  {
    status: "rejected";
  }
> {
  return {
    reason: "session_resume_unavailable",
    status: "rejected",
  };
}
async function readControllerConversationConflict(input: {
  db: PostgresDatabase;
  record: EnabledPrimaryAgentProfileBindingInput;
}): Promise<Extract<
  EnsurePrimaryAgentProfileBindingResult,
  {
    status: "rejected";
  }
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
  db: PostgresDatabase;
  owner: AgentProfileBindingOwner;
}): Promise<AgentProfileBindingRecord | null> {
  const statement = {
    text: `
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
\t          created_by_profile_id,
\t          reason_code,
\t          agent_controller_collaboration_mode,
\t          agent_controller_permission_mode,
\t          configuration_revision,
\t          model_id,
\t          opencode_permission,
\t          reasoning_level
\t        FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
        WHERE owner_kind = $1
          AND owner_id = $2
          AND agent_profile_id = $3
          AND binding_state = 'enabled_primary'
        LIMIT 1
      `,
    values: [input.owner.kind, input.owner.id, input.agentProfileId],
  };
  const row = await input.db
    .query<AgentProfileBindingRow>(statement)
    .then((result) => result.rows[0] ?? null);
  return row ? mapAgentProfileBindingRow(row) : null;
}
type PrimaryAgentProfileConfiguration = {
  agentControllerRef: string;
  modelSelection?: AgentProfileBindingModelSelection | null;
};
/** Member-visible configuration only. Authorize exact Profile/owner pairs first. */
export async function listPrimaryAgentProfileConfigurations(input: {
  profiles: readonly {
    profileId: string;
    ownerUserId: string | null;
    organizationId?: string;
    managedRole?: string | null;
  }[];
  db: PostgresDatabase;
  includeModelSelection?: boolean;
}): Promise<ReadonlyMap<string, PrimaryAgentProfileConfiguration>> {
  const profiles = [
    ...new Map(
      input.profiles.map((profile) => [profile.profileId, profile])
    ).values(),
  ];
  const configurations = new Map<string, PrimaryAgentProfileConfiguration>();
  if (profiles.length === 0) {
    return configurations;
  }
  const selectors = profiles.map((profile) => {
    if (
      profile.managedRole === "center_agent" &&
      !profile.ownerUserId &&
      profile.organizationId
    ) {
      return {
        profileId: profile.profileId,
        ownerKind: "organization",
        ownerId: profile.organizationId,
      };
    }
    if (!profile.ownerUserId) {
      throw new Error("Agent Profile owner is missing");
    }
    return {
      profileId: profile.profileId,
      ownerKind: "owner_account",
      ownerId: profile.ownerUserId,
    };
  });
  const result = await input.db.query<{
    agent_profile_id: string;
    agent_controller_ref: string;
    model_id?: string | null;
    reasoning_level?: string | null;
  }>({
    text: `SELECT binding.agent_profile_id, binding.agent_controller_ref${input.includeModelSelection ? ", binding.model_id, binding.reasoning_level" : ""}
      FROM "openmeld"."openMeldDaemon_agent_profile_bindings" AS binding
      JOIN unnest($1::text[], $2::text[], $3::text[]) AS selector(profile_id, owner_kind, owner_id)
        ON binding.agent_profile_id = selector.profile_id
        AND binding.owner_kind = selector.owner_kind AND binding.owner_id = selector.owner_id
      WHERE binding.binding_state = 'enabled_primary'
      ORDER BY binding.agent_profile_id, binding.binding_id`,
    values: [
      selectors.map((selector) => selector.profileId),
      selectors.map((selector) => selector.ownerKind),
      selectors.map((selector) => selector.ownerId),
    ],
  });
  for (const row of result.rows) {
    const configuration: PrimaryAgentProfileConfiguration = {
      agentControllerRef: row.agent_controller_ref,
    };
    if (input.includeModelSelection) {
      configuration.modelSelection = readPrimaryBindingModelSelection(row);
    }
    configurations.set(row.agent_profile_id, configuration);
  }
  return configurations;
}
function readPrimaryBindingModelSelection(row: {
  model_id?: string | null;
  reasoning_level?: string | null;
}): AgentProfileBindingModelSelection | null {
  if (
    !(Object.hasOwn(row, "model_id") && Object.hasOwn(row, "reasoning_level"))
  ) {
    throw new Error("Incomplete primary Binding model selection.");
  }
  const parsed = agentProfileBindingModelSelectionSchema.nullable().safeParse(
    row.model_id
      ? {
          modelId: row.model_id,
          ...(row.reasoning_level
            ? { reasoningLevel: row.reasoning_level }
            : {}),
        }
      : null
  );
  if (!parsed.success) {
    throw new Error("Invalid primary Binding model selection.");
  }
  return parsed.data;
}
export async function listEnabledPrimaryAgentProfileBindingRecordsForProfile(input: {
  agentProfileId: string;
  db: PostgresDatabase;
}): Promise<AgentProfileBindingRecord[]> {
  const result = await input.db.query<AgentProfileBindingRow>({
    text: `
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
	        FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
        WHERE agent_profile_id = $1
          AND binding_state = 'enabled_primary'
        ORDER BY owner_kind ASC NULLS FIRST, owner_id ASC NULLS FIRST, binding_id ASC NULLS FIRST
        LIMIT $2
      `,
    values: [
      input.agentProfileId,
      MAX_ENABLED_PRIMARY_BINDING_OWNERS_PER_AGENT_PROFILE + 1,
    ],
  });
  const rows = result.rows ?? [];
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
  db: PostgresDatabase;
  owner: AgentProfileBindingOwner;
  orderBy?: "profile" | "controller_conversation_conflict";
}): Promise<AgentProfileBindingRecord[]> {
  const orderBy =
    input.orderBy === "controller_conversation_conflict"
      ? "updated_at_ms DESC NULLS LAST, created_at_ms DESC NULLS LAST, binding_id DESC NULLS LAST"
      : "agent_profile_id ASC NULLS FIRST";
  const result = await input.db.query<AgentProfileBindingRow>({
    text: `
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
	        FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
        WHERE owner_kind = $1
          AND owner_id = $2
          AND binding_state = 'enabled_primary'
        ORDER BY ${orderBy}
      `,
    values: [input.owner.kind, input.owner.id],
  });
  return (result.rows ?? []).map((row) => mapAgentProfileBindingRow(row));
}
export async function listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController(input: {
  agentControllerRef: string;
  db: PostgresDatabase;
  openMeldServiceRuntimeId: string;
  owner: AgentProfileBindingOwner;
}): Promise<AgentProfileBindingRecord[]> {
  const result = await input.db.query<AgentProfileBindingRow>({
    text: `
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
	        FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
        WHERE openmeld_service_runtime_id = $1
          AND agent_controller_ref = $2
          AND owner_kind = $3
          AND owner_id = $4
          AND runtime_kind = 'openmeld_service'
          AND binding_state = 'enabled_primary'
        ORDER BY agent_profile_id ASC NULLS FIRST
      `,
    values: [
      input.openMeldServiceRuntimeId,
      input.agentControllerRef,
      input.owner.kind,
      input.owner.id,
    ],
  });
  return (result.rows ?? []).map((row) => mapAgentProfileBindingRow(row));
}
export async function disablePrimaryAgentProfileBindingRecord(input: {
  agentProfileId: string;
  db: PostgresDatabase;
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
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET
          binding_state = 'disabled_historical',
          disabled_at_ms = $1,
          updated_at_ms = $2,
          reason_code = $3
        WHERE owner_kind = $4
          AND owner_id = $5
          AND agent_profile_id = $6
          AND binding_id = $7
          AND binding_state = 'enabled_primary'
      `,
    values: [
      input.disabledAtMs,
      input.disabledAtMs,
      disabledReasonCode,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      current.bindingId,
    ],
  });
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
  db: PostgresDatabase;
  excludeAgentProfileId?: string | null;
  owner: AgentProfileBindingOwner;
}): Promise<AgentProfileBindingRecord | null> {
  const agentControllerConversationId = normalizeNullableText(
    input.agentControllerConversationId
  );
  if (!agentControllerConversationId) {
    return null;
  }
  const statement = {
    text: `
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
	        FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
        WHERE owner_kind = $1
          AND owner_id = $2
          AND agent_controller_ref = $3
          AND agent_controller_conversation_id = $4
          AND agent_profile_id != $5
          AND binding_state = 'enabled_primary'
        ORDER BY updated_at_ms DESC NULLS LAST, created_at_ms DESC NULLS LAST, binding_id DESC NULLS LAST
        LIMIT 1
      `,
    values: [
      input.owner.kind,
      input.owner.id,
      input.agentControllerRef,
      agentControllerConversationId,
      input.excludeAgentProfileId ?? "",
    ],
  };
  const row = await input.db
    .query<AgentProfileBindingRow>(statement)
    .then((result) => result.rows[0] ?? null);
  return row ? mapAgentProfileBindingRow(row) : null;
}
export async function updatePrimaryAgentProfileBindingConversationId(input: {
  agentControllerConversationId: string | null;
  agentProfileId: string;
  bindingId: string;
  db: PostgresDatabase;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingRecord | null> {
  const updated = await input.db.transaction(async (client) => {
    await lockAgentProfileMemberAgentAssignment(client, input.agentProfileId);
    await lockBindingOwner(client, input.owner);
    return client.query({
      text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET
          agent_controller_conversation_id = $1,
          updated_at_ms = $2
        WHERE owner_kind = $3
          AND owner_id = $4
          AND agent_profile_id = $5
          AND binding_id = $6
          AND binding_state = 'enabled_primary'
          AND NOT EXISTS (
            SELECT 1 FROM "openmeld"."openMeldDaemon_agent_profile_bindings" AS existing
            WHERE existing.owner_kind = $3 AND existing.owner_id = $4
              AND existing.agent_profile_id <> $5 AND existing.binding_state = 'enabled_primary'
              AND existing.agent_controller_conversation_id = $1
              AND existing.agent_controller_ref = "openMeldDaemon_agent_profile_bindings".agent_controller_ref
          )
      `,
      values: [
        input.agentControllerConversationId,
        input.updatedAtMs,
        input.owner.kind,
        input.owner.id,
        input.agentProfileId,
        input.bindingId,
      ],
    });
  });
  if (updated.rowCount === 0) {
    return null;
  }
  return await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
}
export async function updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord(input: {
  agentProfileId: string;
  agentControllerPermissionModePatch: AgentProfileBindingAgentControllerPermissionModePatch;
  db: PostgresDatabase;
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
  db: PostgresDatabase;
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
  db: PostgresDatabase;
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
  db: PostgresDatabase;
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
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET
          model_id = $1,
          reasoning_level = $2,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = $3
        WHERE owner_kind = $4
          AND owner_id = $5
          AND agent_profile_id = $6
          AND binding_id = $7
          AND binding_state = 'enabled_primary'
          AND configuration_revision = $8
      `,
    values: [
      input.modelSelectionPatch.modelId,
      input.modelSelectionPatch.modelId
        ? input.modelSelectionPatch.reasoningLevel
        : null,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      current.bindingId,
      input.expectedConfigurationRevision,
    ],
  });
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: input.owner,
  });
  if (!binding) {
    return { binding: null, status: "not_found" };
  }
  return result.rowCount === 1
    ? { binding, status: "updated" }
    : { binding, status: "conflict" };
}
export async function updatePrimaryAgentProfileBindingOpenCodePermissionRecord(input: {
  agentProfileId: string;
  db: PostgresDatabase;
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
  db: PostgresDatabase;
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
  db: PostgresDatabase;
  expectedConfigurationRevision: number;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET
          agent_controller_permission_mode = $1,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = $2
        WHERE owner_kind = $3
          AND owner_id = $4
          AND agent_profile_id = $5
          AND binding_id = $6
          AND binding_state = 'enabled_primary'
          AND configuration_revision = $7
      `,
    values: [
      input.agentControllerPermissionMode,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision,
    ],
  });
  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.rowCount === 1,
  };
}
async function updatePrimaryAgentProfileBindingAgentControllerCollaborationMode(input: {
  agentProfileId: string;
  agentControllerCollaborationMode: string;
  bindingId: string;
  db: PostgresDatabase;
  expectedConfigurationRevision: number;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET
          agent_controller_collaboration_mode = $1,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = $2
        WHERE owner_kind = $3
          AND owner_id = $4
          AND agent_profile_id = $5
          AND binding_id = $6
          AND binding_state = 'enabled_primary'
          AND configuration_revision = $7
      `,
    values: [
      input.agentControllerCollaborationMode,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision,
    ],
  });
  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.rowCount === 1,
  };
}
async function updatePrimaryAgentProfileBindingModelSelection(input: {
  agentProfileId: string;
  bindingId: string;
  db: PostgresDatabase;
  expectedConfigurationRevision: number;
  modelId: string | null;
  owner: AgentProfileBindingOwner;
  reasoningLevel: string | null;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET
          model_id = $1,
          reasoning_level = $2,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = $3
        WHERE owner_kind = $4
          AND owner_id = $5
          AND agent_profile_id = $6
          AND binding_id = $7
          AND binding_state = 'enabled_primary'
          AND configuration_revision = $8
      `,
    values: [
      input.modelId,
      input.modelId ? input.reasoningLevel : null,
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision,
    ],
  });
  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.rowCount === 1,
  };
}
async function updatePrimaryAgentProfileBindingOpenCodePermission(input: {
  agentProfileId: string;
  bindingId: string;
  db: PostgresDatabase;
  expectedConfigurationRevision: number;
  openCodePermission: OpenCodePermissionConfig | null;
  owner: AgentProfileBindingOwner;
  updatedAtMs: number;
}): Promise<AgentProfileBindingSettingsWriteAttempt> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET
          opencode_permission = $1,
          configuration_revision = configuration_revision + 1,
          updated_at_ms = $2
        WHERE owner_kind = $3
          AND owner_id = $4
          AND agent_profile_id = $5
          AND binding_id = $6
          AND binding_state = 'enabled_primary'
          AND configuration_revision = $7
      `,
    values: [
      serializeOpenCodePermission(input.openCodePermission),
      input.updatedAtMs,
      input.owner.kind,
      input.owner.id,
      input.agentProfileId,
      input.bindingId,
      input.expectedConfigurationRevision,
    ],
  });
  return {
    binding: await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db: input.db,
      owner: input.owner,
    }),
    changed: result.rowCount === 1,
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
function getChangedRows(result: QueryResult): number {
  const changes = result.rowCount;
  if (typeof changes !== "number") {
    throw new Error(
      "Agent Profile Binding write result is missing changed row count"
    );
  }
  return changes;
}
