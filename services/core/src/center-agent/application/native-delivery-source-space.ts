import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";

export function resolveNativeDeliverySourceSpaceId(
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    "conversationKind" | "spaceId"
  >
): string | null {
  return delivery.conversationKind === "space" ? delivery.spaceId : null;
}
