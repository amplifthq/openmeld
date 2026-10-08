import { isPostgresUniqueViolation } from "@openmeld/db/postgresql";

export function isProfileHandleUniqueConstraintError(error: unknown): boolean {
  return isPostgresUniqueViolation(
    error,
    "openmeld_profiles_owner_handle_uq_idx"
  );
}
