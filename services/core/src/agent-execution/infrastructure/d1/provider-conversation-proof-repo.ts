import type {
  RuntimeProviderConversationProofMethod,
  RuntimeProviderConversationProofProvider,
  RuntimeProviderConversationProofRejectedReason,
  RuntimeProviderConversationProofStatus,
} from "@openmeld/schemas/types";

export type AcceptedProviderConversationProof = {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  agentControllerConversationId: string;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
  errorCode: string | null;
  errorMessage: string | null;
  errorType: string | null;
  expiresAtMs: number;
  intrusive: false;
  method: RuntimeProviderConversationProofMethod;
  observedAtMs: number;
  provider: RuntimeProviderConversationProofProvider;
  status: RuntimeProviderConversationProofStatus;
  transportMode: "codex-app-server";
};

export type ProviderConversationProofAcceptanceOutcome =
  | "created"
  | "updated"
  | "reused";

export type ProviderConversationProofAcceptanceResult =
  | {
      currentProof: AcceptedProviderConversationProof;
      outcome: ProviderConversationProofAcceptanceOutcome;
      status: "accepted";
    }
  | {
      currentProof?: AcceptedProviderConversationProof;
      reason: RuntimeProviderConversationProofRejectedReason;
      status: "rejected";
    };

type ProviderConversationProofRow = {
  agent_profile_id: string;
  binding_id: string;
  openmeld_service_runtime_id: string;
  agent_controller_ref: string;
  agent_controller_conversation_id: string;
  provider: RuntimeProviderConversationProofProvider;
  method: RuntimeProviderConversationProofMethod;
  status: RuntimeProviderConversationProofStatus;
  transport_mode: "codex-app-server";
  intrusive: number;
  error_code: string | null;
  error_type: string | null;
  error_message: string | null;
  observed_at_ms: number;
  expires_at_ms: number;
};

export async function acceptProviderConversationProofRecord(input: {
  db: D1Database;
  nowMs: number;
  proof: AcceptedProviderConversationProof;
}): Promise<ProviderConversationProofAcceptanceResult> {
  if (input.proof.expiresAtMs <= input.nowMs) {
    return {
      reason: "stale",
      status: "rejected",
    };
  }

  const existing = await readCurrentProviderConversationProof({
    agentControllerConversationId: input.proof.agentControllerConversationId,
    agentControllerRef: input.proof.agentControllerRef,
    agentProfileId: input.proof.agentProfileId,
    bindingId: input.proof.bindingId,
    db: input.db,
    method: input.proof.method,
    provider: input.proof.provider,
    openMeldServiceRuntimeId: input.proof.openMeldServiceRuntimeId,
  });
  const existingDecision = resolveExistingProofDecision({
    currentProof: existing,
    nextProof: input.proof,
  });
  if (existingDecision) {
    return existingDecision;
  }

  if (existing) {
    return updateNewerProviderConversationProof(input);
  }

  const insertResult = await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_provider_conversation_proofs (
          proof_id,
          provider,
          method,
          status,
          agent_profile_id,
          binding_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          agent_controller_conversation_id,
          transport_mode,
          intrusive,
          error_code,
          error_type,
          error_message,
          observed_at_ms,
          expires_at_ms,
          created_at_ms,
          updated_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM openMeldDaemon_runtime_registry_records
          WHERE openmeld_service_runtime_id = ?
        )
        ON CONFLICT(agent_profile_id, binding_id, openmeld_service_runtime_id, agent_controller_ref, agent_controller_conversation_id, provider, method)
        DO NOTHING
      `
    )
    .bind(
      buildProviderConversationProofId(input.proof),
      input.proof.provider,
      input.proof.method,
      input.proof.status,
      input.proof.agentProfileId,
      input.proof.bindingId,
      input.proof.openMeldServiceRuntimeId.value,
      input.proof.agentControllerRef,
      input.proof.agentControllerConversationId,
      input.proof.transportMode,
      0,
      input.proof.errorCode,
      input.proof.errorType,
      input.proof.errorMessage,
      input.proof.observedAtMs,
      input.proof.expiresAtMs,
      input.nowMs,
      input.nowMs,
      input.proof.openMeldServiceRuntimeId.value
    )
    .run();

  if (getChangedRows(insertResult) > 0) {
    return {
      currentProof: input.proof,
      outcome: "created",
      status: "accepted",
    };
  }

  if (
    !(await readRuntimeRegistryRecordExists({
      db: input.db,
      openMeldServiceRuntimeId: input.proof.openMeldServiceRuntimeId.value,
    }))
  ) {
    return {
      reason: "runtime_missing",
      status: "rejected",
    };
  }

  return resolveConcurrentProviderConversationProofWrite(input);
}

export async function readFreshProviderConversationProofForBinding(input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  agentControllerConversationId: string;
  db: D1Database;
  method: RuntimeProviderConversationProofMethod;
  nowMs: number;
  provider: RuntimeProviderConversationProofProvider;
  openMeldServiceRuntimeId: string;
}): Promise<AcceptedProviderConversationProof | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          agent_profile_id,
          binding_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          agent_controller_conversation_id,
          provider,
          method,
          status,
          transport_mode,
          intrusive,
          error_code,
          error_type,
          error_message,
          observed_at_ms,
          expires_at_ms
        FROM openMeldDaemon_provider_conversation_proofs
        WHERE agent_profile_id = ?
          AND binding_id = ?
          AND openmeld_service_runtime_id = ?
          AND agent_controller_ref = ?
          AND agent_controller_conversation_id = ?
          AND provider = ?
          AND method = ?
          AND expires_at_ms > ?
        ORDER BY observed_at_ms DESC
        LIMIT 1
      `
    )
    .bind(
      input.agentProfileId,
      input.bindingId,
      input.openMeldServiceRuntimeId,
      input.agentControllerRef,
      input.agentControllerConversationId,
      input.provider,
      input.method,
      normalizeTimestampMs(input.nowMs)
    )
    .first<ProviderConversationProofRow>();

  return row ? mapProviderConversationProofRow(row) : null;
}

