import {
  type CoreBindings,
  identityDb,
  wakeEvidenceDb,
} from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";

// This reads immutable request provenance, never execution liveness or token
// authority. The authenticated local account remains the calling principal.
export async function readPluginDispatchRequester(input: {
  env: CoreBindings;
  dispatchId: string;
  agentProfileId: string;
  organizationId: string;
}) {
  const ledger = await wakeEvidenceDb(input.env)
    ?.prepare(
      "SELECT space_id, source_profile_id FROM openMeldDaemon_dispatch_ledger WHERE dispatch_id = ? AND target_profile_id = ? LIMIT 1"
    )
    .bind(input.dispatchId, input.agentProfileId)
    .first<{ space_id: string; source_profile_id: string | null }>();
  const space =
    ledger &&
    (await identityDb(input.env)
      ?.prepare(
        "SELECT space_id FROM space_index_spaces WHERE space_id = ? AND organization_id = ?"
      )
      .bind(ledger.space_id, input.organizationId)
      .first());
  if (!(ledger?.source_profile_id && space)) {
    throw createCoreRpcHttpError({
      code: "plugin.request_provenance_unavailable",
      reason:
        "The Wake requester could not be verified for this Agent and organization.",
      status: 403,
    });
  }
  return { profileId: ledger.source_profile_id, spaceId: ledger.space_id };
}
