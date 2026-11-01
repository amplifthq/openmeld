import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import type { PluginConnectionContinuationBinding } from "@openmeld/schemas";
import type {
  ConnectorConnectionPreference,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { isNativeDeliveryExecutingStatus } from "../remote-agent/application/native-delivery-execution-status";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readPluginChannelMetadata } from "../remote-agent/infrastructure/postgresql/plugin-channel-metadata-repo";
import { createCoreRpcHttpError } from "../rpc/errors";
import { rpcReadPluginConnectionContinuationBinding } from "../rpc/methods";

type ExecutionConnectionBinding = Pick<
  PluginConnectionContinuationBinding,
  "service" | "scope" | "connectionName" | "connectionUpdatedAtMs"
>;
/** The selection belongs to the actual admitted Message, not a model argument,
 * prompt sentence or mutable conversation preference. Existing Core permissions
 * are still required; this constraint never grants a capability. */
export async function readPluginConnectionExecutionBinding(
  env: CoreBindings,
  context: OpenMeldRequestContext,
  service?: string
) {
  const submissionId = context.agentControllerConversationId;
  if (!submissionId) {
    return null;
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw unavailable();
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  if (!delivery) {
    return null;
  }
  if (
    delivery.organizationId !== context.activeOrganizationId ||
    delivery.profileId !== context.actorContext.openMeldProfileId ||
    !isNativeDeliveryExecutingStatus(delivery.status)
  ) {
    throw unavailable();
  }
  const request =
    delivery.executionRecoverySubmitRequest ?? delivery.workerSubmitRequest;
  const sender = request?.turnEnvelope.sender;
  if (sender?.kind !== "member" || !sender.verified || !sender.ownerUserId) {
    if (
      delivery.idempotencyKey.startsWith("plugin-channel-continue:") ||
      delivery.triggerMessageId.startsWith("plugin-channel-continue:")
    ) {
      throw unavailable();
    }
    return null;
  }
  if (delivery.conversationKind !== "space") {
    return await readChannelBindingChain(
      db,
      delivery,
      sender.ownerUserId,
      request?.author.profileId ?? null,
      service
    );
  }
  return await readSpacePluginConnectionBinding(
    env,
    {
      organizationId: delivery.organizationId,
      spaceId: delivery.spaceId,
      signalId: delivery.triggerMessageId,
      targetProfileId: delivery.profileId,
      requesterUserId: sender.ownerUserId,
    },
    service
  );
}
// Walk only authenticated continuation ancestry, not unrelated conversation
// history. A second Plugin setup retains an earlier explicit account choice.
export async function readSpacePluginConnectionBinding(
  env: CoreBindings,
  input: Parameters<typeof rpcReadPluginConnectionContinuationBinding>[1],
  service?: string
) {
  let signalId = input.signalId;
  const seen = new Set<string>();
  for (let hop = 0; hop < 32; hop += 1) {
    if (seen.has(signalId)) {
      throw unavailable();
    }
    seen.add(signalId);
    const binding = await rpcReadPluginConnectionContinuationBinding(env, {
      ...input,
      signalId,
    });
    if (!(binding && service) || binding.service === service) {
      return binding;
    }
    signalId = binding.source.signalId;
  }
  throw unavailable();
}
// Keep goal recovery on authenticated continuation ancestry, even when a
// connection continuation was followed by a separate action approval.
export async function readSpacePluginConnectionOriginalSource(
  env: CoreBindings,
  input: Parameters<typeof rpcReadPluginConnectionContinuationBinding>[1]
) {
  let signalId = input.signalId;
  let original: { signalId: string; requesterProfileId: string } | null = null;
  const seen = new Set<string>();
  for (let hop = 0; hop < 32; hop += 1) {
    if (seen.has(signalId)) {
      throw unavailable();
    }
    seen.add(signalId);
    const binding = await rpcReadPluginConnectionContinuationBinding(env, {
      ...input,
      signalId,
    });
    if (!binding) {
      return original;
    }
    original = {
      signalId: binding.source.signalId,
      requesterProfileId: binding.requesterProfileId,
    };
    signalId = binding.source.signalId;
  }
  throw unavailable();
}

async function readChannelBindingChain(
  db: PostgresDatabase,
  current: RemoteAgentNativeDeliveryRecord,
  userId: string,
  profileId: string | null,
  service?: string
) {
  let delivery = current;
  const seen = new Set<string>();
  for (let hop = 0; hop < 32; hop += 1) {
    if (seen.has(delivery.deliveryId)) {
      throw unavailable();
    }
    seen.add(delivery.deliveryId);
    const metadata = await readPluginChannelMetadata(db, delivery.deliveryId);
    if (metadata?.kind !== "continuation") {
      if (
        delivery.idempotencyKey.startsWith("plugin-channel-continue:") ||
        delivery.triggerMessageId.startsWith("plugin-channel-continue:")
      ) {
        throw unavailable();
      }
      return null;
    }
    const binding = metadata.executionSelection;
    if (
      binding.organizationId !== current.organizationId ||
      binding.targetProfileId !== current.profileId ||
      binding.requesterUserId !== userId ||
      binding.requesterProfileId !== profileId
    ) {
      throw unavailable();
    }
    if (!service || binding.service === service) {
      return binding;
    }
    const parent = await readRemoteAgentNativeDeliveryByDeliveryId({
      db,
      deliveryId: binding.sourceDeliveryId,
    });
    if (
      !parent ||
      parent.organizationId !== current.organizationId ||
      parent.profileId !== current.profileId ||
      parent.spaceId !== current.spaceId
    ) {
      throw unavailable();
    }
    delivery = parent;
  }
  throw unavailable();
}
export function boundPluginConnectionPreference(
  binding: ExecutionConnectionBinding | null,
  service: string,
  preference: ConnectorConnectionPreference
): ConnectorConnectionPreference {
  if (!binding || binding.service !== service) {
    return preference;
  }
  const selected = binding.scope === "member" ? "requester" : "shared";
  if (preference !== "automatic" && preference !== selected) {
    throw unavailable();
  }
  return selected;
}
export function assertBoundPluginConnection(
  binding: ExecutionConnectionBinding | null,
  service: string,
  connection: {
    connectionName: string;
    updatedAtMs: number;
  } | null
) {
  if (!binding || binding.service !== service) {
    return;
  }
  if (
    !connection ||
    connection.connectionName !== binding.connectionName ||
    connection.updatedAtMs !== binding.connectionUpdatedAtMs
  ) {
    throw unavailable();
  }
}
function unavailable() {
  return createCoreRpcHttpError({
    code: "plugin.continue.execution_identity_changed",
    status: 409,
    reason:
      "This task is bound to the account you selected. That identity is unavailable or different; no other account was substituted.",
  });
}
