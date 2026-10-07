import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { runtimeCoordinatorExecutionAccessResponseSchema } from "@openmeld/schemas";
import type {
  SessionHistoryRequester,
  SessionHistoryRpcInput,
} from "@openmeld/schemas/types";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { readRecordedDelegationRequester } from "../center-agent/application/recorded-delegation-requester";
import { requirePluginProfile } from "../connectors/plugin-local-caller";
import { readPluginDispatchRequester } from "../dispatch/application/plugin-request-provenance";
import { resolveRuntimeTransportOwnerShard } from "../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import type { CoreBindings } from "../lib/bindings";
import { resolveOrganizationMembershipById } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";

function deny(): never {
  throw createCoreRpcHttpError({
    status: 403,
    code: "session_history.denied",
    reason:
      "History requires a current execution with a verified request from the Computer owner.",
  });
}

export async function requireSessionHistoryLocalRequester(
  env: CoreBindings,
  input: SessionHistoryRpcInput,
  ownerUserId: string
): Promise<SessionHistoryRequester> {
  const actor = input.context.actorContext;
  const db = getPostgresDatabase(env);
  if (
    !(db && input.execution) ||
    input.request.operation !== "read_session" ||
    actor.profileKind !== "agent" ||
    actor.callerPrincipalId !== ownerUserId
  ) {
    return deny();
  }
  const profile = await requirePluginProfile(env, actor.openMeldProfileId);
  if (
    profile.profileKind !== "agent" ||
    profile.ownerUserId !== ownerUserId ||
    profile.organizationId !== input.organizationId ||
    profile.status !== "active"
  ) {
    return deny();
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    db,
    agentProfileId: actor.openMeldProfileId,
    owner: { kind: "owner_account", id: ownerUserId },
  });
  if (
    binding?.bindingState !== "enabled_primary" ||
    binding.runtimeKind !== "openmeld_service"
  ) {
    return deny();
  }
  const source = await readPluginDispatchRequester({
    env,
    dispatchId: input.execution.dispatchId,
    agentProfileId: actor.openMeldProfileId,
    organizationId: input.organizationId,
  });
  if (!source.sourceClientMessageId) {
    return deny();
  }
  const access = runtimeCoordinatorExecutionAccessResponseSchema.parse(
    await resolveRuntimeTransportOwnerShard(
      env,
      ownerUserId
    ).rpcAuthorizeExecutionAccess({
      executionTokenEcho: input.execution.executionTokenEcho,
      expectedExecutionScope: {
        dispatchId: input.execution.dispatchId,
        runtimeCoordinatorExecutionId:
          input.execution.executionTokenEcho.runtimeCoordinatorExecutionId,
        sourceClientMessageId: source.sourceClientMessageId,
        spaceId: source.spaceId,
        targetProfileId: actor.openMeldProfileId,
      },
      expectedAuthorityScope: {
        bindingId: binding.bindingId,
        agentControllerRef: binding.agentControllerRef,
        openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
      },
    })
  );
  if (!access.allowed) {
    return deny();
  }
  const origin = await requirePluginProfile(env, source.profileId);
  let rootUserId: string | null = null;
  let delegatorProfileId: string | null = null;
  let requestRootId = `space-message:${source.spaceId}:${source.sourceSignalId}`;
  if (origin.profileKind === "human") {
    rootUserId = origin.ownerUserId;
  } else if (origin.profileKind === "agent") {
    const delegated = await readRecordedDelegationRequester({
      identityDb: db,
      evidenceDb: db,
      organizationId: input.organizationId,
      spaceId: source.spaceId,
      sourceClientMessageId: source.sourceClientMessageId,
      sourceProfileId: source.profileId,
      targetProfileId: actor.openMeldProfileId,
      targetOwnerUserId: ownerUserId,
    });
    rootUserId = delegated?.userId ?? null;
    if (delegated) {
      requestRootId = delegated.parentDeliveryId;
    }
    delegatorProfileId = source.profileId;
  }
  if (rootUserId !== ownerUserId) {
    return deny();
  }
  const member = await resolveOrganizationMembershipById({
    env,
    organizationId: input.organizationId,
    userId: rootUserId,
  });
  if (!member.ok) {
    return deny();
  }
  return {
    requestRootId,
    ownerUserId,
    requesterUserId: rootUserId,
    readerProfileId: actor.openMeldProfileId,
    delegatorProfileId,
    spaceId: source.spaceId,
    audience: "space",
  };
}
