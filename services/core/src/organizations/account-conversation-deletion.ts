import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  buildPersonalRemoteAgentConversationId,
  buildRemoteAgentRoutineRunConversationId,
  buildRemoteAgentRuntimeConversationId,
} from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import { requestRemoteAgentNativeDeliveryStop } from "../remote-agent/application/native-delivery-cancellation-service";
import { readRemoteAgentConversationGeneration } from "../remote-agent/infrastructure/postgresql/conversation-generation-repo";
import { readRemoteAgentNativeDeliveryByIdempotencyKey } from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";

/** Only called after the owning Space has verified the accepted deletion scope. */
export async function stopAccountConversation(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  spaceId: string;
}): Promise<void> {
  const active = (
    await input.db.query<{ idempotency_key: string }>({
      text: `SELECT idempotency_key FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE space_id = $1 AND status IN ('submitted', 'accepted', 'retry_observed')`,
      values: [input.spaceId],
    })
  ).rows;
  for (const row of active) {
    const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: input.db,
      idempotencyKey: row.idempotency_key,
    });
    if (delivery) {
      await requestRemoteAgentNativeDeliveryStop({
        ...input,
        delivery,
        nowMs: Date.now(),
      });
    }
  }
}

export async function eraseAccountConversation(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  organizationId: string;
  spaceId: string;
  deleteSharedComputer: boolean;
}): Promise<void> {
  const rows = (
    await input.db.query<{ profile_id: string; routine_run_id: string | null }>(
      {
        text: `SELECT DISTINCT profile_id, routine_run_id FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = $1 AND space_id = $2`,
        values: [input.organizationId, input.spaceId],
      }
    )
  ).rows;
  const logicalIds = new Set([input.spaceId]);
  for (const row of rows) {
    logicalIds.add(
      buildPersonalRemoteAgentConversationId({
        ...input,
        agentProfileId: row.profile_id,
      })
    );
    if (row.routine_run_id) {
      logicalIds.add(
        buildRemoteAgentRoutineRunConversationId({
          ...input,
          agentProfileId: row.profile_id,
          runId: row.routine_run_id,
        })
      );
    }
  }
  const worker = input.env.OPENMELD_REMOTE_AGENT_WORKER;
  if (!worker?.eraseAccountConversation) {
    throw new Error("Remote conversation cleanup is unavailable.");
  }
  for (const logicalConversationId of logicalIds) {
    const current = await readRemoteAgentConversationGeneration({
      db: input.db,
      organizationId: input.organizationId,
      logicalConversationId,
    });
    for (let generation = 0; generation <= current.generation; generation++) {
      await worker.eraseAccountConversation({
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        runtimeConversationId: buildRemoteAgentRuntimeConversationId({
          ...input,
          logicalConversationId,
          generation,
        }),
        deleteSharedComputer: input.deleteSharedComputer,
      });
    }
  }
  await input.db.query({
    text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = $1 AND space_id = $2',
    values: [input.organizationId, input.spaceId],
  });
  await input.db.query({
    text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_conversation_generations" WHERE organization_id = $1 AND logical_conversation_id = ANY($2::text[])',
    values: [input.organizationId, [...logicalIds]],
  });
}
