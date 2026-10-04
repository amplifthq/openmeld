import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  type SpaceOwnerDepartureInput,
  type SpaceOwnerDepartureResult,
  spaceOwnerDepartureInputSchema,
} from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import { resolveSpaceStub } from "../rpc/space-ref";
export async function checkSpaceOwnerDeparture(
  env: CoreBindings,
  raw: SpaceOwnerDepartureInput
): Promise<SpaceOwnerDepartureResult> {
  const input = spaceOwnerDepartureInputSchema.parse(raw);
  const db = getPostgresDatabase(env);
  if (!db) {
    throw new Error("Space ownership storage is unavailable.");
  }
  const rows = await db.query<{
    space_id: string;
  }>({
    text: `SELECT r.space_id FROM "openmeld"."space_owner_member_references" r
    JOIN "openmeld"."members" m ON m.id = r.member_id WHERE m.organization_id = $1 AND m.user_id = $2`,
    values: [input.organizationId, input.userId],
  });
  const spaces: SpaceOwnerDepartureResult["spaces"] = [];
  for (const row of rows.rows) {
    const stub = resolveSpaceStub(env.OPENMELD_SPACES, row.space_id);
    if (!stub) {
      throw new Error("Couldn't verify Space ownership.");
    }
    const owner = await stub.rpcCheckSpaceOwnerDeparture({
      ...input,
      spaceId: row.space_id,
    });
    if (owner) {
      spaces.push(owner);
    }
  }
  return { spaces };
}
