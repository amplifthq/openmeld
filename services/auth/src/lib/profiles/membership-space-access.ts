import type { AuthBindings } from "../bindings";

// space_index_memberships is the Space-truth membership projection, OWNED by
// core (projections domain). Auth must NOT read it directly: after the Knife 1
// cutover the writer is openmeld-projections while auth still binds openmeld-db, so a
// direct read would freeze auth's membership view at the cutover instant
// (split-brain — owner-added members rejected, removed members still granted).
// Auth reads it through the core worker RPC, which always resolves whatever DB
// core writes. Only the data source moved here; the union-with-history /
// fall-back-to-history authorization decision stays in the caller.
export async function listMembershipSpaceIdsForProfiles(input: {
  coreWorker: AuthBindings["OPENMELD_CORE_WORKER"];
  profileIds: readonly string[];
  spaceIds: readonly string[];
}): Promise<string[]> {
  if (input.profileIds.length === 0 || input.spaceIds.length === 0) {
    return [];
  }
  if (!input.coreWorker) {
    throw new Error(
      "OPENMELD_CORE_WORKER binding is required to read the space membership projection"
    );
  }
  return await input.coreWorker.listMembershipSpaceIdsForProfiles({
    profileIds: input.profileIds,
    spaceIds: input.spaceIds,
  });
}
