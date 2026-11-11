import { isPostgresCheckViolation } from "@openmeld/db/postgresql";
import { APIError } from "better-auth";

/** Preserve the native Auth error contract for an atomic Owner-retention refusal. */
export async function withOwnerRetentionError<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isPostgresCheckViolation(error, "organization_requires_owner")) {
      throw new APIError("CONFLICT", {
        code: "organization.last_owner",
        message:
          "An organization must keep at least one Owner. Refresh the members list and try again.",
      });
    }
    throw error;
  }
}
