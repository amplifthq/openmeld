import type { RemoteAgentNativeDeliveryStatus } from "../infrastructure/postgresql/native-delivery-ledger-repo";

/** Both a fresh ACK and a replay ACK identify admitted execution. This is only
 * the lifecycle gate: callers must still verify identity and current access. */
export function isNativeDeliveryExecutingStatus(
  status: RemoteAgentNativeDeliveryStatus
): boolean {
  return status === "accepted" || status === "retry_observed";
}
