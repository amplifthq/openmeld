import type { PluginConnectionContinuationBinding } from "@openmeld/schemas";
import type {
  ConnectorConnectionPreference,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { type CoreBindings, wakeEvidenceDb } from "../lib/bindings";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../rpc/errors";
import { rpcReadPluginConnectionContinuationBinding } from "../rpc/methods";

/** The selection belongs to the actual admitted Message, not a model argument,
 * prompt sentence or mutable conversation preference. Existing Core permissions
 * are still required; this constraint never grants a capability. */
export async function readPluginConnectionExecutionBinding(
  env: CoreBindings,
  context: OpenMeldRequestContext
) {
  const submissionId = context.agentControllerConversationId;
  if (!submissionId) {
    return null;
  }
  const db = wakeEvidenceDb(env);
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
    delivery.status !== "accepted"
  ) {
    throw unavailable();
  }
  const request =
    delivery.executionRecoverySubmitRequest ?? delivery.workerSubmitRequest;
  const sender = request?.turnEnvelope.sender;
  if (
    delivery.conversationKind !== "space" ||
    sender?.kind !== "member" ||
    !sender.verified ||
    !sender.ownerUserId
  ) {
    return null;
  }
  return await rpcReadPluginConnectionContinuationBinding(env, {
    organizationId: delivery.organizationId,
    spaceId: delivery.spaceId,
    signalId: delivery.triggerMessageId,
    targetProfileId: delivery.profileId,
    requesterUserId: sender.ownerUserId,
  });
}

export function boundPluginConnectionPreference(
  binding: PluginConnectionContinuationBinding | null,
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
  binding: PluginConnectionContinuationBinding | null,
  service: string,
  connection: { connectionName: string; updatedAtMs: number } | null
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
