import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import type { InboxItemRecord } from "../infrastructure/postgresql/inbox-item-repo";
/** Only the original source replay may enrich its old request-kind facts. */
export async function repairLegacyInteractionAttention(input: {
  candidate: InboxSourceCandidate;
  existing: InboxItemRecord;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<boolean> {
  const { candidate, existing } = input;
  if (
    !(
      candidate.sourceFacts?.requestCategory &&
      candidate.sourceFacts.recipientReasons.includes("requester")
    )
  ) {
    return false;
  }
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
  const guard = (
    offset: number
  ) => `id = $${offset + 1} AND organization_id = $${offset + 2} AND recipient_user_id = $${offset + 3}
    AND source_kind = $${offset + 4} AND source_key = $${offset + 5}
    AND kind = $${offset + 6} AND attention = 'action_required'
    AND source_facts_json IS NULL AND source_target_json = $${offset + 7} AND occurred_at_ms = $${offset + 8}`;
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
  const results = await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `UPDATE "openmeld"."inbox_email_deliveries" SET state = 'suppressed', suppressed_reason = 'item_not_urgent',
      suppressed_at_ms = $1, updated_at_ms = GREATEST(updated_at_ms, $2), claim_id = NULL, claim_expires_at_ms = NULL
      WHERE state = 'pending' AND $3 = 'normal' AND inbox_item_id IN (SELECT id FROM "openmeld"."inbox_items" WHERE ${guard(3)})`,
          values: [input.nowMs, input.nowMs, candidate.importance, ...bindings],
        }),
        await client.query({
          text: `UPDATE "openmeld"."inbox_items" SET importance = $1, source_facts_json = $2 WHERE ${guard(2)}`,
          values: [
            candidate.importance,
            candidate.sourceFacts
              ? JSON.stringify(candidate.sourceFacts)
              : null,
            ...bindings,
          ],
        }),
      ] as const
  );
  return Number(results[1].rowCount ?? 0) > 0;
}

/**
 * An Agent's question was filed as a review before it became an action for
 * every kind (member-agent-program.md §4.6). Its own source replay moves the
 * item to Needs action; nothing else about the item may differ.
 */
export async function repairInteractionReviewCategory(input: {
  candidate: InboxSourceCandidate;
  existing: InboxItemRecord;
  db: PostgresDatabase;
}): Promise<boolean> {
  const { candidate, existing } = input;
  if (
    !(
      candidate.sourceKind === "runtime_coordinator_interaction" &&
      candidate.kind === "agent_interaction" &&
      candidate.sourceFacts?.requestCategory === "action" &&
      existing.sourceFactsJson &&
      existing.sourceKind === candidate.sourceKind &&
      existing.kind === candidate.kind &&
      existing.attention === candidate.attention &&
      existing.importance === candidate.importance &&
      existing.occurredAtMs === candidate.occurredAtMs &&
      existing.sourceTargetJson === JSON.stringify(candidate.sourceTarget)
    ) ||
    existing.sourceFactsJson !==
      JSON.stringify({ ...candidate.sourceFacts, requestCategory: "review" })
  ) {
    return false;
  }
  const result = await input.db.query({
    text: `UPDATE "openmeld"."inbox_items" SET source_facts_json = $1
      WHERE id = $2 AND organization_id = $3 AND recipient_user_id = $4
        AND source_kind = $5 AND source_key = $6 AND source_facts_json = $7`,
    values: [
      JSON.stringify(candidate.sourceFacts),
      existing.id,
      candidate.organizationId,
      candidate.recipientUserId,
      candidate.sourceKind,
      candidate.sourceKey,
      existing.sourceFactsJson,
    ],
  });
  return Number(result.rowCount ?? 0) > 0;
}
