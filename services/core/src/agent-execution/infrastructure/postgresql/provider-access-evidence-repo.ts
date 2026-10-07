import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  openMeldDaemonProviderAccessEvidenceProviderSchema,
  parseAgentControllerRef,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonProviderAccessEvidence,
  OpenMeldDaemonProviderAccessEvidenceProvider,
} from "@openmeld/schemas/types";
import { PROVIDER_ACCESS_EVIDENCE_TTL_MS } from "../../../strategy-constants";
export type ProviderAccessExecutionIdentity = {
  bindingId: string;
  agentControllerRef: string;
  openMeldServiceRuntimeId: string;
};
export type FreshProviderAccessEvidence = {
  expiresAtMs: number;
  observedAtMs: number;
  provider: OpenMeldDaemonProviderAccessEvidenceProvider;
  reasonCode: OpenMeldDaemonProviderAccessEvidence["reasonCode"];
  source: "wake_failure";
};
type ProviderAccessEvidenceRow = {
  expiresAtMs?: unknown;
  observedAtMs?: unknown;
  provider?: unknown;
  reasonCode?: unknown;
  source?: unknown;
};
type ProviderAccessBindingIdentity = ProviderAccessExecutionIdentity & {
  agentProfileId: string;
};
const PROVIDER_ACCESS_SUCCESS_WATERMARK_REASON_CODE =
  "provider_account.access_confirmed";
