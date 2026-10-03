import type {
  CenterAgentToolSpeaker,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../../center-agent/application/anonymous-member-request";
import { requireDelegatedPluginAction } from "../../center-agent/application/delegated-plugin-authorization";
import { requireActiveHumanMember } from "../../center-agent/application/represented-member-request";
import type { CoreBindings } from "../../lib/bindings";
import { wakeEvidenceDb } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  readPersonalDelegatedPluginActions,
  readRemoteAgentDelegatedRequester,
} from "./delegated-requester";
import { requireRemoteAgentToolCaller } from "./remote-agent-tool-caller";

/** Reuse member-backed tools without granting the personal Agent Center duties. */
export async function prepareRemoteAgentMemberRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext,
  speakerMember: CenterAgentToolSpeaker,
  pluginAction?: Parameters<typeof requireDelegatedPluginAction>[1]
) {
  if (
    context.actorContext.agentControllerRef !==
    HOSTED_REMOTE_AGENT_CONTROLLER_REF
  ) {
    return await prepareCenterAgentOrganizationMemberRequest(
      env,
      context,
      speakerMember
    );
  }
  const authorization = await requireRemoteAgentToolCaller({ env, context });
  if (!("personalExecution" in authorization)) {
    throw new Error("Expected an admitted personal Remote Agent execution.");
  }
  const { request, delivery } = authorization.personalExecution;
  const envelopeSender = request.turnEnvelope.sender;
  const sender =
    envelopeSender.kind === "routine"
      ? { ...envelopeSender.delegatedBy, kind: "member" as const }
      : envelopeSender;
  const delegated =
    pluginAction && sender.kind === "agent_profile"
      ? await requireDelegatedPluginMember(env, authorization, pluginAction)
      : null;
  if (
    "kind" in speakerMember ||
    (delegated
      ? delegated.memberId !== speakerMember.memberId ||
        delegated.userId !== speakerMember.userId
      : sender.kind !== "member" ||
        !sender.verified ||
        sender.id !== speakerMember.memberId ||
        sender.ownerUserId !== speakerMember.userId)
  ) {
    throw createCoreRpcHttpError({
      code: "remote_agent.requester_identity_mismatch",
      reason:
        "This action requires the verified requester of the active delivery.",
      status: 403,
    });
  }
  const member = await requireActiveHumanMember({
    db: authorization.db,
    organizationId: authorization.activeOrganization.organizationId,
    speakerMember,
  });
  return {
    authorization,
    member: {
      ...member,
      sourceNativeDeliveryId: delivery.deliveryId,
      sourceSpaceId: delivery.spaceId,
    },
  };
}

async function requireDelegatedPluginMember(
  env: CoreBindings,
  authorization: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>,
  action: Parameters<typeof requireDelegatedPluginAction>[1]
) {
  const evidenceDb = wakeEvidenceDb(env);
  if (!(evidenceDb && "personalExecution" in authorization)) {
    throw new Error("plugin.delegation_unavailable");
  }
  const personal = authorization.personalExecution;
  const requester = await readRemoteAgentDelegatedRequester({
    identityDb: authorization.db,
    evidenceDb,
    ...personal,
  });
  if (!requester) {
    throw new Error("plugin.delegation_unavailable");
  }
  const actions = await readPersonalDelegatedPluginActions({
    evidenceDb,
    personal,
    requester,
  });
  const grant = requireDelegatedPluginAction(actions, action);
  if (action.connectionName) {
    const connection = await requireRemotePluginConnection({
      db: authorization.db,
      organizationId: personal.delivery.organizationId,
      connectionName: action.connectionName,
      service: grant.service,
      requesterUserId: requester.userId,
      remoteOwnerUserId: personal.request.agentProfileOwnerUserId ?? null,
      effect: grant.effect,
    });
    if (
      connection.updatedAtMs !== grant.connectionUpdatedAtMs ||
      connection.scope !== grant.connectionScope ||
      connection.userId !== grant.connectionOwnerUserId
    ) {
      throw new Error("plugin.delegation_account_changed");
    }
  }
  return requester;
}

import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { requireRemotePluginConnection } from "../../connectors/plugin-access";
