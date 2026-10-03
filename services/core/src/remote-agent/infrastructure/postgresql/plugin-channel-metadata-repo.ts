import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type PluginChannelDeliveryMetadata,
  type PluginChannelSelection,
  type PluginChannelSourceProof,
  pluginChannelDeliveryMetadataSchema,
  pluginChannelSelectionSchema,
  pluginChannelSourceProofSchema,
} from "@openmeld/schemas";
import { stringifyCanonicalJson } from "@openmeld/utils";
/** Private metadata belongs to the same row and retention as the native
 * delivery. Never use this JSON as current membership or operation authority. */
export async function readPluginChannelMetadata(
  db: PostgresDatabase,
  deliveryId: string
) {
  const row = await db
    .query<{
      plugin_connection_metadata_json: string | null;
    }>({
      text: 'SELECT plugin_connection_metadata_json FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE delivery_id = $1',
      values: [deliveryId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    throw new Error("plugin.channel.delivery_unavailable");
  }
  return row.plugin_connection_metadata_json === null
    ? null
    : pluginChannelDeliveryMetadataSchema.parse(
        JSON.parse(row.plugin_connection_metadata_json)
      );
}
async function compareAndSet(
  db: PostgresDatabase,
  deliveryId: string,
  previous: PluginChannelDeliveryMetadata | null,
  next: PluginChannelDeliveryMetadata
) {
  const before = previous === null ? null : stringifyCanonicalJson(previous);
  const after = stringifyCanonicalJson(
    pluginChannelDeliveryMetadataSchema.parse(next)
  );
  await db.query({
    text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET plugin_connection_metadata_json = $1 WHERE delivery_id = $2 AND plugin_connection_metadata_json IS NOT DISTINCT FROM $3',
    values: [after, deliveryId, before],
  });
  const current = await readPluginChannelMetadata(db, deliveryId);
  return current;
}
export async function recordPluginChannelAdmission(
  db: PostgresDatabase,
  deliveryId: string,
  input: {
    pluginSourceProof?: PluginChannelSourceProof;
    pluginSelection?: PluginChannelSelection;
  }
) {
  if (input.pluginSelection) {
    await bindPluginChannelExecution(
      db,
      deliveryId,
      input.pluginSelection,
      pluginChannelSourceProofSchema.parse(input.pluginSourceProof)
    );
  } else if (input.pluginSourceProof) {
    await recordPluginChannelSource(db, deliveryId, input.pluginSourceProof);
  }
}
export async function recordPluginChannelSource(
  db: PostgresDatabase,
  deliveryId: string,
  raw: PluginChannelSourceProof
) {
  const proof = pluginChannelSourceProofSchema.parse(raw);
  const before = await readPluginChannelMetadata(db, deliveryId);
  const current =
    before ??
    (await compareAndSet(db, deliveryId, null, {
      v: 1,
      kind: "source",
      proof,
    }));
  if (
    current?.kind !== "source" ||
    stringifyCanonicalJson(current.proof) !== stringifyCanonicalJson(proof)
  ) {
    throw new Error("plugin.channel.source_conflict");
  }
}
export async function issuePluginChannelIntent(
  db: PostgresDatabase,
  deliveryId: string,
  intent: NonNullable<
    Extract<
      PluginChannelDeliveryMetadata,
      {
        kind: "source";
      }
    >["intent"]
  >
) {
  const before = await readPluginChannelMetadata(db, deliveryId);
  if (!before) {
    throw new Error("plugin.channel.source_proof_unavailable");
  }
  const current = before.intent
    ? before
    : await compareAndSet(db, deliveryId, before, { ...before, intent });
  if (
    !current ||
    current.intent?.service !== intent.service ||
    current.intent.scope !== intent.scope
  ) {
    throw new Error("plugin.channel.intent_conflict");
  }
  return current;
}
export async function selectPluginChannelAccount(
  db: PostgresDatabase,
  deliveryId: string,
  raw: PluginChannelSelection
) {
  const selection = pluginChannelSelectionSchema.parse(raw);
  const before = await readPluginChannelMetadata(db, deliveryId);
  if (!before?.intent) {
    throw new Error("plugin.channel.intent_unavailable");
  }
  const current = before.selection
    ? before
    : await compareAndSet(db, deliveryId, before, { ...before, selection });
  if (
    !current ||
    stringifyCanonicalJson(current.selection ?? null) !==
      stringifyCanonicalJson(selection)
  ) {
    throw new Error("plugin.channel.selection_conflict");
  }
  return selection;
}
export async function bindPluginChannelExecution(
  db: PostgresDatabase,
  deliveryId: string,
  raw: PluginChannelSelection,
  proof: PluginChannelSourceProof
) {
  const selection = pluginChannelSelectionSchema.parse(raw);
  const next = {
    v: 1 as const,
    kind: "continuation" as const,
    executionSelection: selection,
    proof: pluginChannelSourceProofSchema.parse(proof),
  };
  const before = await readPluginChannelMetadata(db, deliveryId);
  const current = before ?? (await compareAndSet(db, deliveryId, null, next));
  if (
    current?.kind !== "continuation" ||
    stringifyCanonicalJson(current.executionSelection) !==
      stringifyCanonicalJson(selection) ||
    stringifyCanonicalJson(current.proof) !== stringifyCanonicalJson(proof)
  ) {
    throw new Error("plugin.channel.execution_binding_conflict");
  }
}
