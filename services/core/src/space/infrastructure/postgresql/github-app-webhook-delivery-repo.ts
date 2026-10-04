import type { PostgresDatabase } from "@openmeld/db/postgresql";
export type GitHubAppWebhookDeliveryState =
  | "completed"
  | "failed"
  | "ignored"
  | "processing"
  | "queued";
export async function claimGitHubAppWebhookDelivery(input: {
  action: string | null;
  claimExpiresAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  deliveryId: string;
  event: string;
  gatewayRequestId: string;
  issueState: "closed" | "open" | null;
  nowMs: number;
  number: number | null;
  ownerLogin: string | null;
  receivedAtMs: number;
  repo: string | null;
}): Promise<"claimed" | "duplicate"> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."github_app_webhook_deliveries" (
          delivery_id,
          event,
          action,
          owner_login,
          repo,
          number,
          issue_state,
          gateway_request_id,
          state,
          claim_id,
          claim_expires_at_ms,
          first_received_at_ms,
          last_received_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', NULL, NULL, $9, $10, $11)
        ON CONFLICT(delivery_id) DO UPDATE SET
          last_received_at_ms = excluded.last_received_at_ms,
          gateway_request_id = excluded.gateway_request_id,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      input.deliveryId,
      input.event,
      input.action,
      input.ownerLogin,
      input.repo,
      input.number,
      input.issueState,
      input.gatewayRequestId,
      input.receivedAtMs,
      input.receivedAtMs,
      input.nowMs,
    ],
  });
  const claimed = await input.db.query({
    text: `
        UPDATE "openmeld"."github_app_webhook_deliveries"
        SET
          state = 'processing',
          claim_id = $1,
          claim_expires_at_ms = $2,
          failure_code = NULL,
          completed_at_ms = NULL,
          updated_at_ms = $3
        WHERE delivery_id = $4
          AND (
            state IN ('queued', 'failed')
            OR (state = 'processing' AND claim_expires_at_ms IS NOT NULL AND claim_expires_at_ms < $5)
          )
      `,
    values: [
      input.claimId,
      input.claimExpiresAtMs,
      input.nowMs,
      input.deliveryId,
      input.nowMs,
    ],
  });
  return (claimed.rowCount ?? 0) > 0 ? "claimed" : "duplicate";
}
export async function completeGitHubAppWebhookDelivery(input: {
  db: PostgresDatabase;
  deliveryId: string;
  failureCode: string | null;
  nowMs: number;
  state: Extract<
    GitHubAppWebhookDeliveryState,
    "completed" | "failed" | "ignored"
  >;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."github_app_webhook_deliveries"
        SET
          state = $1,
          failure_code = $2,
          completed_at_ms = $3,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = $4
        WHERE delivery_id = $5
      `,
    values: [
      input.state,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
    ],
  });
}
