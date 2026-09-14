import type { NativeReplyPlacement } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { resolveSpaceStub } from "../../rpc/space-ref";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";

/** The source scope stays frozen in the delivery; Space owns output placement. */
export async function resolveNativeDeliveryReplyPlacement(input: {
  env: CoreBindings;
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    | "conversationKind"
    | "executionRecoverySubmitRequest"
    | "spaceId"
    | "dispatchId"
    | "triggerMessageId"
    | "profileId"
    | "threadContext"
  > & { routineRunId?: string | null };
  lock: boolean;
  placement?: "conversation" | "thread";
}): Promise<NativeReplyPlacement | null> {
  const delivery = input.delivery;
  if (delivery.conversationKind !== "space" || delivery.routineRunId) {
    return null;
  }
  const request = delivery.executionRecoverySubmitRequest;
  if (
    request?.v === 4 &&
    request.conversationIdentity?.kind === "personal_agent"
  ) {
    return null;
  }
  const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, delivery.spaceId);
  if (!stub) {
    throw new Error("space.reply_placement.space_unavailable");
  }
  return await stub.rpcResolveNativeReplyPlacement({
    spaceId: delivery.spaceId,
    dispatchId: delivery.dispatchId,
    sourceSignalId: delivery.triggerMessageId,
    profileId: delivery.profileId,
    defaultToThread: true,
    lock: input.lock,
    ...(input.placement ? { placement: input.placement } : {}),
  });
}

export async function resolveNativeDeliveryReplyThreadContext(
  input: Omit<
    Parameters<typeof resolveNativeDeliveryReplyPlacement>[0],
    "lock" | "placement"
  >
) {
  const placement = await resolveNativeDeliveryReplyPlacement({
    ...input,
    lock: true,
  });
  return placement ? placement.threadContext : input.delivery.threadContext;
}
