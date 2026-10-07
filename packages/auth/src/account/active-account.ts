import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { APIError } from "better-auth/api";

export async function requireActiveAccount(
  db: PostgresDatabase,
  userId: string
): Promise<void> {
  const result = await db.query({
    text: 'SELECT 1 FROM "openmeld"."users" WHERE id = $1 AND deleted_at IS NULL',
    values: [userId],
  });
  if (result.rows.length === 0) {
    throw new APIError("UNAUTHORIZED", {
      code: "account.unavailable",
      message:
        "This account is no longer available. Sign in with another account.",
    });
  }
}
