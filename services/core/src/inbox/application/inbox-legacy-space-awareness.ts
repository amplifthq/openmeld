import { inboxSourceTargetSchema } from "@openmeld/schemas";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import type { InboxItemRecord } from "../infrastructure/d1/inbox-item-repo";

/** The retired owner-observer writer confused information with urgency. */
export function normalizeLegacySpaceAwareness(
  candidate: InboxSourceCandidate
): InboxSourceCandidate {
  return candidate.sourceKind === "space_signal" &&
    candidate.attention === "update" &&
    candidate.kind === "space_message" &&
    candidate.importance === "urgent" &&
    !candidate.sourceFacts &&
    candidate.sourceTarget.kind === "space" &&
    candidate.sourceTarget.agentOwnerActivity === true
    ? { ...candidate, importance: "normal" }
    : candidate;
}

/** A bounded rollout repair, not a relaxation of general source conflicts. */
export async function repairLegacySpaceAwareness(input: {
  candidate: InboxSourceCandidate;
  db: D1Database;
  existing: InboxItemRecord;
  nowMs: number;
}): Promise<boolean> {
  const { candidate, existing } = input;
  if (
    existing.sourceFactsJson !== null ||
    existing.sourceKind !== "space_signal" ||
    existing.kind !== "space_message" ||
    existing.attention !== "update" ||
    candidate.attention !== "update" ||
    candidate.importance !== "normal" ||
    !["space_message", "space_mention"].includes(candidate.kind) ||
    candidate.sourceTarget.kind !== "space" ||
    (candidate.sourceFacts?.firstContactAgentProfileIds?.length ?? 0) > 0 ||
    candidate.occurredAtMs !== existing.occurredAtMs
  ) {
    return false;
  }
  const target = inboxSourceTargetSchema.parse(
    JSON.parse(existing.sourceTargetJson)
  );
  if (
    target.kind !== "space" ||
    !target.agentOwnerActivity ||
    target.spaceId !== candidate.sourceTarget.spaceId ||
    target.signalId !== candidate.sourceTarget.signalId ||
    target.threadRootSignalId !== candidate.sourceTarget.threadRootSignalId
  ) {
    return false;
  }
  const guard = `id = ? AND source_kind = 'space_signal' AND kind = 'space_message'
    AND attention = 'update' AND source_facts_json IS NULL AND occurred_at_ms = ? AND source_target_json = ?`;
  const bindings = [
    existing.id,
    existing.occurredAtMs,
    existing.sourceTargetJson,
  ];
  const results = await input.db.batch([
    input.db
      .prepare(`UPDATE inbox_email_deliveries SET state = 'suppressed', suppressed_reason = 'item_not_urgent',
      suppressed_at_ms = ?, updated_at_ms = max(updated_at_ms, ?), claim_id = NULL, claim_expires_at_ms = NULL
      WHERE state = 'pending' AND inbox_item_id IN (SELECT id FROM inbox_items WHERE ${guard})`)
      .bind(input.nowMs, input.nowMs, ...bindings),
    input.db
      .prepare(`UPDATE inbox_items SET importance = 'normal', kind = ?, source_target_json = ?, source_facts_json = ?
      WHERE ${guard}`)
      .bind(
        candidate.kind,
        JSON.stringify(candidate.sourceTarget),
        candidate.sourceFacts ? JSON.stringify(candidate.sourceFacts) : null,
        ...bindings
      ),
  ]);
  return Number(results[1]?.meta.changes ?? 0) > 0;
}
