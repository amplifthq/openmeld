import {
  remoteAgentExecutionAccessRequestSchema,
  remoteAgentExecutionAccessResponseSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { readPrimaryAgentProfileBindingRecord } from "../../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { requireRemotePluginConnection } from "../../connectors/plugin-access";
import { type CoreBindings, wakeEvidenceDb } from "../../lib/bindings";
import { resolveOrganizationMembershipById } from "../../organizations/organization-context";
import { rpcGetSpaceMemberDirectory } from "../../rpc/methods";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../infrastructure/d1/native-delivery-ledger-repo";
import { isNativeDeliveryExecutingStatus } from "./native-delivery-execution-status";
import { isActiveRemoteAgentRequesterProfile } from "./personal-remote-agent-space-tools";
import { requireRemoteAgentToolCaller } from "./remote-agent-tool-caller";

/** Read-only projection over the current delivery and existing identity owners. */
export async function authorizeRemoteAgentExecutionAccess(
  env: CoreBindings,
  value: unknown
) {
  const parsed = remoteAgentExecutionAccessRequestSchema.parse(value);
  const { context, submissionId, sources } = parsed;
  const { caller, delivery, request } = await requireActiveExecution(
    env,
    parsed
  );
  const scope = resolveRemoteAgentExecutionScope(request);
  const principal = scope.principal;
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
  if (delivery.conversationKind === "space") {
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
  await requireResultSources(
    caller,
    request,
    scope,
    sources,
    parsed.effect ?? "read"
  );
  return remoteAgentExecutionAccessResponseSchema.parse({
    scope,
    submissionId,
  });
}

async function requireResultSources(
  caller: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>,
  request: Awaited<ReturnType<typeof requireActiveExecution>>["request"],
  scope: ReturnType<typeof resolveRemoteAgentExecutionScope>,
  sources: ReturnType<
    typeof remoteAgentExecutionAccessRequestSchema.parse
  >["sources"],
  effect: "read" | "write"
) {
  const principal = scope.principal;
  for (const source of sources ?? []) {
    const connection = await requireRemotePluginConnection({
      db: caller.db,
      organizationId: scope.organizationId,
      connectionName: source.connectionName,
      service: source.service,
      requesterUserId: principal.kind === "agent" ? null : principal.userId,
      ...("personalExecution" in caller
        ? { remoteOwnerUserId: request.agentProfileOwnerUserId ?? null }
        : {}),
      effect,
    });
    if (
      source.connectionUpdatedAtMs !== undefined &&
      connection.updatedAtMs !== source.connectionUpdatedAtMs
    ) {
      throw new Error("remote_agent.result_connection_changed");
    }
  }
}

async function requireActiveExecution(
  env: CoreBindings,
  input: ReturnType<typeof remoteAgentExecutionAccessRequestSchema.parse>
) {
  const { context, submissionId } = input;
  const db = wakeEvidenceDb(env);
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
  return { caller, delivery, request };
}
