import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { createCoreRpcHttpError } from "../rpc/errors";

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
export async function preparePluginActionConfirmation(input: {
  db: PostgresDatabase;
  organizationId: string;
  actorProfileId: string;
  requestSignature: string;
  accessRevision: number;
  token?: string;
}): Promise<{
  token: string;
  expiresAtMs: number;
} | null> {
  const now = Date.now();
  if (input.token) {
    const row = await input.db
      .query({
        text: 'SELECT token FROM "openmeld"."plugin_action_confirmations" WHERE token = $1 AND organization_id = $2 AND actor_profile_id = $3 AND request_signature = $4 AND access_revision = $5 AND expires_at_ms > $6',
        values: [
          input.token,
          input.organizationId,
          input.actorProfileId,
          input.requestSignature,
          input.accessRevision,
          now,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    if (!row) {
      throw createCoreRpcHttpError({
        code: "plugin.confirmation_invalid",
        reason:
          "This confirmation expired or no longer matches the action and access settings. Preview the action again.",
        status: 403,
      });
    }
    // The signature includes operationId. The operation ledger consumes that
    // identity atomically, so reusing this token cannot authorize another write.
    return null;
  }
  const token = crypto.randomUUID();
  const expiresAtMs = now + CONFIRMATION_TTL_MS;
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: 'DELETE FROM "openmeld"."plugin_action_confirmations" WHERE expires_at_ms <= $1',
          values: [now],
        }),
        await client.query({
          text: 'INSERT INTO "openmeld"."plugin_action_confirmations" (token, organization_id, actor_profile_id, request_signature, access_revision, expires_at_ms) VALUES ($1, $2, $3, $4, $5, $6)',
          values: [
            token,
            input.organizationId,
            input.actorProfileId,
            input.requestSignature,
            input.accessRevision,
            expiresAtMs,
          ],
        }),
      ] as const
  );
  return { token, expiresAtMs };
}
