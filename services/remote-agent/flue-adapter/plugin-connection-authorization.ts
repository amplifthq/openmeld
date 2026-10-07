import {
  centerAgentConnectorConnectionSelectionSchema,
  type PluginConnectionGrant,
  pluginConnectionAuthorizationSchema,
  pluginConnectionGrantSchema,
  type RemoteAgentGitTransferGrant,
  remoteAgentExecutionAccessResponseSchema,
  remoteAgentExecutionScopeKey,
} from "@openmeld/schemas";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";

/** The Computer holds no provider credentials. Every request rechecks its original authority. */
export async function authorizePluginConnection(
  core: RemoteAgentCoreWorkerBinding,
  value: PluginConnectionGrant
) {
  const grant = pluginConnectionGrantSchema.parse(value);
  if (grant.expiresAtMs <= Date.now()) {
    throw new Error("plugin.connection_expired");
  }
  if (grant.authority.kind === "local") {
    if (!core.authorizeLocalPluginConnection) {
      throw new Error("plugin.authorization_unavailable");
    }
    const selected = pluginConnectionAuthorizationSchema.parse(
      await core.authorizeLocalPluginConnection(grant.authority.request)
    );
    return requireSameConnection(grant, selected);
  }
  const { authorization, scopeKey } = grant.authority;
  // Exact-action delegations cannot authorize a general native API session.
  if (
    authorization.includeDelegatedRequester ||
    authorization.effect !== "read"
  ) {
    throw new Error("plugin.native_delegation_not_supported");
  }
  const selected = await authorizeRemotePluginConnection(
    core,
    { ...grant, authorization, scopeKey },
    grant.service
  );
  return requireSameConnection(grant, selected);
}

/** Recheck execution and the represented member's current connection separately.
 * A Center Agent execution has an Agent principal, so its generic source gate
 * cannot authorize a member-owned connection on that principal's behalf. */
export async function authorizeRemotePluginConnection(
  core: RemoteAgentCoreWorkerBinding,
  grant: Pick<
    RemoteAgentGitTransferGrant,
    | "connectionScope"
    | "authorization"
    | "scopeKey"
    | "organizationId"
    | "requesterUserId"
  >,
  service: string
) {
  const shared = grant.connectionScope === "shared";
  const authorize = core.authorizeRemoteAgentExecutionAccess;
  const resolveConnection = core.centerAgentResolveConnectorConnection;
  if (!(authorize && resolveConnection)) {
    throw new Error("plugin.connection.core_authorization_unavailable");
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
    throw new Error("plugin.connection.transfer_audience_mismatch");
  }
  if (
    grant.authorization.includeDelegatedRequester &&
    (!response.delegatedRequesterSupported ||
      response.delegatedRequester?.userId !== grant.requesterUserId)
  ) {
    throw new Error("plugin.connection.delegated_requester_unavailable");
  }
  const selected = centerAgentConnectorConnectionSelectionSchema.parse(
    await resolveConnection({
      context: grant.authorization.context,
      requesterUserId: grant.requesterUserId,
      connectionPreference: shared ? "shared" : "requester",
      service,
      includeAccessPolicy: true,
      ...(grant.authorization.includeDelegatedRequester
        ? { includeDelegatedRequester: true }
        : {}),
    })
  );
  const source = grant.authorization.sources?.[0];
  if (
    source?.kind !== "plugin_connection" ||
    source.service !== service ||
    selected.selection !== (shared ? "shared" : "requester") ||
    !selected.connection ||
    (selected.permission !== "read" && selected.permission !== "write") ||
    selected.connection.status !== "active" ||
    selected.connection.service !== service ||
    selected.connection.scope !== (shared ? "shared" : "member") ||
    selected.connection.organizationId !== grant.organizationId ||
    (!shared && selected.connection.userId !== grant.requesterUserId) ||
    selected.connection.connectionName !== source?.connectionName ||
    selected.connection.updatedAtMs !== source.connectionUpdatedAtMs
  ) {
    throw new Error("plugin.connection.requester_connection_changed");
  }
  return { ...selected, connection: selected.connection };
}

function requireSameConnection(
  grant: PluginConnectionGrant,
  selected: {
    connection:
      | ReturnType<
          typeof pluginConnectionAuthorizationSchema.parse
        >["connection"]
      | null;
    permission?: "read" | "write";
  }
) {
  const connection = selected.connection;
  if (
    !connection ||
    (selected.permission !== "read" && selected.permission !== "write") ||
    connection.status !== "active" ||
    connection.service !== grant.service ||
    connection.organizationId !== grant.organizationId ||
    connection.scope !== grant.connectionScope ||
    connection.connectionName !== grant.connectionName ||
    connection.updatedAtMs !== grant.connectionUpdatedAtMs ||
    (connection.scope === "member" &&
      connection.userId !== grant.requesterUserId)
  ) {
    throw new Error("plugin.connection_changed");
  }
  return connection;
}
