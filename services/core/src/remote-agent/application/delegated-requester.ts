import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { readRecordedDelegationRequester } from "../../center-agent/application/recorded-delegation-requester";
import type { CoreBindings } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/postgresql/native-delivery-ledger-repo";
import type { requireRemoteAgentToolCaller } from "./remote-agent-tool-caller";

/** Connection selection still uses the existing owner and access policy. */
export async function resolveRemoteAgentConnectorRequester(input: {
  env: CoreBindings;
  authorization: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>;
  service: string;
  includeDelegatedRequester?: true;
  requesterUserId: string | null;
}) {
  const personal =
    "personalExecution" in input.authorization
      ? input.authorization.personalExecution
      : null;
  const sender = personal?.request.turnEnvelope.sender;
  if (!input.includeDelegatedRequester) {
    if (sender?.kind === "routine") {
      return sender.delegatedBy.ownerUserId;
    }
    return sender?.kind === "member" && sender.verified
      ? (sender.ownerUserId ?? null)
      : null;
  }
  const evidenceDb = getPostgresDatabase(input.env);
  const delegated =
    personal && evidenceDb && sender?.kind === "agent_profile"
      ? await readRemoteAgentDelegatedRequester({
          identityDb: input.authorization.db,
          evidenceDb,
          delivery: personal.delivery,
          request: personal.request,
        })
      : null;
  if (!delegated || input.requesterUserId !== delegated.userId) {
    throw createCoreRpcHttpError({
      code: "remote_agent.delegated_requester_unavailable",
      reason: "The recorded delegation no longer authorizes this requester.",
      status: 403,
    });
  }
  if (input.service !== "github" && personal && evidenceDb) {
    requireDelegatedPluginAction(
      await readPersonalDelegatedPluginActions({
        evidenceDb,
        personal,
        requester: delegated,
      }),
      { service: input.service }
    );
  }
  return delegated.userId;
}

export async function readPersonalDelegatedPluginActions(input: {
  evidenceDb: PostgresDatabase;
  personal: {
    delivery: RemoteAgentNativeDeliveryRecord;
    request: RemoteAgentWorkerSubmitTurnRequest;
  };
  requester: NonNullable<
    Awaited<ReturnType<typeof readRemoteAgentDelegatedRequester>>
  >;
}) {
  const { delivery } = input.personal;
  if (!delivery.sourceClientMessageId) {
    return [];
  }
  return await readDelegatedPluginActions({
    db: input.evidenceDb,
    sourceClientMessageId: delivery.sourceClientMessageId,
    delegationId: input.requester.delegationId,
    parentDeliveryId: input.requester.parentDeliveryId,
    organizationId: delivery.organizationId,
    spaceId: delivery.spaceId,
    targetProfileId: delivery.profileId,
    requesterUserId: input.requester.userId,
    requesterProfileId: input.requester.profileId,
  });
}

export async function requireDelegatedConnectionSelection(input: {
  env: CoreBindings;
  authorization: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>;
  includeDelegatedRequester?: true;
  connection: {
    service: string;
    connectionName: string;
    updatedAtMs: number;
    scope: string;
    userId: string;
  } | null;
}) {
  if (
    !(input.includeDelegatedRequester && input.connection) ||
    input.connection.service === "github"
  ) {
    return;
  }
  const evidenceDb = getPostgresDatabase(input.env);
  if (!(evidenceDb && "personalExecution" in input.authorization)) {
    throw new Error("plugin.delegation_unavailable");
  }
  const personal = input.authorization.personalExecution;
  const requester = await readRemoteAgentDelegatedRequester({
    identityDb: input.authorization.db,
    evidenceDb,
    ...personal,
  });
  if (!requester) {
    throw new Error("plugin.delegation_unavailable");
  }
  const grant = requireDelegatedPluginAction(
    await readPersonalDelegatedPluginActions({
      evidenceDb,
      personal,
      requester,
    }),
    input.connection
  );
  if (
    grant.connectionUpdatedAtMs !== input.connection.updatedAtMs ||
    grant.connectionOwnerUserId !== input.connection.userId ||
    grant.connectionScope !== input.connection.scope
  ) {
    throw new Error("plugin.delegation_account_changed");
  }
}

/** A current projection of one recorded Center delegation, never a stored grant. */
export async function readRemoteAgentDelegatedRequester(input: {
  identityDb: PostgresDatabase;
  evidenceDb: PostgresDatabase;
  delivery: RemoteAgentNativeDeliveryRecord;
  request: RemoteAgentWorkerSubmitTurnRequest;
}) {
  const { delivery, request } = input;
  const sender = request.turnEnvelope.sender;
  if (
    request.v !== 4 ||
    request.conversationIdentity?.kind !== "personal_agent" ||
    sender.kind !== "agent_profile"
  ) {
    return null;
  }
  if (
    !sender.verified ||
    sender.profileId !== request.author.profileId ||
    !delivery.sourceClientMessageId
  ) {
    return null;
  }
  return await readRecordedDelegationRequester({
    identityDb: input.identityDb,
    evidenceDb: input.evidenceDb,
    organizationId: delivery.organizationId,
    spaceId: delivery.spaceId,
    sourceClientMessageId: delivery.sourceClientMessageId,
    sourceProfileId: sender.profileId,
    targetProfileId: delivery.profileId,
    targetOwnerUserId: request.agentProfileOwnerUserId,
  });
}

import {
  readDelegatedPluginActions,
  requireDelegatedPluginAction,
} from "../../center-agent/application/delegated-plugin-authorization";
