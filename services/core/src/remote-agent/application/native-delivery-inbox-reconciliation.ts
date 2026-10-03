import { listLegacyTaskContinuationInboxItems } from "../../inbox/infrastructure/d1/inbox-item-repo";
import { listRemoteAgentNativeDeliveriesByDeliveryIds } from "../infrastructure/d1/native-delivery-ledger-repo";
import { resolveNativeFailureLanguage } from "./native-delivery-failure-facts";
import { repairTaskContinuationAdmissionExhaustedInboxItem } from "./native-delivery-inbox-producer";

/** Repair old recipient projections from their source, without replaying execution. */
export async function reconcileTaskContinuationInbox(input: {
  inboxDb: D1Database;
  sourceDb: D1Database;
  identityDb: D1Database;
  coordinationDb: D1Database;
  organizationId: string;
  recipientUserId: string;
}): Promise<void> {
  const items = await listLegacyTaskContinuationInboxItems({
    db: input.inboxDb,
    organizationId: input.organizationId,
    recipientUserId: input.recipientUserId,
  });
  if (items.length === 0) {
    return;
  }
  const deliveries = await listRemoteAgentNativeDeliveriesByDeliveryIds({
    db: input.sourceDb,
    deliveryIds: items.map((item) =>
      item.sourceKey.slice(0, -":admission_retry_exhausted".length)
    ),
  });
  for (const item of items) {
    const delivery = deliveries.find(
      (candidate) =>
        `${candidate.deliveryId}:admission_retry_exhausted` === item.sourceKey
    );
    if (
      !delivery ||
      delivery.organizationId !== input.organizationId ||
      delivery.onBehalfOfUserId !== input.recipientUserId ||
      delivery.status !== "failed" ||
      delivery.failureCode !== "remote_agent.admission_timeout" ||
      delivery.admissionAttemptCount < 3 ||
      delivery.completedAtMs !== item.occurredAtMs
    ) {
      continue;
    }
    await repairTaskContinuationAdmissionExhaustedInboxItem({
      db: input.inboxDb,
      delivery,
      attempts: delivery.admissionAttemptCount,
      occurredAtMs: item.occurredAtMs,
      languageTag: await resolveNativeFailureLanguage({
        coordinationDb: input.coordinationDb,
        db: input.identityDb,
        delivery,
      }),
    });
  }
}
