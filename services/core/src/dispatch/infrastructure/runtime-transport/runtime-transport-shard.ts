import type { CoreBindings } from "../../../lib/bindings";
import type { RuntimeTransportHub } from "../../../runtime-transport/transport/do/runtime-transport-hub";

export const resolveRuntimeTransportOwnerShard = (
  env: CoreBindings,
  ownerUserId: string
): DurableObjectStub<RuntimeTransportHub> => {
  const namespace = env.OPENMELD_RUNTIME_TRANSPORT;
  if (!namespace) {
    throw new Error(
      "runtime.transport.misconfigured: OPENMELD_RUNTIME_TRANSPORT is not bound"
    );
  }

  const shardId = namespace.idFromName(ownerUserId);
  return namespace.get(shardId);
};

export const resolveRuntimeTransportExecutionRecoveryShard = (
  env: CoreBindings,
  deliveryId: string
): DurableObjectStub<RuntimeTransportHub> => {
  const namespace = env.OPENMELD_RUNTIME_TRANSPORT;
  if (!namespace) {
    throw new Error(
      "runtime.transport.misconfigured: OPENMELD_RUNTIME_TRANSPORT is not bound"
    );
  }
  const normalizedDeliveryId = deliveryId.trim();
  if (!normalizedDeliveryId) {
    throw new Error("execution_recovery.delivery_id_required");
  }
  return namespace.get(
    namespace.idFromName(`execution-recovery:${normalizedDeliveryId}`)
  );
};
