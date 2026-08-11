import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  listSpaceTargetCatalog,
  type SpaceTargetCatalogEntry,
  type SpaceTargetRelationSupport,
  type SpaceTargetWakeAvailability,
} from "../target-identity/target-catalog";

export type SpaceSendTargetAllowedRelations = SpaceTargetRelationSupport;
export type SpaceSendTargetWakeAvailability = SpaceTargetWakeAvailability;
export type SpaceSendTargetProjectionEntry = SpaceTargetCatalogEntry;

export function listSpaceSendTargets(
  snapshot: SpaceMembersSnapshot
): SpaceSendTargetProjectionEntry[] {
  return [...listSpaceTargetCatalog(snapshot)];
}
