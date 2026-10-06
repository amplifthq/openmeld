import {
  centerAgentConnectorConnectionSelectionSchema,
  type RemoteAgentGitTransferGrant,
  remoteAgentExecutionAccessResponseSchema,
  remoteAgentExecutionScopeKey,
} from "@openmeld/schemas";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";

/** Recheck execution and the represented member's current connection separately.
 * A Center Agent execution has an Agent principal, so its generic source gate
 * cannot authorize a member-owned connection on that principal's behalf. */
export async function authorizeGitTransfer(
  core: RemoteAgentCoreWorkerBinding,
  grant: RemoteAgentGitTransferGrant
) {
  const shared = grant.connectionScope === "shared";
  const authorize = core.authorizeRemoteAgentExecutionAccess;
  const resolveConnection = core.centerAgentResolveConnectorConnection;
  if (!(authorize && resolveConnection)) {
    throw new Error("github.checkout.core_authorization_unavailable");
  }
  const response = remoteAgentExecutionAccessResponseSchema.parse(
    await authorize({
      context: grant.authorization.context,
      submissionId: grant.authorization.submissionId,
      effect: "read",
      ...(grant.authorization.includeDelegatedRequester
        ? {
            includeDelegatedRequester: true,
            sources: grant.authorization.sources,
          }
        : {}),
    })
  );
  if (
    response.submissionId !== grant.authorization.submissionId ||
    remoteAgentExecutionScopeKey(response.scope) !== grant.scopeKey ||
    response.scope.organizationId !== grant.organizationId
  ) {
    throw new Error("github.checkout.transfer_audience_mismatch");
  }
  if (
    grant.authorization.includeDelegatedRequester &&
    (!response.delegatedRequesterSupported ||
      response.delegatedRequester?.userId !== grant.requesterUserId)
  ) {
    throw new Error("github.checkout.delegated_requester_unavailable");
  }
  const selected = centerAgentConnectorConnectionSelectionSchema.parse(
    await resolveConnection({
      context: grant.authorization.context,
      requesterUserId: grant.requesterUserId,
      connectionPreference: shared ? "shared" : "requester",
      service: "github",
      includeAccessPolicy: true,
      ...(grant.authorization.includeDelegatedRequester
        ? { includeDelegatedRequester: true }
        : {}),
    })
  );
  const source = grant.authorization.sources?.[0];
  if (
    selected.selection !== (shared ? "shared" : "requester") ||
    !selected.connection ||
    (selected.permission !== "read" && selected.permission !== "write") ||
    selected.connection.status !== "active" ||
    selected.connection.scope !== (shared ? "shared" : "member") ||
    selected.connection.organizationId !== grant.organizationId ||
    (!shared && selected.connection.userId !== grant.requesterUserId) ||
    selected.connection.connectionName !== source?.connectionName ||
    selected.connection.updatedAtMs !== source.connectionUpdatedAtMs
  ) {
    throw new Error("github.checkout.requester_connection_changed");
  }
  return { ...selected, connection: selected.connection };
}
