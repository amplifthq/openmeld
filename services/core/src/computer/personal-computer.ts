import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { cloudComputerSchema } from "@openmeld/schemas";

/** Call only after the request owner has been established by Core. */
export async function ensurePersonalComputer(
  db: PostgresDatabase,
  ownerUserId: string
) {
  if (!ownerUserId.trim()) {
    throw new Error("computer.owner_required");
  }
  // The unique owner index arbitrates simultaneous first use by different Agents.
  const result = await db.query<{
    id: string;
    owner_user_id: string;
    provider: string;
    created_at_ms: number;
  }>({
    text: `INSERT INTO "openmeld"."cloud_computers"
      (id, owner_user_id, provider, created_at_ms)
      VALUES ($1, $2, 'cloudflare', $3)
      ON CONFLICT (owner_user_id) DO UPDATE
      SET owner_user_id = EXCLUDED.owner_user_id
      RETURNING id, owner_user_id, provider, created_at_ms`,
    values: [crypto.randomUUID(), ownerUserId, Date.now()],
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error("computer.identity_unavailable");
  }
  return cloudComputerSchema.parse({
    id: row.id,
    ownerUserId: row.owner_user_id,
    provider: row.provider,
    createdAtMs: Number(row.created_at_ms),
  });
}