const PROVIDER_ACCESS_SUCCESS_WATERMARK_SOURCE = "wake_success";
export const writeAcceptedProviderAccessFailureEvidence = async (input: {
  agentProfileId: string;
  db: PostgresDatabase;
  evidence: OpenMeldDaemonProviderAccessEvidence;
  executionIdentity: ProviderAccessExecutionIdentity;
  observedAtMs: number;
  sourceAttemptId: string;
  sourceDispatchId: string;
}): Promise<"written" | "not_applicable"> => {
  if (!isProviderAccessEvidenceApplicable(input)) {
    return "not_applicable";
  }
  const observedAtMs = normalizeTimestampMs(input.observedAtMs);
  const expiresAtMs = observedAtMs + PROVIDER_ACCESS_EVIDENCE_TTL_MS;
  const evidenceId = buildProviderAccessEvidenceId({
    agentProfileId: input.agentProfileId,
    executionIdentity: input.executionIdentity,
    provider: input.evidence.provider,
  });
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_provider_access_evidence" (
          evidence_id,
          provider,
          agent_profile_id,
          binding_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          reason_code,
          source,
          source_dispatch_id,
          source_attempt_id,
          observed_at_ms,
          expires_at_ms,
          cleared_at_ms,
          cleared_by_dispatch_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NULL, $13, $14)
        ON CONFLICT(agent_profile_id, binding_id, openmeld_service_runtime_id, agent_controller_ref, provider)
        DO UPDATE SET
          reason_code = excluded.reason_code,
          source = excluded.source,
          source_dispatch_id = excluded.source_dispatch_id,
          source_attempt_id = excluded.source_attempt_id,
          observed_at_ms = excluded.observed_at_ms,
          expires_at_ms = excluded.expires_at_ms,
          cleared_at_ms = NULL,
          cleared_by_dispatch_id = NULL,
          updated_at_ms = excluded.updated_at_ms
        WHERE
          excluded.observed_at_ms > GREATEST(
            "openMeldDaemon_provider_access_evidence".observed_at_ms,
            COALESCE(
              "openMeldDaemon_provider_access_evidence".cleared_at_ms,
              "openMeldDaemon_provider_access_evidence".observed_at_ms
            )
          )
          OR (
            excluded.observed_at_ms = GREATEST(
              "openMeldDaemon_provider_access_evidence".observed_at_ms,
              COALESCE(
                "openMeldDaemon_provider_access_evidence".cleared_at_ms,
                "openMeldDaemon_provider_access_evidence".observed_at_ms
              )
            )
            AND "openMeldDaemon_provider_access_evidence".cleared_at_ms IS NOT NULL
          )
      `,
    values: [
      evidenceId,
      input.evidence.provider,
      input.agentProfileId,
      input.executionIdentity.bindingId,
      input.executionIdentity.openMeldServiceRuntimeId,
      input.executionIdentity.agentControllerRef,
      input.evidence.reasonCode,
      input.evidence.source,
      input.sourceDispatchId,
      input.sourceAttemptId,
      observedAtMs,
      expiresAtMs,
      observedAtMs,
      observedAtMs,
    ],
  });
  return "written";
};
export const clearProviderAccessFailureEvidenceForExecutionSuccess =
  async (input: {
    agentProfileId: string;
    clearedAtMs: number;
    db: PostgresDatabase;
    executionIdentity: ProviderAccessExecutionIdentity;
    sourceAttemptId: string;
    sourceDispatchId: string;
  }): Promise<"cleared" | "not_applicable"> => {
    const provider = providerForExecutionIdentity(input.executionIdentity);
    if (!provider) {
      return "not_applicable";
    }
    const clearedAtMs = normalizeTimestampMs(input.clearedAtMs);
    const evidenceId = buildProviderAccessEvidenceId({
      agentProfileId: input.agentProfileId,
      executionIdentity: input.executionIdentity,
      provider,
    });
    await input.db.query({
      text: `
        INSERT INTO "openmeld"."openMeldDaemon_provider_access_evidence" (
          evidence_id,
          provider,
          agent_profile_id,
          binding_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          reason_code,
          source,
          source_dispatch_id,
          source_attempt_id,
          observed_at_ms,
          expires_at_ms,
          cleared_at_ms,
          cleared_by_dispatch_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT(agent_profile_id, binding_id, openmeld_service_runtime_id, agent_controller_ref, provider)
        DO UPDATE SET
          reason_code = excluded.reason_code,
          source = excluded.source,
          source_dispatch_id = excluded.source_dispatch_id,
          source_attempt_id = excluded.source_attempt_id,
          observed_at_ms = excluded.observed_at_ms,
          expires_at_ms = excluded.expires_at_ms,
          cleared_at_ms = excluded.cleared_at_ms,
          cleared_by_dispatch_id = excluded.cleared_by_dispatch_id,
          updated_at_ms = excluded.updated_at_ms
        WHERE excluded.cleared_at_ms > GREATEST(
          "openMeldDaemon_provider_access_evidence".observed_at_ms,
          COALESCE(
            "openMeldDaemon_provider_access_evidence".cleared_at_ms,
            "openMeldDaemon_provider_access_evidence".observed_at_ms
          )
        )
      `,
      values: [
        evidenceId,
        provider,
        input.agentProfileId,
        input.executionIdentity.bindingId,
        input.executionIdentity.openMeldServiceRuntimeId,
        input.executionIdentity.agentControllerRef,
        PROVIDER_ACCESS_SUCCESS_WATERMARK_REASON_CODE,
        PROVIDER_ACCESS_SUCCESS_WATERMARK_SOURCE,
        input.sourceDispatchId,
        input.sourceAttemptId,
        clearedAtMs,
        clearedAtMs,
        clearedAtMs,
        input.sourceDispatchId,
        clearedAtMs,
        clearedAtMs,
      ],
    });
    return "cleared";
  };
export const readFreshProviderAccessEvidenceForBinding = async (input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  db: PostgresDatabase;
  nowMs: number;
  openMeldServiceRuntimeId: string;
}): Promise<FreshProviderAccessEvidence | null> => {
  const provider = providerForExecutionIdentity(input);
  if (!provider) {
    return null;
  }
  const row = await input.db
    .query<ProviderAccessEvidenceRow>({
      text: `
        SELECT
          provider,
          reason_code AS "reasonCode",
          source,
          observed_at_ms AS "observedAtMs",
          expires_at_ms AS "expiresAtMs"
        FROM "openmeld"."openMeldDaemon_provider_access_evidence"
        WHERE agent_profile_id = $1
          AND binding_id = $2
          AND openmeld_service_runtime_id = $3
          AND agent_controller_ref = $4
          AND provider = $5
          AND cleared_at_ms IS NULL
          AND expires_at_ms > $6
        ORDER BY observed_at_ms DESC NULLS LAST
        LIMIT 1
      `,
      values: [
        input.agentProfileId,
        input.bindingId,
        input.openMeldServiceRuntimeId,
        input.agentControllerRef,
        provider,
        normalizeTimestampMs(input.nowMs),
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    return null;
  }
  return normalizeFreshProviderAccessEvidenceRow(row, provider);
};
export async function readFreshProviderAccessEvidenceForBindings(input: {
  bindings: readonly ProviderAccessBindingIdentity[];
  db: PostgresDatabase;
  nowMs: number;
}): Promise<(FreshProviderAccessEvidence & ProviderAccessBindingIdentity)[]> {
  const bindings = input.bindings.flatMap((binding) => {
    const provider = providerForExecutionIdentity(binding);
    return provider ? [{ ...binding, provider }] : [];
  });
  if (bindings.length === 0) {
    return [];
  }
  const result = await input.db.query<
    ProviderAccessEvidenceRow & ProviderAccessBindingIdentity
  >({
    text: `
      SELECT evidence.agent_profile_id AS "agentProfileId",
        evidence.binding_id AS "bindingId",
        evidence.openmeld_service_runtime_id AS "openMeldServiceRuntimeId",
        evidence.agent_controller_ref AS "agentControllerRef",
        evidence.provider, evidence.reason_code AS "reasonCode", evidence.source,
        evidence.observed_at_ms AS "observedAtMs", evidence.expires_at_ms AS "expiresAtMs"
      FROM "openmeld"."openMeldDaemon_provider_access_evidence" AS evidence
      JOIN UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
        AS requested(profile_id, binding_id, runtime_id, controller_ref, provider)
        ON evidence.agent_profile_id = requested.profile_id
        AND evidence.binding_id = requested.binding_id
        AND evidence.openmeld_service_runtime_id = requested.runtime_id
        AND evidence.agent_controller_ref = requested.controller_ref
        AND evidence.provider = requested.provider
      WHERE evidence.cleared_at_ms IS NULL AND evidence.expires_at_ms > $6
      ORDER BY evidence.observed_at_ms DESC NULLS LAST
    `,
    values: [
      bindings.map((binding) => binding.agentProfileId),
      bindings.map((binding) => binding.bindingId),
      bindings.map((binding) => binding.openMeldServiceRuntimeId),
      bindings.map((binding) => binding.agentControllerRef),
      bindings.map((binding) => binding.provider),
      normalizeTimestampMs(input.nowMs),
    ],
  });
  return result.rows.flatMap((row) => {
    const provider = providerForExecutionIdentity(row);
    const evidence = provider
      ? normalizeFreshProviderAccessEvidenceRow(row, provider)
      : null;
    return evidence ? [{ ...row, ...evidence }] : [];
  });
}
function normalizeFreshProviderAccessEvidenceRow(
  row: ProviderAccessEvidenceRow,
  provider: OpenMeldDaemonProviderAccessEvidenceProvider
): FreshProviderAccessEvidence | null {
  const reasonCode = normalizeProviderAccessReasonCode(row.reasonCode);
  const observedAtMs = parseTimestampMs(row.observedAtMs);
  const expiresAtMs = parseTimestampMs(row.expiresAtMs);
  if (
    row.provider !== provider ||
    row.source !== "wake_failure" ||
    !reasonCode ||
    observedAtMs === null ||
    expiresAtMs === null
  ) {
    return null;
  }
  return {
    expiresAtMs,
    observedAtMs,
    provider,
    reasonCode,
    source: "wake_failure",
  };
}
function isProviderAccessEvidenceApplicable(input: {
  evidence: OpenMeldDaemonProviderAccessEvidence;
  executionIdentity: ProviderAccessExecutionIdentity;
}): boolean {
  return (
    input.evidence.source === "wake_failure" &&
    providerForExecutionIdentity(input.executionIdentity) ===
      input.evidence.provider
  );
}
function providerForExecutionIdentity(input: {
  agentControllerRef: string;
}): OpenMeldDaemonProviderAccessEvidenceProvider | null {
  const agentControllerRef = parseAgentControllerRef(input.agentControllerRef);
  if (agentControllerRef?.kind !== "builtin") {
    return null;
  }
  const provider = openMeldDaemonProviderAccessEvidenceProviderSchema.safeParse(
    agentControllerRef.id
  );
  return provider.success ? provider.data : null;
}
function normalizeProviderAccessReasonCode(
  value: unknown
): OpenMeldDaemonProviderAccessEvidence["reasonCode"] | null {
  if (
    value === "usage_exhausted" ||
    value === "provider_account.capacity_exhausted" ||
    value === "provider_account.organization_access_disabled" ||
    value === "provider_account.subscription_access_unavailable"
  ) {
    return value;
  }
  return null;
}
function buildProviderAccessEvidenceId(input: {
  agentProfileId: string;
  executionIdentity: ProviderAccessExecutionIdentity;
  provider: OpenMeldDaemonProviderAccessEvidenceProvider;
}): string {
  return [
    "provider_access",
    input.provider,
    input.agentProfileId,
    input.executionIdentity.bindingId,
    input.executionIdentity.openMeldServiceRuntimeId,
    input.executionIdentity.agentControllerRef,
  ].join(":");
}
function normalizeTimestampMs(value: number): number {
  return Math.max(0, Math.trunc(value));
}
function parseTimestampMs(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
