export function isProfileHandleUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("UNIQUE constraint failed") &&
    message.includes("profile_handle")
  ) {
    return true;
  }
  if (message.includes("openmeld_profiles_owner_handle_uq_idx")) {
    return true;
  }

  const cause =
    "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  return cause ? isProfileHandleUniqueConstraintError(cause) : false;
}
