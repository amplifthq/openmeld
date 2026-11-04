import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { buildAgentTaskKey } from "@openmeld/schemas";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDeliveryId,
} from "./native-delivery-ledger-repo";

const ledger = '"openmeld"."openMeldRemoteAgent_native_delivery_ledger"';

// A successful scheduling turn is intermediate only when a durable subscription
// will return the final result of this delegation to its original requester.
export async function completeFeishuDelegationHandoff(input: {
  db: PostgresDatabase;
  delivery: RemoteAgentNativeDeliveryRecord;
  nowMs: number;
}) {
  const observer = buildAgentTaskKey({
    v: 1,
    kind: "native_delivery",
    deliveryId: input.delivery.deliveryId,
  });
  const result = await input.db.query({
    text: `UPDATE ${ledger} n SET status = 'completed', callback_received_at_ms = $3,
      completed_at_ms = $3, updated_at_ms = $3
      WHERE n.delivery_id = $1 AND n.status IN ('accepted','retry_observed')
        AND n.message_channel_provider = 'feishu' AND n.routine_run_id IS NULL
        AND n.final_publication_state IS NULL AND
          (n.provider_progress_state IS NULL OR n.provider_progress_state IN ('sent','unavailable','update_claimed'))
        AND EXISTS (
          SELECT 1 FROM "openmeld"."agent_delegations" d
          JOIN "openmeld"."agent_task_completion_subscriptions" s ON s.observer_task_key = d.parent_task_key
            AND s.continuation_json::jsonb->>'delegationId' = d.delegation_id
          WHERE d.organization_id = n.organization_id AND d.parent_task_key = $2
            AND d.state IN ('active','completed') AND d.completion_policy_json::jsonb->>'when' = 'all_terminal'
            AND s.continuation_json::jsonb->>'kind' = 'resume_agent'
            AND s.state IN ('pending','ready','continuation_claimed')
        )`,
    values: [input.delivery.deliveryId, observer, input.nowMs],
  });
  return result.rowCount === 1
    ? readRemoteAgentNativeDeliveryByDeliveryId({
        db: input.db,
        deliveryId: input.delivery.deliveryId,
      })
    : null;
}

// Move the confirmed visible card exactly once. Replayed or competing
// continuations cannot acquire it twice. A higher sequence fences late drafts.
export async function takeFeishuDelegationCard(input: {
  db: PostgresDatabase;
  parentId: string;
  nextId: string;
}) {
  await input.db.query({
    text: `WITH source AS MATERIALIZED (
      SELECT p.* FROM ${ledger} p JOIN ${ledger} n
        ON n.organization_id = p.organization_id AND n.profile_id = p.profile_id
        AND n.space_id = p.space_id AND n.trigger_message_id = p.trigger_message_id
        AND n.message_channel_locator_json::jsonb = p.message_channel_locator_json::jsonb
        AND n.on_behalf_of_profile_id = p.on_behalf_of_profile_id
        AND n.on_behalf_of_user_id = p.on_behalf_of_user_id
      WHERE p.delivery_id = $1 AND n.delivery_id = $2 AND p.delivery_id <> n.delivery_id
        AND p.status = 'completed' AND p.final_publication_state IS NULL
        AND p.message_channel_provider = 'feishu' AND n.message_channel_provider = 'feishu'
        AND p.provider_progress_state IN ('sent','update_claimed')
        AND p.provider_progress_card_id IS NOT NULL AND p.provider_progress_message_id IS NOT NULL
        AND n.status = 'submitted' AND n.provider_progress_state IS NULL
      FOR UPDATE OF p,n
    ), claimed AS (
      UPDATE ${ledger} n SET provider_progress_state = 'sent',
        provider_progress_card_id = p.provider_progress_card_id,
        provider_progress_message_id = p.provider_progress_message_id,
        provider_progress_sequence = GREATEST(p.provider_progress_sequence, p.provider_progress_pending_sequence),
        provider_progress_source_offset = p.provider_progress_source_offset,
        provider_progress_rollover_index = p.provider_progress_rollover_index,
        provider_progress_card_history_json = p.provider_progress_card_history_json
      FROM source p WHERE n.delivery_id = $2 RETURNING p.delivery_id
    ) UPDATE ${ledger} p SET provider_progress_state = NULL, provider_progress_card_id = NULL,
      provider_progress_message_id = NULL, provider_progress_card_history_json = NULL,
      provider_progress_claim_id = NULL, provider_progress_pending_sequence = NULL
      FROM claimed WHERE p.delivery_id = claimed.delivery_id`,
    values: [input.parentId, input.nextId],
  });
}
