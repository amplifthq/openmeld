import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
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
  const insertResult = await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_provider_conversation_proofs" (
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
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        WHERE EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldDaemon_runtime_registry_records"
          WHERE openmeld_service_runtime_id = $19
        )
        ON CONFLICT(agent_profile_id, binding_id, openmeld_service_runtime_id, agent_controller_ref, agent_controller_conversation_id, provider, method)
        DO NOTHING
      `,
    values: [
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
      input.proof.openMeldServiceRuntimeId.value,
    ],
  });
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
export async function readFreshProviderConversationProofsForBindings(input: {
  bindingIds: readonly string[];
  db: PostgresDatabase;
  nowMs: number;
}): Promise<AcceptedProviderConversationProof[]> {
  if (input.bindingIds.length === 0) {
    return [];
  }
  const result = await input.db.query<ProviderConversationProofRow>({
    text: `SELECT * FROM "openmeld"."openMeldDaemon_provider_conversation_proofs"
      WHERE binding_id = ANY($1::text[]) AND expires_at_ms > $2
      ORDER BY observed_at_ms DESC NULLS LAST`,
    values: [input.bindingIds, normalizeTimestampMs(input.nowMs)],
  });
  return result.rows
    .map(mapProviderConversationProofRow)
    .filter((proof) => proof !== null);
}
export async function readFreshProviderConversationProofForBinding(input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  agentControllerConversationId: string;
  db: PostgresDatabase;
  methods: readonly RuntimeProviderConversationProofMethod[];
  nowMs: number;
  provider: RuntimeProviderConversationProofProvider;
  openMeldServiceRuntimeId: string;
}): Promise<AcceptedProviderConversationProof | null> {
  const row = await input.db
    .query<ProviderConversationProofRow>({
      text: `
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
        FROM "openmeld"."openMeldDaemon_provider_conversation_proofs"
        WHERE agent_profile_id = $1
          AND binding_id = $2
          AND openmeld_service_runtime_id = $3
          AND agent_controller_ref = $4
          AND agent_controller_conversation_id = $5
          AND provider = $6
          AND method = ANY($7::text[])
          AND expires_at_ms > $8
        ORDER BY observed_at_ms DESC NULLS LAST
        LIMIT 1
      `,
      values: [
        input.agentProfileId,
        input.bindingId,
        input.openMeldServiceRuntimeId,
        input.agentControllerRef,
        input.agentControllerConversationId,
        input.provider,
        input.methods,
        normalizeTimestampMs(input.nowMs),
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapProviderConversationProofRow(row) : null;
}
async function readCurrentProviderConversationProof(input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  agentControllerConversationId: string;
  db: PostgresDatabase;
  method: RuntimeProviderConversationProofMethod;
  provider: RuntimeProviderConversationProofProvider;
  openMeldServiceRuntimeId: {
    value: string;
  };
}): Promise<AcceptedProviderConversationProof | null> {
  const row = await input.db
    .query<ProviderConversationProofRow>({
      text: `
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
        FROM "openmeld"."openMeldDaemon_provider_conversation_proofs"
        WHERE agent_profile_id = $1
          AND binding_id = $2
          AND openmeld_service_runtime_id = $3
          AND agent_controller_ref = $4
          AND agent_controller_conversation_id = $5
          AND provider = $6
          AND method = $7
        LIMIT 1
      `,
      values: [
        input.agentProfileId,
        input.bindingId,
        input.openMeldServiceRuntimeId.value,
        input.agentControllerRef,
        input.agentControllerConversationId,
        input.provider,
        input.method,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapProviderConversationProofRow(row) : null;
}
async function updateNewerProviderConversationProof(input: {
  db: PostgresDatabase;
  nowMs: number;
  proof: AcceptedProviderConversationProof;
}): Promise<ProviderConversationProofAcceptanceResult> {
  const updateResult = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_provider_conversation_proofs"
        SET
          status = $1,
          transport_mode = $2,
          intrusive = $3,
          error_code = $4,
          error_type = $5,
          error_message = $6,
          observed_at_ms = $7,
          expires_at_ms = $8,
          updated_at_ms = $9
        WHERE agent_profile_id = $10
          AND binding_id = $11
          AND openmeld_service_runtime_id = $12
          AND agent_controller_ref = $13
          AND agent_controller_conversation_id = $14
          AND provider = $15
          AND method = $16
          AND observed_at_ms < $17
      `,
    values: [
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
      input.proof.observedAtMs,
    ],
  });
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
  db: PostgresDatabase;
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
    (row.method !== "codex_app_server_thread_resume" &&
      row.method !== "codex_app_server_thread_read") ||
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
  db: PostgresDatabase;
  openMeldServiceRuntimeId: string;
}): Promise<boolean> {
  const row = await input.db
    .query<{
      found?: number;
    }>({
      text: `
        SELECT 1 AS found
        FROM "openmeld"."openMeldDaemon_runtime_registry_records"
        WHERE openmeld_service_runtime_id = $1
        LIMIT 1
      `,
      values: [input.openMeldServiceRuntimeId],
    })
    .then((result) => result.rows[0] ?? null);
  return row?.found === 1;
}
function getChangedRows(result: QueryResult): number {
  return Math.max(0, Math.trunc(result.rowCount ?? 0));
}
function normalizeTimestampMs(value: number): number {
  return Math.max(0, Math.trunc(value));
}
