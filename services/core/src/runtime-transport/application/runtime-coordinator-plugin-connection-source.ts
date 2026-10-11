import {
  buildRuntimeCoordinatorExecutionId,
  type PluginConnectionExecutionSource,
  type PluginConnectionExecutionSourceRequest,
  pluginConnectionExecutionSourceSchema,
} from "@openmeld/schemas";
import { pluginConnectionSourceEnvelopeDigest } from "../../connectors/plugin-connection-source-fingerprint";
import type { RuntimeCoordinatorRunCommandState } from "./runtime-coordinator-authority";

/** Retained admission evidence, independent of the retired Space conveyor.
 * Space still verifies RuntimeCoordinator completion and current messages. */
export function projectPluginConnectionExecutionSource(
  request: PluginConnectionExecutionSourceRequest,
  state: RuntimeCoordinatorRunCommandState | null
): PluginConnectionExecutionSource | null {
  const delivery = state?.sanitizedDeliveryRequest;
  const payload = delivery?.payload;
  if (
    !(state && delivery && payload?.sourceMessageEnvelope) ||
    request.executionId !== buildRuntimeCoordinatorExecutionId(request) ||
    state.runtimeCoordinatorExecutionId !== request.executionId ||
    payload.runtimeCoordinatorExecutionId !== request.executionId ||
    state.ownerUserId !== request.ownerUserId ||
    delivery.ownerUserId !== request.ownerUserId ||
    state.dispatchId !== request.dispatchId ||
    delivery.dispatchId !== request.dispatchId ||
    payload.dispatchId !== request.dispatchId ||
    payload.spaceId !== request.spaceId ||
    state.profileId !== request.targetProfileId ||
    state.targetProfileId !== request.targetProfileId ||
    delivery.profileId !== request.targetProfileId ||
    payload.targetProfileId !== request.targetProfileId ||
    payload.sourceSignal.profileKind !== "human"
  ) {
    return null;
  }
  return pluginConnectionExecutionSourceSchema.parse({
    ...request,
    bindingId: payload.executionIdentity.core.bindingId,
    sourceSignalId: payload.sourceEventId,
    requesterProfileId: payload.sourceSignal.profileId,
    sourceEnvelopeDigest: pluginConnectionSourceEnvelopeDigest(
      payload.sourceMessageEnvelope
    ),
    createdAtMs: state.createdAtMs,
    threadContext: payload.threadContext ?? null,
  });
}
