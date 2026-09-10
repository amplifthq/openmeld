import {
  type SpaceOwnerDepartureInput,
  type SpaceOwnerDepartureResult,
  spaceOwnerDepartureInputSchema,
} from "@openmeld/schemas";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { resolveSpaceStub } from "../rpc/space-ref";

export async function checkSpaceOwnerDeparture(
  env: CoreBindings,
  raw: SpaceOwnerDepartureInput
): Promise<SpaceOwnerDepartureResult> {
  const input = spaceOwnerDepartureInputSchema.parse(raw);
  const db = identityDb(env);
  if (!db) {
    throw new Error("Space ownership storage is unavailable.");
  }
  const rows = await db
    .prepare(`SELECT r.space_id FROM space_owner_member_references r
    JOIN members m ON m.id = r.member_id WHERE m.organization_id = ? AND m.user_id = ?`)
    .bind(input.organizationId, input.userId)
    .all<{ space_id: string }>();
  const spaces: SpaceOwnerDepartureResult["spaces"] = [];
  for (const row of rows.results) {
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
