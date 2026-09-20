import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import {
  pluginAccessListRpcInputSchema,
  pluginAccessUpdateRpcInputSchema,
} from "@openmeld/schemas";
import type {
  PluginAccessListRpcInput,
  PluginAccessUpdateRpcInput,
} from "@openmeld/schemas/types";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { listConnectorConnections } from "./connector-connection-repository";
import { readPluginAccess, updatePluginAccess } from "./plugin-access";

export async function rpcListPluginAccess(
  env: CoreBindings,
  input: PluginAccessListRpcInput
) {
  const request = pluginAccessListRpcInputSchema.parse(input);
  const { db, member, canManageShared } = await prepareRequest(env, request);
  const connections = await listConnectorConnections({
    db,
    organizationId: member.organizationId,
    service: request.service,
    userId: member.userId,
  });
  return {
    organizationId: member.organizationId,
    connections: await Promise.all(
      connections
        .filter((connection) => connection.status === "active")
        .map(async (connection) => ({
          connectionName: connection.connectionName,
          scope: connection.scope,
          canManage:
            connection.scope === "shared"
              ? canManageShared
              : connection.userId === member.userId,
          ...(await readPluginAccess({
            db,
            organizationId: member.organizationId,
            connectionName: connection.connectionName,
          })),
        }))
    ),
  };
}

export async function rpcUpdatePluginAccess(
  env: CoreBindings,
  input: PluginAccessUpdateRpcInput
) {
  const request = pluginAccessUpdateRpcInputSchema.parse(input);
  const { db, member, canManageShared } = await prepareRequest(env, request);
  const connections = await listConnectorConnections({
    db,
    organizationId: member.organizationId,
    service: request.service,
    userId: member.userId,
  });
  const connection = connections.find(
    (candidate) => candidate.connectionName === request.connectionName
  );
  if (
    !(
      connection &&
      (connection.scope === "shared"
        ? canManageShared
        : connection.userId === member.userId)
    )
  ) {
    throw createCoreRpcHttpError({
      code: "plugin.access_manage_forbidden",
      reason:
        "Only the account owner can manage personal access. Organization owners and admins manage shared access.",
      status: 403,
    });
  }
  const updated = await updatePluginAccess({
    ...request,
    db,
    organizationId: member.organizationId,
    actorProfileId: request.context.actorContext.openMeldProfileId,
    actorUserId: member.userId,
  });
  return {
    connectionName: connection.connectionName,
    scope: connection.scope,
    canManage: true,
    ...updated,
  };
}

async function prepareRequest(
  env: CoreBindings,
  request: PluginAccessListRpcInput
) {
  if (request.context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "plugin.human_required",
      reason: "Manage plugin access from your account in Plugins.",
      status: 403,
    });
  }
  const member = await resolveActiveOrganizationMembership({
    env,
    context: request.context,
  });
  if (!member.ok) {
    throw createCoreRpcHttpError({
      code: member.code,
      reason: member.message,
      status: member.status,
    });
  }
  requireExpectedOrganizationContext({
    actualOrganizationId: member.organizationId,
    expectedOrganizationId: request.expectedOrganizationId,
    errorCode: "connector.organization_context_changed",
  });
  const db = identityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "plugin.state_unavailable",
      reason: "Plugin access is unavailable. Try again.",
      status: 503,
    });
  }
  return {
    db,
    member,
    canManageShared: memberRoleHasOrganizationPermission(member.role, {
      connector: ["manage"],
    }),
  };
}
