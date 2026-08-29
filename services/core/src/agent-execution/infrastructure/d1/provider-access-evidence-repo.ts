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

const PROVIDER_ACCESS_SUCCESS_WATERMARK_REASON_CODE =
  "provider_account.access_confirmed";
const PROVIDER_ACCESS_SUCCESS_WATERMARK_SOURCE = "wake_success";

export const writeAcceptedProviderAccessFailureEvidence = async (input: {
  agentProfileId: string;
  db: D1Database;
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

  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_provider_access_evidence (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
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
          excluded.observed_at_ms > MAX(
            openMeldDaemon_provider_access_evidence.observed_at_ms,
            COALESCE(
              openMeldDaemon_provider_access_evidence.cleared_at_ms,
              openMeldDaemon_provider_access_evidence.observed_at_ms
            )
          )
          OR (
            excluded.observed_at_ms = MAX(
              openMeldDaemon_provider_access_evidence.observed_at_ms,
              COALESCE(
                openMeldDaemon_provider_access_evidence.cleared_at_ms,
                openMeldDaemon_provider_access_evidence.observed_at_ms
              )
            )
            AND openMeldDaemon_provider_access_evidence.cleared_at_ms IS NOT NULL
          )
      `
    )
    .bind(
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
      observedAtMs
    )
    .run();

  return "written";
};

export const clearProviderAccessFailureEvidenceForExecutionSuccess =
  async (input: {
    agentProfileId: string;
    clearedAtMs: number;
    db: D1Database;
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
    await input.db
      .prepare(
        `
        INSERT INTO openMeldDaemon_provider_access_evidence (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        WHERE excluded.cleared_at_ms > MAX(
          openMeldDaemon_provider_access_evidence.observed_at_ms,
          COALESCE(
            openMeldDaemon_provider_access_evidence.cleared_at_ms,
            openMeldDaemon_provider_access_evidence.observed_at_ms
          )
        )
      `
      )
      .bind(
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
        clearedAtMs
      )
      .run();
    return "cleared";
  };

export const readFreshProviderAccessEvidenceForBinding = async (input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  db: D1Database;
  nowMs: number;
  openMeldServiceRuntimeId: string;
}): Promise<FreshProviderAccessEvidence | null> => {
  const provider = providerForExecutionIdentity(input);
  if (!provider) {
    return null;
  }
  const row = await input.db
    .prepare(
      `
        SELECT
          provider,
          reason_code AS reasonCode,
          source,
          observed_at_ms AS observedAtMs,
          expires_at_ms AS expiresAtMs
        FROM openMeldDaemon_provider_access_evidence
        WHERE agent_profile_id = ?
          AND binding_id = ?
          AND openmeld_service_runtime_id = ?
          AND agent_controller_ref = ?
          AND provider = ?
          AND cleared_at_ms IS NULL
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
      provider,
      normalizeTimestampMs(input.nowMs)
    )
    .first<{
      expiresAtMs?: unknown;
      observedAtMs?: unknown;
      provider?: unknown;
      reasonCode?: unknown;
      source?: unknown;
    }>();

  if (!row) {
    return null;
  }
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
};

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
