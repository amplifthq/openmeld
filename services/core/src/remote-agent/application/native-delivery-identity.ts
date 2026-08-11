export type RemoteAgentNativeDeliveryIdentityMismatch =
  | "binding"
  | "dispatch"
  | "idempotency"
  | "organization"
  | "profile"
  | "space"
  | "trigger";

type NativeDeliveryIdentity = {
  bindingId: string;
  dispatchId: string;
  idempotencyKey: string;
  organizationId: string;
  profileId: string;
  spaceId: string;
  triggerMessageId: string;
};

type NativeDeliveryCallbackIdentity = {
  agentProfileId: string;
  bindingId: string;
  dispatchId: string;
  idempotencyKey: string;
  organizationId: string;
  spaceId: string;
  triggerMessageId: string;
};

export function resolveRemoteAgentNativeDeliveryIdentityMismatch(
  delivery: NativeDeliveryIdentity,
  callback: NativeDeliveryCallbackIdentity
): RemoteAgentNativeDeliveryIdentityMismatch | null {
  if (delivery.idempotencyKey !== callback.idempotencyKey) {
    return "idempotency";
  }
  if (delivery.organizationId !== callback.organizationId) {
    return "organization";
  }
  if (delivery.spaceId !== callback.spaceId) {
    return "space";
  }
  if (delivery.profileId !== callback.agentProfileId) {
    return "profile";
  }
  if (delivery.bindingId !== callback.bindingId) {
    return "binding";
  }
  if (delivery.triggerMessageId !== callback.triggerMessageId) {
    return "trigger";
  }
  if (delivery.dispatchId !== callback.dispatchId) {
    return "dispatch";
  }
  return null;
}