async function readCurrentProviderConversationProof(input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  agentControllerConversationId: string;
  db: D1Database;
  method: RuntimeProviderConversationProofMethod;
  provider: RuntimeProviderConversationProofProvider;
  openMeldServiceRuntimeId: { value: string };
}): Promise<AcceptedProviderConversationProof | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          agent_profile_id,
          binding_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          agent_controller_conversation_id,
          provider,
          method,
          status,
          transport_mode,
          intrusive,
          error_code,
          error_type,
          error_message,
          observed_at_ms,
          expires_at_ms
        FROM openMeldDaemon_provider_conversation_proofs
        WHERE agent_profile_id = ?
          AND binding_id = ?
          AND openmeld_service_runtime_id = ?
          AND agent_controller_ref = ?
          AND agent_controller_conversation_id = ?
          AND provider = ?
          AND method = ?
        LIMIT 1
      `
    )
    .bind(
      input.agentProfileId,
      input.bindingId,
      input.openMeldServiceRuntimeId.value,
      input.agentControllerRef,
      input.agentControllerConversationId,
      input.provider,
      input.method
    )
    .first<ProviderConversationProofRow>();

  return row ? mapProviderConversationProofRow(row) : null;
}

async function updateNewerProviderConversationProof(input: {
  db: D1Database;
  nowMs: number;
  proof: AcceptedProviderConversationProof;
}): Promise<ProviderConversationProofAcceptanceResult> {
  const updateResult = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_provider_conversation_proofs
        SET
          status = ?,
          transport_mode = ?,
          intrusive = ?,
          error_code = ?,
          error_type = ?,
          error_message = ?,
          observed_at_ms = ?,
          expires_at_ms = ?,
          updated_at_ms = ?
        WHERE agent_profile_id = ?
          AND binding_id = ?
          AND openmeld_service_runtime_id = ?
          AND agent_controller_ref = ?
          AND agent_controller_conversation_id = ?
          AND provider = ?
          AND method = ?
          AND observed_at_ms < ?
      `
    )
    .bind(
      input.proof.status,
      input.proof.transportMode,
      0,
      input.proof.errorCode,
      input.proof.errorType,
      input.proof.errorMessage,
      input.proof.observedAtMs,
      input.proof.expiresAtMs,
      input.nowMs,
      input.proof.agentProfileId,
      input.proof.bindingId,
      input.proof.openMeldServiceRuntimeId.value,
      input.proof.agentControllerRef,
      input.proof.agentControllerConversationId,
      input.proof.provider,
      input.proof.method,
      input.proof.observedAtMs
    )
    .run();

  if (getChangedRows(updateResult) > 0) {
    return {
      currentProof: input.proof,
      outcome: "updated",
      status: "accepted",
    };
  }

  return resolveConcurrentProviderConversationProofWrite(input);
}

