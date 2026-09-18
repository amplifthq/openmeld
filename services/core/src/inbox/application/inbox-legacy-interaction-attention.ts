import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import type { InboxItemRecord } from "../infrastructure/d1/inbox-item-repo";

/** Only the original source replay may enrich its old request-kind facts. */
export async function repairLegacyInteractionAttention(input: {
  candidate: InboxSourceCandidate;
  existing: InboxItemRecord;
  db: D1Database;
  nowMs: number;
}): Promise<boolean> {
  const { candidate, existing } = input;
  const localInteraction =
    candidate.sourceKind === "runtime_coordinator_interaction" &&
    candidate.kind === "agent_interaction" &&
    candidate.importance === "normal";
  const workRecovery =
    candidate.sourceKind === "agent_profile_work_recovery" &&
    candidate.kind === "system_issue" &&
    candidate.importance === existing.importance;
  if (
    !(localInteraction || workRecovery) ||
    candidate.attention !== "action_required" ||
    existing.sourceFactsJson !== null ||
    existing.sourceKind !== candidate.sourceKind ||
    existing.kind !== candidate.kind ||
    existing.attention !== candidate.attention ||
    existing.occurredAtMs !== candidate.occurredAtMs ||
    existing.sourceTargetJson !== JSON.stringify(candidate.sourceTarget)
  ) {
    return false;
  }
  const guard = `id = ? AND organization_id = ? AND recipient_user_id = ?
    AND source_kind = ? AND source_key = ?
    AND kind = ? AND attention = 'action_required'
    AND source_facts_json IS NULL AND source_target_json = ? AND occurred_at_ms = ?`;
  const bindings = [
    existing.id,
    candidate.organizationId,
    candidate.recipientUserId,
    candidate.sourceKind,
    candidate.sourceKey,
    candidate.kind,
    existing.sourceTargetJson,
    candidate.occurredAtMs,
  ];
  const results = await input.db.batch([
    input.db
      .prepare(`UPDATE inbox_email_deliveries SET state = 'suppressed', suppressed_reason = 'item_not_urgent',
      suppressed_at_ms = ?, updated_at_ms = max(updated_at_ms, ?), claim_id = NULL, claim_expires_at_ms = NULL
      WHERE state = 'pending' AND ? = 'normal' AND inbox_item_id IN (SELECT id FROM inbox_items WHERE ${guard})`)
      .bind(input.nowMs, input.nowMs, candidate.importance, ...bindings),
    input.db
      .prepare(
        `UPDATE inbox_items SET importance = ?, source_facts_json = ? WHERE ${guard}`
      )
      .bind(
        candidate.importance,
        candidate.sourceFacts ? JSON.stringify(candidate.sourceFacts) : null,
        ...bindings
      ),
  ]);
  return Number(results[1]?.meta.changes ?? 0) > 0;
}
