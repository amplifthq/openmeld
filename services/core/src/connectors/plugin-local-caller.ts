import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  authRpcResolveProfileByIdResultSchema,
  runtimeCoordinatorExecutionAccessResponseSchema,
} from "@openmeld/schemas";
import type { PluginActionRpcInput } from "@openmeld/schemas/types";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { readDelegatedPluginActions } from "../center-agent/application/delegated-plugin-authorization";
import { readRecordedDelegationRequester } from "../center-agent/application/recorded-delegation-requester";
import { readPluginDispatchRequester } from "../dispatch/application/plugin-request-provenance";
import { resolveRuntimeTransportOwnerShard } from "../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import type { CoreBindings } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import {
  readOrganizationAccountIdentityProjection,
  resolveActiveOrganizationMembership,
  resolveOrganizationMembershipById,
} from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { callRequiredAuthWorkerRpc } from "../rpc/required-auth-worker-rpc";
export async function requireLocalPluginCaller(
  env: CoreBindings,
  input: PluginActionRpcInput
) {
  const member = await resolveActiveOrganizationMembership({
    env,
    context: input.context,
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
    expectedOrganizationId: input.expectedOrganizationId,
    errorCode: "connector.organization_context_changed",
  });
  const actor = input.context.actorContext;
  const profile = await requirePluginProfile(env, actor.openMeldProfileId);
  if (
    actor.profileKind !== "agent" ||
    profile.profileKind !== "agent" ||
    profile.ownerUserId !== member.userId ||
    profile.organizationId !== member.organizationId
  ) {
    throw denied("Use a Local Agent owned by your signed-in account.");
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "plugin.state_unavailable",
      reason: "Plugin state is unavailable.",
      status: 503,
    });
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    db,
    agentProfileId: profile.profileId,
    owner: { kind: "owner_account", id: member.userId },
  });
  if (
    binding?.bindingState !== "enabled_primary" ||
    binding.runtimeKind !== "openmeld_service"
  ) {
    throw denied("This command requires a configured Local Agent.");
  }
  const provenance = input.request.dispatchId
    ? await readPluginDispatchRequester({
        env,
        dispatchId: input.request.dispatchId,
        agentProfileId: profile.profileId,
        organizationId: member.organizationId,
      })
    : null;
  const source = provenance
    ? await requirePluginProfile(env, provenance.profileId)
    : null;
  const delegated =
    source?.profileKind === "agent" && provenance
      ? await requireLocalDelegation({
          env,
          input,
          binding,
          provenance,
          ownerUserId: member.userId,
          organizationId: member.organizationId,
          actorProfileId: profile.profileId,
        })
      : null;
  if (
    source &&
    !delegated &&
    (source.profileKind !== "human" || !source.ownerUserId)
  ) {
    throw denied(
      "This Wake does not have a verified human requester for plugin access."
    );
  }
  const representedUserId =
    delegated?.requester.userId ?? source?.ownerUserId ?? member.userId;
  const requesterMembership = await resolveOrganizationMembershipById({
    env,
    organizationId: member.organizationId,
    userId: representedUserId,
  });
  if (!requesterMembership.ok) {
    throw denied("The requester is no longer a member of this organization.");
  }
  const identity = await readOrganizationAccountIdentityProjection({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: member.organizationId,
    account: { kind: "user_id", userId: representedUserId },
  });
  if (
    !(
      identity?.ok &&
      identity.organization.id === member.organizationId &&
      identity.account?.userId === representedUserId &&
      identity.account.defaultHumanProfile
    )
  ) {
    throw denied("The requesting account identity is unavailable.");
  }
  return {
    db,
    organizationId: member.organizationId,
    actorProfileId: profile.profileId,
    ownerUserId: member.userId,
    representedUserId,
    sourceSpaceId: provenance?.spaceId ?? null,
    sourceSignalId: provenance?.sourceSignalId ?? null,
    sourceRequestKey: input.request.dispatchId
      ? `dispatch:${input.request.dispatchId}`
      : undefined,
    // This identity comes from admitted, immutable request provenance. A model
    // supplied dispatch ID or an Agent's claim about the owner is not a root.
    authorizedRequestRoot: resolvePluginRequestRoot(provenance, delegated),
    human: identity.account.defaultHumanProfile,
    personalAllowed: representedUserId === member.userId,
    delegatedPluginActions: delegated?.actions,
  };
}

