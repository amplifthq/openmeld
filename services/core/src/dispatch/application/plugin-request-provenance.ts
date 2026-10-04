import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { CoreBindings } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
// This reads immutable request provenance, never execution liveness or token
// authority. The authenticated local account remains the calling principal.
export async function readPluginDispatchRequester(input: {
  env: CoreBindings;
  dispatchId: string;
  agentProfileId: string;
  organizationId: string;
}) {
  const ledger = await getPostgresDatabase(input.env)
    ?.query<{
      space_id: string;
      source_event_id: string;
      source_profile_id: string | null;
      source_client_message_id: string | null;
    }>({
      text: 'SELECT space_id, source_event_id, source_profile_id, source_client_message_id FROM "openmeld"."openMeldDaemon_dispatch_ledger" WHERE dispatch_id = $1 AND target_profile_id = $2 LIMIT 1',
      values: [input.dispatchId, input.agentProfileId],
    })
    .then((result) => result.rows[0] ?? null);
  const space =
    ledger &&
    (await getPostgresDatabase(input.env)
      ?.query({
        text: 'SELECT space_id FROM "openmeld"."space_index_spaces" WHERE space_id = $1 AND organization_id = $2',
        values: [ledger.space_id, input.organizationId],
      })
      .then((result) => result.rows[0] ?? null));
  if (!(ledger?.source_profile_id && space)) {
    throw createCoreRpcHttpError({
      code: "plugin.request_provenance_unavailable",
      reason:
        "The Wake requester could not be verified for this Agent and organization.",
      status: 403,
    });
  }
  return {
    profileId: ledger.source_profile_id,
    spaceId: ledger.space_id,
    sourceSignalId: ledger.source_event_id,
    sourceClientMessageId: ledger.source_client_message_id,
  };
}
