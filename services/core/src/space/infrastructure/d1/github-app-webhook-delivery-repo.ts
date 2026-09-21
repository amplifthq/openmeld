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
  db: D1Database;
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
  await input.db
    .prepare(
      `
        INSERT INTO github_app_webhook_deliveries (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?, ?)
        ON CONFLICT(delivery_id) DO UPDATE SET
          last_received_at_ms = excluded.last_received_at_ms,
          gateway_request_id = excluded.gateway_request_id,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
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
      input.nowMs
    )
    .run();

  const claimed = await input.db
    .prepare(
      `
        UPDATE github_app_webhook_deliveries
        SET
          state = 'processing',
          claim_id = ?,
          claim_expires_at_ms = ?,
          failure_code = NULL,
          completed_at_ms = NULL,
          updated_at_ms = ?
        WHERE delivery_id = ?
          AND (
            state IN ('queued', 'failed')
            OR (state = 'processing' AND claim_expires_at_ms IS NOT NULL AND claim_expires_at_ms < ?)
          )
      `
    )
    .bind(
      input.claimId,
      input.claimExpiresAtMs,
      input.nowMs,
      input.deliveryId,
      input.nowMs
    )
    .run();
  return (claimed.meta.changes ?? 0) > 0 ? "claimed" : "duplicate";
}

export async function completeGitHubAppWebhookDelivery(input: {
  db: D1Database;
  deliveryId: string;
  failureCode: string | null;
  nowMs: number;
  state: Extract<
    GitHubAppWebhookDeliveryState,
    "completed" | "failed" | "ignored"
  >;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE github_app_webhook_deliveries
        SET
          state = ?,
          failure_code = ?,
          completed_at_ms = ?,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE delivery_id = ?
      `
    )
    .bind(
      input.state,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.deliveryId
    )
    .run();
}
