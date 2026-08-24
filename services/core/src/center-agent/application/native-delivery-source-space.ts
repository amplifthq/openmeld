import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";

export function resolveNativeDeliverySourceSpaceId(
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    "conversationKind" | "spaceId"
  >
): string | null {
  return delivery.conversationKind === "space" ? delivery.spaceId : null;
}
