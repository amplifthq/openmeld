import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  remoteAgentExecutionAccessRequestSchema,
  remoteAgentExecutionAccessResponseSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { readPrimaryAgentProfileBindingRecord } from "../../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { requireDelegatedPluginAction } from "../../center-agent/application/delegated-plugin-authorization";
import { ensurePersonalComputer } from "../../computer/personal-computer";
import { requireRemotePluginConnection } from "../../connectors/plugin-access";
import type { CoreBindings } from "../../lib/bindings";
import { resolveOrganizationMembershipById } from "../../organizations/organization-context";
import { rpcGetSpaceMemberDirectory } from "../../rpc/methods";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../infrastructure/postgresql/native-delivery-ledger-repo";
import {
  readPersonalDelegatedPluginActions,
  readRemoteAgentDelegatedRequester,
} from "./delegated-requester";
import { isNativeDeliveryExecutingStatus } from "./native-delivery-execution-status";
import { isActiveRemoteAgentRequesterProfile } from "./personal-remote-agent-space-tools";
import { requireRemoteAgentToolCaller } from "./remote-agent-tool-caller";

/** Rechecks current delivery authority; optionally resolves its human's Computer. */
export async function authorizeRemoteAgentExecutionAccess(
  env: CoreBindings,
  value: unknown
) {
  return (await prepareRemoteAgentExecutionAccess(env, value)).projection;
}

/** Internal callers can use the same checked source without a second ledger read. */
export async function prepareRemoteAgentExecutionAccess(
  env: CoreBindings,
  value: unknown
) {
  const parsed = remoteAgentExecutionAccessRequestSchema.parse(value);
  const { context, submissionId, sources } = parsed;
  const { caller, delivery, request, db } = await requireActiveExecution(
    env,
    parsed
  );
  const scope = resolveRemoteAgentExecutionScope(request);
  const delegatedRequester =
    (parsed.includeDelegatedRequester || parsed.includePluginDelegations) &&
    "personalExecution" in caller &&
    request.turnEnvelope.sender.kind === "agent_profile"
      ? await readRemoteAgentDelegatedRequester({
          identityDb: caller.db,
          evidenceDb: db,
          delivery,
          request,
        })
      : null;
  const principal = scope.principal;
  if (
    parsed.includeDelegatedRequester &&
    principal.kind === "agent" &&
    sources?.length &&
    !delegatedRequester
  ) {
    throw new Error("remote_agent.delegated_requester_unavailable");
  }
  if (principal.kind !== "agent") {
    const membership = await resolveOrganizationMembershipById({
      env,
      organizationId: delivery.organizationId,
      userId: principal.userId,
      requestId: context.actorContext.requestId,
    });
    if (!membership.ok) {
      throw new Error(membership.code);
    }
  }
  await requireExecutionSpaceMembership(env, context, {
    caller,
    delivery,
    request,
  });
  if (
    principal.kind === "agent" &&
    !(await isActiveRemoteAgentRequesterProfile({
      db: caller.db,
      organizationId: scope.organizationId,
      profileId: principal.profileId,
    }))
  ) {
    throw new Error("remote_agent.requester_membership_revoked");
  }
  const pluginDelegations =
    parsed.includePluginDelegations ||
    sources?.some((source) => source.service !== "github")
      ? await readExecutionPluginDelegations(caller, db, delegatedRequester)
      : [];
  await requireResultSources(
    caller,
    request,
    scope,
    sources,
    parsed.effect ?? "read",
    delegatedRequester,
    pluginDelegations
  );
  const projection = remoteAgentExecutionAccessResponseSchema.parse({
    scope,
    submissionId,
    ...(await readExecutionComputer(
      parsed.includeComputer,
      db,
      caller,
      request,
      scope
    )),
    ...(parsed.includePluginDelegations ? { pluginDelegations } : {}),
    ...(parsed.includeDelegatedRequester
      ? { delegatedRequesterSupported: true }
      : {}),
    ...(parsed.includeDelegatedRequester && delegatedRequester
      ? { delegatedRequester }
      : {}),
  });
  return { projection, caller, delivery, request };
}

async function readExecutionComputer(
  includeComputer: boolean | undefined,
  db: PostgresDatabase,
  caller: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>,
  request: Awaited<ReturnType<typeof requireActiveExecution>>["request"],
  scope: ReturnType<typeof resolveRemoteAgentExecutionScope>
) {
  if (!includeComputer) {
    return {};
  }
  let ownerUserId: string | null = null;
  if ("personalExecution" in caller) {
    ownerUserId = request.agentProfileOwnerUserId ?? null;
  } else if (scope.principal.kind !== "agent") {
    ownerUserId = scope.principal.userId;
  }
  return {
    computer: ownerUserId
      ? await ensurePersonalComputer(db, ownerUserId)
      : null,
  };
}

