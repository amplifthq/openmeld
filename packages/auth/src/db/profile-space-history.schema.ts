// biome-ignore-all lint/performance/noBarrelFile: Phase 2 keeps this file as a compat wrapper over the canonical db package.
export type {
  OpenMeldProfileSpaceCreatorKind,
  OpenMeldProfileSpaceHistoryStatus,
} from "@openmeld/db/auth";
export {
  OPENMELD_PROFILE_SPACE_CREATOR_KINDS,
  OPENMELD_PROFILE_SPACE_HISTORY_STATUSES,
  openMeldProfileSpaceHistory,
  openMeldProfileSpaceHistoryRelations,
} from "@openmeld/db/auth";
