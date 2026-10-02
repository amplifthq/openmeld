import type { NavigationAction } from "@openmeld/schemas";
import type { RemoteAgentNativeDeliveryRecord } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  issuePluginChannelIntent,
  readPluginChannelMetadata,
} from "../remote-agent/infrastructure/d1/plugin-channel-metadata-repo";

/** Called by existing private provider-publication owners after the original
 * final outcome is published. Request IDs locate state; they grant no access. */
export async function preparePluginChannelNavigation(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  action: NavigationAction;
}) {
  if (input.action.target.kind !== "plugin_connection") {
    return input.action;
  }
  const metadata = await readPluginChannelMetadata(
    input.db,
    input.delivery.deliveryId
  );
  // Older deliveries have no accepted proof. Retain an ordinary setup link,
  // never manufacture a continuation binding from a late provider read.
  if (!metadata) {
    return input.action;
  }
  await issuePluginChannelIntent(input.db, input.delivery.deliveryId, {
    service: input.action.target.service,
    scope: input.action.target.scope,
    expiresAtMs:
      (input.delivery.completedAtMs ?? Date.now()) + 24 * 60 * 60_000,
  });
  const url = new URL(input.action.url);
  url.searchParams.set("request", input.delivery.deliveryId);
  return { ...input.action, url: url.toString() };
}