async function requireExecutionSpaceMembership(
  env: CoreBindings,
  context: ReturnType<
    typeof remoteAgentExecutionAccessRequestSchema.parse
  >["context"],
  {
    caller,
    delivery,
    request,
  }: Pick<
    Awaited<ReturnType<typeof requireActiveExecution>>,
    "caller" | "delivery" | "request"
  >
) {
  if (delivery.conversationKind !== "space") {
    return;
  }
  const directory =
    "personalExecution" in caller
      ? caller.personalExecution.directory
      : await rpcGetSpaceMemberDirectory(env, {
          context,
          spaceId: delivery.spaceId,
        });
  if (
    !directory.members.some(
      (member) => member.profileId === delivery.profileId
    ) ||
    (request.author.profileId &&
      !directory.members.some(
        (member) => member.profileId === request.author.profileId
      ))
  ) {
    throw new Error("remote_agent.space_membership_revoked");
  }
}

async function readExecutionPluginDelegations(
  caller: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>,
  evidenceDb: PostgresDatabase,
  requester: Awaited<ReturnType<typeof readRemoteAgentDelegatedRequester>>
) {
  return requester && "personalExecution" in caller
    ? await readPersonalDelegatedPluginActions({
        evidenceDb,
        personal: caller.personalExecution,
        requester,
      })
    : [];
}

async function requireResultSources(
  caller: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>,
  request: Awaited<ReturnType<typeof requireActiveExecution>>["request"],
  scope: ReturnType<typeof resolveRemoteAgentExecutionScope>,
  sources: ReturnType<
    typeof remoteAgentExecutionAccessRequestSchema.parse
  >["sources"],
  effect: "read" | "write",
  delegatedRequester: Awaited<
    ReturnType<typeof readRemoteAgentDelegatedRequester>
  >,
  pluginDelegations: Awaited<
    ReturnType<typeof readPersonalDelegatedPluginActions>
  >
) {
  const principal = scope.principal;
  for (const source of sources ?? []) {
    const grant = delegatedRequester
      ? requireResultSourceGrant(pluginDelegations, source, effect)
      : undefined;
    const connection = await requireRemotePluginConnection({
      db: caller.db,
      organizationId: scope.organizationId,
      connectionName: source.connectionName,
      service: source.service,
      requesterUserId:
        delegatedRequester?.userId ??
        (principal.kind === "agent" ? null : principal.userId),
      ...("personalExecution" in caller
        ? { remoteOwnerUserId: request.agentProfileOwnerUserId ?? null }
        : {}),
      effect,
    });
    if (
      (source.connectionUpdatedAtMs !== undefined &&
        connection.updatedAtMs !== source.connectionUpdatedAtMs) ||
      delegatedAccountChanged(grant, connection)
    ) {
      throw new Error("remote_agent.result_connection_changed");
    }
  }
}

function requireResultSourceGrant(
  grants: Awaited<ReturnType<typeof readPersonalDelegatedPluginActions>>,
  source: NonNullable<
    ReturnType<typeof remoteAgentExecutionAccessRequestSchema.parse>["sources"]
  >[number],
  effect: "read" | "write"
) {
  if (source.service === "github") {
    if (effect !== "read") {
      throw new Error("remote_agent.delegated_read_only");
    }
    return undefined;
  }
  return requireDelegatedPluginAction(grants, {
    service: source.service,
    connectionName: source.connectionName,
    ...(effect === "write" ? { effect } : {}),
  });
}

function delegatedAccountChanged(
  grant: ReturnType<typeof requireDelegatedPluginAction> | undefined,
  connection: Awaited<ReturnType<typeof requireRemotePluginConnection>>
) {
  return (
    grant &&
    (connection.updatedAtMs !== grant.connectionUpdatedAtMs ||
      connection.userId !== grant.connectionOwnerUserId ||
      connection.scope !== grant.connectionScope)
  );
}

async function requireActiveExecution(
  env: CoreBindings,
  input: ReturnType<typeof remoteAgentExecutionAccessRequestSchema.parse>
) {
  const { context, submissionId } = input;
  const db = getPostgresDatabase(env);
  if (!db) {
    throw new Error("remote_agent.execution_store_unavailable");
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  const request =
    delivery?.executionRecoverySubmitRequest ?? delivery?.workerSubmitRequest;
  if (
    !(
      delivery &&
      request &&
      isNativeDeliveryExecutingStatus(delivery.status)
    ) ||
    delivery.submissionId !== submissionId ||
    delivery.organizationId !== context.activeOrganizationId ||
    delivery.profileId !== context.actorContext.openMeldProfileId ||
    context.agentControllerConversationId !== submissionId ||
    request.organizationId !== delivery.organizationId ||
    request.agentProfileId !== delivery.profileId ||
    request.bindingId !== delivery.bindingId ||
    request.spaceId !== delivery.spaceId ||
    request.dispatchId !== delivery.dispatchId
  ) {
    throw new Error("remote_agent.execution_not_active");
  }
  const caller = await requireRemoteAgentToolCaller({ context, env });
  if (!("personalExecution" in caller)) {
    const binding = await readPrimaryAgentProfileBindingRecord({
      db: caller.db,
      agentProfileId: delivery.profileId,
      owner: { kind: "organization", id: delivery.organizationId },
    });
    if (
      binding?.bindingState !== "enabled_primary" ||
      binding.bindingId !== delivery.bindingId
    ) {
      throw new Error("remote_agent.execution_binding_changed");
    }
  }
  return { caller, delivery, request, db };
}
