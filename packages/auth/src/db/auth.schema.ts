// biome-ignore-all lint/performance/noBarrelFile: Phase 2 keeps this file as a compat wrapper over the canonical db package.
export {
  accounts,
  accountsRelations,
  deviceCodes,
  passkeys,
  passkeysRelations,
  sessions,
  sessionsRelations,
  users,
  usersRelations,
  verifications,
} from "@openmeld/db/auth";
