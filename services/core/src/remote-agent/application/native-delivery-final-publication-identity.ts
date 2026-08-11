import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";

export const REMOTE_AGENT_FINAL_PUBLICATION_METADATA_EVENT_TYPE =
  "openmeld_remote_agent_final_publication";

export const REMOTE_AGENT_FINAL_PUBLICATION_METADATA_DELIVERY_ID_KEY =
  "delivery_id";

export function buildRemoteAgentFinalPublicationMetadata(
  delivery: Pick<RemoteAgentNativeDeliveryRecord, "deliveryId">
): {
  eventPayload: Record<string, string>;
  eventType: typeof REMOTE_AGENT_FINAL_PUBLICATION_METADATA_EVENT_TYPE;
} {
  return {
    eventPayload: {
      [REMOTE_AGENT_FINAL_PUBLICATION_METADATA_DELIVERY_ID_KEY]:
        delivery.deliveryId,
    },
    eventType: REMOTE_AGENT_FINAL_PUBLICATION_METADATA_EVENT_TYPE,
  };
}
