import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";

export const REMOTE_AGENT_ACTIVE_EXECUTION_EVIDENCE_FRESHNESS_MS = 30 * 60_000;

export function resolveFreshRemoteAgentNativeDeliveryExecutionEvidenceAtMs(input: {
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    "executionEvidenceAtMs" | "status"
  >;
  nowMs: number;
}): number | null {
  const evidenceAtMs = input.delivery.executionEvidenceAtMs;
  if (
    (input.delivery.status === "accepted" ||
      input.delivery.status === "retry_observed") &&
    evidenceAtMs !== null &&
    evidenceAtMs <= input.nowMs &&
    evidenceAtMs >=
      input.nowMs - REMOTE_AGENT_ACTIVE_EXECUTION_EVIDENCE_FRESHNESS_MS
  ) {
    return evidenceAtMs;
  }
  return null;
}
