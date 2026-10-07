import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  pluginDelegationAuthorizationSchema,
  pluginRuntimeResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAttribution,
  CenterAgentWakeAgentProfilesInSpaceBody,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { requireRemotePluginConnection } from "../../connectors/plugin-access";
import type { CoreBindings } from "../../lib/bindings";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readCenterAgentWakePublication } from "../infrastructure/postgresql/center-agent-wake-publication-repo";
import { requireCenterAgentContinuationParent } from "./center-agent-delegation-service";

type Authorization = ReturnType<
  typeof pluginDelegationAuthorizationSchema.parse
>;

/** The existing immutable Wake command records the constraint; delegation state
 * and current connection permission remain their existing owners' decisions. */
export async function prepareDelegatedPluginActions(input: {
  env: CoreBindings;
  db: PostgresDatabase;
  organizationId: string;
  actorProfileId: string;
  parentSubmissionId: string;
  attribution: CenterAgentAttribution;
  targetProfileIds: string[];
  requests: CenterAgentWakeAgentProfilesInSpaceBody["pluginActions"];
}): Promise<Authorization[] | undefined> {
  if (!input.requests?.length) {
    return undefined;
  }
  const parent = await requireCenterAgentContinuationParent({
    ...input,
    destinationNeutralContinuations: true,
    resumesParent: false,
  });
  const request =
    parent.executionRecoverySubmitRequest ?? parent.workerSubmitRequest;
  const sender = request?.turnEnvelope.sender;
  const db = getPostgresDatabase(input.env);
  if (
    !db ||
    sender?.kind !== "member" ||
    !sender.verified ||
    !sender.ownerUserId ||
    !sender.profileId ||
    sender.ownerUserId !== input.attribution.onBehalfOf?.userId ||
    sender.profileId !== input.attribution.onBehalfOf.profileId
  ) {
    throw new Error("plugin.delegation_original_requester_required");
  }
  const grants: Authorization[] = [];
  for (const selected of input.requests) {
    if (
      !input.targetProfileIds.includes(selected.targetProfileId) ||
      selected.expiresAtMs <= Date.now() ||
      selected.expiresAtMs > Date.now() + 86_400_000
    ) {
      throw new Error("plugin.delegation_scope_invalid");
    }
    const child = await db
      .query({
        text: "SELECT profile_id FROM \"openmeld\".\"openmeld_profiles\" WHERE profile_id = $1 AND organization_id = $2 AND owner_user_id = $3 AND profile_kind = 'agent' AND managed_role IS NULL AND status = 'active'",
        values: [
          selected.targetProfileId,
          input.organizationId,
          sender.ownerUserId,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    if (!child) {
      throw new Error("plugin.delegation_target_owner_mismatch");
    }
    const connection = await requireRemotePluginConnection({
      db,
      organizationId: input.organizationId,
      connectionName: selected.connectionName,
      service: selected.service,
      requesterUserId: sender.ownerUserId,
      effect: selected.effect,
    });
    const catalog = pluginRuntimeResponseSchema.parse(
      await input.env.OPENMELD_REMOTE_AGENT_WORKER?.pluginRuntime?.({
        operation: "list",
        service: selected.service,
      })
    );
    if (
      catalog.status !== "catalog" ||
      !catalog.actions.some(
        (action) =>
          action.id === selected.actionId && action.effect === selected.effect
      )
    ) {
      throw new Error("plugin.delegation_action_effect_mismatch");
    }
    grants.push(
      pluginDelegationAuthorizationSchema.parse({
        targetProfileId: selected.targetProfileId,
        service: selected.service,
        actionId: selected.actionId,
        connectionName: selected.connectionName,
        effect: selected.effect,
        expiresAtMs: selected.expiresAtMs,
        connectionUpdatedAtMs: connection.updatedAtMs,
        connectionOwnerUserId: connection.userId,
        connectionScope: connection.scope,
        requestSignature: await digestCanonicalJson({
          actionId: selected.actionId,
          service: selected.service,
          connectionName: selected.connectionName,
          input: selected.input,
        }),
      })
    );
  }
  return grants;
}

export async function readDelegatedPluginActions(input: {
  db: PostgresDatabase;
  sourceClientMessageId: string;
  delegationId: string;
  parentDeliveryId: string;
  organizationId: string;
  spaceId: string;
  targetProfileId: string;
  requesterUserId: string;
  requesterProfileId: string;
}): Promise<Authorization[]> {
  const publication = await readCenterAgentWakePublication({
    db: input.db,
    publicationId: input.sourceClientMessageId,
  });
  if (!publication) {
    return [];
  }
  const command = publication.command;
  const parent = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: input.parentDeliveryId,
  });
  if (
    publication.state !== "completed" ||
    publication.delegationId !== input.delegationId ||
    command.parentSubmissionId !== parent?.submissionId ||
    command.profile.profileId !== parent?.profileId ||
    command.attribution.actorProfileId !== parent?.profileId ||
    command.context.actorContext.openMeldProfileId !== parent?.profileId ||
    command.organizationId !== input.organizationId ||
    command.spaceId !== input.spaceId ||
    !command.activationTargets.includes(input.targetProfileId) ||
    command.attribution.onBehalfOf?.userId !== input.requesterUserId ||
    command.attribution.onBehalfOf.profileId !== input.requesterProfileId
  ) {
    return [];
  }
  return (command.pluginActions ?? []).filter(
    (grant) =>
      grant.targetProfileId === input.targetProfileId &&
      grant.expiresAtMs > Date.now()
  );
}

export function requireDelegatedPluginAction(
  grants: Authorization[],
  request: {
    service: string;
    actionId?: string;
    connectionName?: string;
    requestSignature?: string;
    effect?: string;
  }
) {
  const grant = grants.find(
    (candidate) =>
      candidate.service === request.service &&
      (!request.actionId || candidate.actionId === request.actionId) &&
      (!request.connectionName ||
        candidate.connectionName === request.connectionName) &&
      (!request.requestSignature ||
        candidate.requestSignature === request.requestSignature) &&
      (!request.effect || candidate.effect === request.effect) &&
      candidate.expiresAtMs > Date.now()
  );
  if (!grant) {
    throw new Error("plugin.delegation_scope_mismatch");
  }
  return grant;
}