function resolvePluginRequestRoot(
  provenance: Awaited<ReturnType<typeof readPluginDispatchRequester>> | null,
  delegated: Awaited<ReturnType<typeof requireLocalDelegation>> | null
) {
  if (delegated) {
    return delegated.requester.parentDeliveryId;
  }
  // requireLocalPluginCaller already rejected an unverified Agent sender.
  return provenance
    ? `space-message:${provenance.spaceId}:${provenance.sourceSignalId}`
    : undefined;
}

async function requireLocalDelegation(input: {
  env: CoreBindings;
  input: PluginActionRpcInput;
  binding: NonNullable<
    Awaited<ReturnType<typeof readPrimaryAgentProfileBindingRecord>>
  >;
  provenance: Awaited<ReturnType<typeof readPluginDispatchRequester>>;
  ownerUserId: string;
  organizationId: string;
  actorProfileId: string;
}) {
  const proof = input.input.request.executionTokenEcho;
  const sourceClientMessageId = input.provenance.sourceClientMessageId;
  const db = getPostgresDatabase(input.env);
  const evidenceDb = getPostgresDatabase(input.env);
  if (
    !(
      proof &&
      sourceClientMessageId &&
      db &&
      evidenceDb &&
      input.input.request.dispatchId
    )
  ) {
    throw denied(
      "This delegated action requires the current Local execution's proof."
    );
  }
  const access = runtimeCoordinatorExecutionAccessResponseSchema.parse(
    await resolveRuntimeTransportOwnerShard(
      input.env,
      input.ownerUserId
    ).rpcAuthorizeExecutionAccess({
      executionTokenEcho: proof,
      expectedExecutionScope: {
        dispatchId: input.input.request.dispatchId,
        runtimeCoordinatorExecutionId: proof.runtimeCoordinatorExecutionId,
        sourceClientMessageId,
        spaceId: input.provenance.spaceId,
        targetProfileId: input.actorProfileId,
      },
      expectedAuthorityScope: {
        bindingId: input.binding.bindingId,
        agentControllerRef: input.binding.agentControllerRef,
        openMeldServiceRuntimeId: input.binding.openMeldServiceRuntimeId,
      },
    })
  );
  if (!access.allowed) {
    throw denied("The delegated Local execution is no longer authorized.");
  }
  const requester = await readRecordedDelegationRequester({
    identityDb: db,
    evidenceDb,
    organizationId: input.organizationId,
    spaceId: input.provenance.spaceId,
    sourceClientMessageId,
    sourceProfileId: input.provenance.profileId,
    targetProfileId: input.actorProfileId,
    targetOwnerUserId: input.ownerUserId,
  });
  if (!requester) {
    throw denied(
      "The recorded delegation no longer authorizes this requester."
    );
  }
  const actions = await readDelegatedPluginActions({
    db: evidenceDb,
    sourceClientMessageId,
    delegationId: requester.delegationId,
    parentDeliveryId: requester.parentDeliveryId,
    organizationId: input.organizationId,
    spaceId: input.provenance.spaceId,
    targetProfileId: input.actorProfileId,
    requesterUserId: requester.userId,
    requesterProfileId: requester.profileId,
  });
  if (!actions.length) {
    throw denied(
      "This delegation has no current, explicit Plugin action authorization."
    );
  }
  return { requester, actions };
}

export async function requirePluginProfile(
  env: CoreBindings,
  profileId: string
) {
  const result = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (worker) =>
      worker.resolveProfileById({ openMeldProfileId: profileId }),
    unavailable: {
      code: "plugin.identity_unavailable",
      reason: "Plugin caller identity is unavailable.",
    },
  });
  const parsed = authRpcResolveProfileByIdResultSchema.safeParse(result);
  if (
    !(
      parsed.success &&
      parsed.data.ok &&
      parsed.data.profile.profileId === profileId &&
      parsed.data.profile.status === "active"
    )
  ) {
    throw denied("An active, verified profile is required for plugin access.");
  }
  return parsed.data.profile;
}
function denied(reason: string) {
  return createCoreRpcHttpError({
    code: "plugin.caller_forbidden",
    reason,
    status: 403,
  });
}
