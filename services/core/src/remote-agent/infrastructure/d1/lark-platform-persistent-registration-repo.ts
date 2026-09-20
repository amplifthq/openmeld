import { readRemoteAgentLarkPlatformRegistrationAttempt } from "./lark-platform-registration-attempt-repo";

/** Fences transport activation to the current setup claim. Existing Webhook
 * ingress fails closed immediately; only this connection's DO may now receive. */
export async function prepareLarkPlatformPersistentConnection(input: {
  db: D1Database;
  connectionId: string;
  attemptId: string;
  claimId: string;
  nowMs: number;
  botOpenId: string;
  botName: string | null;
}): Promise<boolean> {
  const result = await input.db
    .prepare(`
    UPDATE openMeldRemoteAgent_lark_platform_channel_connections
    SET transport = 'websocket', bot_open_id = ?, bot_name = ?, updated_at_ms = ?
    WHERE connection_id = ? AND status = 'configuring'
      AND EXISTS (SELECT 1 FROM openMeldRemoteAgent_lark_platform_registration_attempts attempt
        WHERE attempt.attempt_id = ? AND attempt.connection_id = openMeldRemoteAgent_lark_platform_channel_connections.connection_id
          AND attempt.organization_id = openMeldRemoteAgent_lark_platform_channel_connections.organization_id
          AND attempt.provider = openMeldRemoteAgent_lark_platform_channel_connections.provider
          AND attempt.poll_claim_id = ? AND attempt.poll_claim_expires_at_ms > ?
          AND attempt.expires_at_ms > ? AND attempt.consumed_at_ms IS NULL
          AND attempt.status = 'configuring')
  `)
    .bind(
      input.botOpenId,
      input.botName,
      input.nowMs,
      input.connectionId,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs
    )
    .run();
  return result.meta.changes === 1;
}

/** Called only after the authenticated persistent socket handshake succeeds.
 * Never manufacture Webhook proofs to satisfy the old readiness predicate. */
export async function completeLarkPlatformPersistentRegistration(input: {
  db: D1Database;
  connectionId: string;
  attemptId: string;
  claimId: string;
  nowMs: number;
}): Promise<void> {
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt(input);
  if (!attempt || attempt.connectionId !== input.connectionId) {
    return;
  }
  await input.db.batch([
    input.db
      .prepare(`
      UPDATE openMeldRemoteAgent_lark_platform_channel_connections
      SET status = 'connected', last_verified_at_ms = ?, failure_reason_code = NULL,
        granted_capability_groups_json = '["conversation.text"]', updated_at_ms = ?
      WHERE connection_id = ? AND transport = 'websocket' AND status = 'configuring'
        AND bot_open_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM openMeldRemoteAgent_lark_platform_registration_attempts attempt
          WHERE attempt.attempt_id = ? AND attempt.connection_id = openMeldRemoteAgent_lark_platform_channel_connections.connection_id
            AND attempt.organization_id = openMeldRemoteAgent_lark_platform_channel_connections.organization_id
            AND attempt.provider = openMeldRemoteAgent_lark_platform_channel_connections.provider
            AND attempt.poll_claim_id = ? AND attempt.poll_claim_expires_at_ms > ?
            AND attempt.expires_at_ms > ? AND attempt.consumed_at_ms IS NULL AND attempt.status = 'configuring')
    `)
      .bind(
        input.nowMs,
        input.nowMs,
        input.connectionId,
        input.attemptId,
        input.claimId,
        input.nowMs,
        input.nowMs
      ),
    input.db
      .prepare(`
      UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
      SET status = 'connected', consumed_at_ms = ?, updated_at_ms = ?, failure_reason_code = NULL,
        poll_claim_id = NULL, poll_claim_expires_at_ms = NULL
      WHERE attempt_id = ? AND poll_claim_id = ? AND poll_claim_expires_at_ms > ?
        AND expires_at_ms > ? AND consumed_at_ms IS NULL AND status = 'configuring'
        AND EXISTS (SELECT 1 FROM openMeldRemoteAgent_lark_platform_channel_connections connection
          WHERE connection.connection_id = ? AND connection.connection_id = openMeldRemoteAgent_lark_platform_registration_attempts.connection_id
            AND connection.organization_id = openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
            AND connection.provider = openMeldRemoteAgent_lark_platform_registration_attempts.provider
            AND connection.status = 'connected' AND connection.transport = 'websocket'
            AND connection.last_verified_at_ms = ?)
    `)
      .bind(
        input.nowMs,
        input.nowMs,
        input.attemptId,
        input.claimId,
        input.nowMs,
        input.nowMs,
        input.connectionId,
        input.nowMs
      ),
  ]);
}
