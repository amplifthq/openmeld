import { createCoreRpcHttpError } from "../rpc/errors";

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

export async function preparePluginActionConfirmation(input: {
  db: D1Database;
  organizationId: string;
  actorProfileId: string;
  requestSignature: string;
  accessRevision: number;
  token?: string;
}): Promise<{ token: string; expiresAtMs: number } | null> {
  const now = Date.now();
  if (input.token) {
    const row = await input.db
      .prepare(
        "SELECT token FROM plugin_action_confirmations WHERE token = ? AND organization_id = ? AND actor_profile_id = ? AND request_signature = ? AND access_revision = ? AND expires_at_ms > ?"
      )
      .bind(
        input.token,
        input.organizationId,
        input.actorProfileId,
        input.requestSignature,
        input.accessRevision,
        now
      )
      .first();
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
  await input.db.batch([
    input.db
      .prepare(
        "DELETE FROM plugin_action_confirmations WHERE expires_at_ms <= ?"
      )
      .bind(now),
    input.db
      .prepare(
        "INSERT INTO plugin_action_confirmations (token, organization_id, actor_profile_id, request_signature, access_revision, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        token,
        input.organizationId,
        input.actorProfileId,
        input.requestSignature,
        input.accessRevision,
        expiresAtMs
      ),
  ]);
  return { token, expiresAtMs };
}
