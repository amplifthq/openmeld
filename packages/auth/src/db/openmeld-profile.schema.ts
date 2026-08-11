// biome-ignore-all lint/performance/noBarrelFile: Phase 2 keeps this file as a compat wrapper over the canonical db package.
export type {
  OpenMeldProfileKind,
  OpenMeldProfileManagedRole,
  OpenMeldProfileSource,
  OpenMeldProfileStatus,
} from "@openmeld/db/auth";
export {
  OPENMELD_PROFILE_KINDS,
  OPENMELD_PROFILE_MANAGED_ROLES,
  OPENMELD_PROFILE_SOURCES,
  OPENMELD_PROFILE_STATUSES,
  openMeldProfiles,
  openMeldProfilesRelations,
} from "@openmeld/db/auth";