async function resolveConcurrentProviderConversationProofWrite(input: {
  db: D1Database;
  nowMs: number;
  proof: AcceptedProviderConversationProof;
}): Promise<ProviderConversationProofAcceptanceResult> {
  const currentProof = await readCurrentProviderConversationProof({
    agentControllerConversationId: input.proof.agentControllerConversationId,
    agentControllerRef: input.proof.agentControllerRef,
    agentProfileId: input.proof.agentProfileId,
    bindingId: input.proof.bindingId,
    db: input.db,
    method: input.proof.method,
    provider: input.proof.provider,
    openMeldServiceRuntimeId: input.proof.openMeldServiceRuntimeId,
  });
  const decision = resolveExistingProofDecision({
    currentProof,
    nextProof: input.proof,
  });
  if (decision) {
    return decision;
  }
  if (currentProof) {
    return updateNewerProviderConversationProof(input);
  }
  return {
    reason: "runtime_missing",
    status: "rejected",
  };
}

function resolveExistingProofDecision(input: {
  currentProof: AcceptedProviderConversationProof | null;
  nextProof: AcceptedProviderConversationProof;
}): ProviderConversationProofAcceptanceResult | null {
  if (!input.currentProof) {
    return null;
  }
  if (input.nextProof.observedAtMs < input.currentProof.observedAtMs) {
    return {
      currentProof: input.currentProof,
      reason: "out_of_order",
      status: "rejected",
    };
  }
  if (input.nextProof.observedAtMs === input.currentProof.observedAtMs) {
    if (areSameProof(input.nextProof, input.currentProof)) {
      return {
        currentProof: input.currentProof,
        outcome: "reused",
        status: "accepted",
      };
    }
    return {
      currentProof: input.currentProof,
      reason: "conflict",
      status: "rejected",
    };
  }
  return null;
}

function areSameProof(
  left: AcceptedProviderConversationProof,
  right: AcceptedProviderConversationProof
): boolean {
  return (
    left.agentProfileId === right.agentProfileId &&
    left.bindingId === right.bindingId &&
    left.openMeldServiceRuntimeId.value ===
      right.openMeldServiceRuntimeId.value &&
    left.agentControllerRef === right.agentControllerRef &&
    left.agentControllerConversationId ===
      right.agentControllerConversationId &&
    left.provider === right.provider &&
    left.method === right.method &&
    left.status === right.status &&
    left.transportMode === right.transportMode &&
    left.intrusive === right.intrusive &&
    left.errorCode === right.errorCode &&
    left.errorType === right.errorType &&
    left.errorMessage === right.errorMessage &&
    left.observedAtMs === right.observedAtMs &&
    left.expiresAtMs === right.expiresAtMs
  );
}

function mapProviderConversationProofRow(
  row: ProviderConversationProofRow
): AcceptedProviderConversationProof | null {
  if (
    row.provider !== "codex" ||
    row.method !== "codex_app_server_thread_resume" ||
    !(row.status === "passed" || row.status === "failed") ||
    row.transport_mode !== "codex-app-server" ||
    row.intrusive !== 0
  ) {
    return null;
  }
  return {
    agentProfileId: row.agent_profile_id,
    bindingId: row.binding_id,
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: row.openmeld_service_runtime_id,
    },
    agentControllerRef: row.agent_controller_ref,
    agentControllerConversationId: row.agent_controller_conversation_id,
    provider: row.provider,
    method: row.method,
    status: row.status,
    transportMode: row.transport_mode,
    intrusive: false,
    errorCode: row.error_code,
    errorType: row.error_type,
    errorMessage: row.error_message,
    observedAtMs: normalizeTimestampMs(row.observed_at_ms),
    expiresAtMs: normalizeTimestampMs(row.expires_at_ms),
  };
}

function buildProviderConversationProofId(
  proof: AcceptedProviderConversationProof
): string {
  return [
    "provider_conversation_proof",
    proof.provider,
    proof.method,
    proof.agentProfileId,
    proof.bindingId,
    proof.openMeldServiceRuntimeId.value,
    proof.agentControllerRef,
    proof.agentControllerConversationId,
  ].join(":");
}

async function readRuntimeRegistryRecordExists(input: {
  db: D1Database;
  openMeldServiceRuntimeId: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        SELECT 1 AS found
        FROM openMeldDaemon_runtime_registry_records
        WHERE openmeld_service_runtime_id = ?
        LIMIT 1
      `
    )
    .bind(input.openMeldServiceRuntimeId)
    .first<{ found?: number }>();
  return row?.found === 1;
}

function getChangedRows(result: D1Result): number {
  return Math.max(0, Math.trunc(result.meta.changes ?? 0));
}

function normalizeTimestampMs(value: number): number {
  return Math.max(0, Math.trunc(value));
}
