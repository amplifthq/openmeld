import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";

export async function buildNativeDeliveryRetainedResultRef(
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    "deliveryId" | "finalPublicationPayload"
  >
): Promise<string | null> {
  if (!delivery.finalPublicationPayload) {
    return null;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(delivery.finalPublicationPayload))
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `native-delivery-result:v1:${delivery.deliveryId}:sha256:${hash}`;
}

export function hasRecoverableNativeDeliveryRetainedResult(
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    "finalPublicationPayload" | "finalPublicationState"
  >
): boolean {
  return (
    delivery.finalPublicationState === "outcome_unknown" &&
    delivery.finalPublicationPayload !== null &&
    delivery.finalPublicationPayload.failureCode === null
  );
}
