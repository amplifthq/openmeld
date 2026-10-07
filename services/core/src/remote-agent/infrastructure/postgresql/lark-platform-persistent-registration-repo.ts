import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { readRemoteAgentLarkPlatformRegistrationAttempt } from "./lark-platform-registration-attempt-repo";
/** Fences transport activation to the current setup claim. Existing Webhook
 * ingress fails closed immediately; only this connection's DO may now receive. */
export async function prepareLarkPlatformPersistentConnection(input: {
  db: PostgresDatabase;
  connectionId: string;
  attemptId: string;
  claimId: string;
  nowMs: number;
  botOpenId: string;
  botName: string | null;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
    UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
    SET transport = 'websocket', bot_open_id = $1, bot_name = $2, updated_at_ms = $3
    WHERE connection_id = $4 AND status = 'configuring'
      AND EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
        WHERE attempt.attempt_id = $5 AND attempt.connection_id = "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
          AND attempt.organization_id = "openMeldRemoteAgent_lark_platform_channel_connections".organization_id
          AND attempt.provider = "openMeldRemoteAgent_lark_platform_channel_connections".provider
          AND attempt.poll_claim_id = $6 AND attempt.poll_claim_expires_at_ms > $7
          AND attempt.expires_at_ms > $8 AND attempt.consumed_at_ms IS NULL
          AND attempt.status = 'configuring')
  `,
    values: [
      input.botOpenId,
      input.botName,
      input.nowMs,
      input.connectionId,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs,
    ],
  });
  return result.rowCount === 1;
}
/** Called only after the authenticated persistent socket handshake succeeds.
 * Never manufacture Webhook proofs to satisfy the old readiness predicate. */
export async function completeLarkPlatformPersistentRegistration(input: {
  db: PostgresDatabase;
  connectionId: string;
  attemptId: string;
  claimId: string;
  nowMs: number;
}): Promise<void> {
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt(input);
  if (!attempt || attempt.connectionId !== input.connectionId) {
    return;
  }
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
      UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
      SET status = 'connected', last_verified_at_ms = $1, failure_reason_code = NULL,
        granted_capability_groups_json = '["conversation.text"]', updated_at_ms = $2
      WHERE connection_id = $3 AND transport = 'websocket' AND status = 'configuring'
        AND bot_open_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
          WHERE attempt.attempt_id = $4 AND attempt.connection_id = "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
            AND attempt.organization_id = "openMeldRemoteAgent_lark_platform_channel_connections".organization_id
            AND attempt.provider = "openMeldRemoteAgent_lark_platform_channel_connections".provider
            AND attempt.poll_claim_id = $5 AND attempt.poll_claim_expires_at_ms > $6
            AND attempt.expires_at_ms > $7 AND attempt.consumed_at_ms IS NULL AND attempt.status = 'configuring')
    `,
          values: [
            input.nowMs,
            input.nowMs,
            input.connectionId,
            input.attemptId,
            input.claimId,
            input.nowMs,
            input.nowMs,
          ],
        }),
        await client.query({
          text: `
      UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
      SET status = 'connected', consumed_at_ms = $1, updated_at_ms = $2, failure_reason_code = NULL,
        poll_claim_id = NULL, poll_claim_expires_at_ms = NULL
      WHERE attempt_id = $3 AND poll_claim_id = $4 AND poll_claim_expires_at_ms > $5
        AND expires_at_ms > $6 AND consumed_at_ms IS NULL AND status = 'configuring'
        AND EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
          WHERE connection.connection_id = $7 AND connection.connection_id = "openMeldRemoteAgent_lark_platform_registration_attempts".connection_id
            AND connection.organization_id = "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
            AND connection.provider = "openMeldRemoteAgent_lark_platform_registration_attempts".provider
            AND connection.status = 'connected' AND connection.transport = 'websocket'
            AND connection.last_verified_at_ms = $8)
    `,
          values: [
            input.nowMs,
            input.nowMs,
            input.attemptId,
            input.claimId,
            input.nowMs,
            input.nowMs,
            input.connectionId,
            input.nowMs,
          ],
        }),
      ] as const
  );
}
