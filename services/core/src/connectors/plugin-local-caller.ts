import { authRpcResolveProfileByIdResultSchema } from "@openmeld/schemas";
import type { PluginActionRpcInput } from "@openmeld/schemas/types";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { readPluginDispatchRequester } from "../dispatch/application/plugin-request-provenance";
import { type CoreBindings, identityDb } from "../lib/bindings";
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
  const profile = await requireProfile(env, actor.openMeldProfileId);
  if (
    actor.profileKind !== "agent" ||
    profile.profileKind !== "agent" ||
    profile.ownerUserId !== member.userId ||
    profile.organizationId !== member.organizationId
  ) {
    throw denied("Use a Local Agent owned by your signed-in account.");
  }
  const db = identityDb(env);
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
    ? await requireProfile(env, provenance.profileId)
    : null;
  if (source && (source.profileKind !== "human" || !source.ownerUserId)) {
    throw denied(
      "This Wake does not have a verified human requester for plugin access."
    );
  }
  const representedUserId = source?.ownerUserId ?? member.userId;
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
    human: identity.account.defaultHumanProfile,
    personalAllowed: representedUserId === member.userId,
  };
}

async function requireProfile(env: CoreBindings, profileId: string) {
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
