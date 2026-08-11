import type { StoredActiveOrganization } from "../config/auth-session";

export function formatOrganizationLabel(
  organization: StoredActiveOrganization
): string {
  const role = organization.role ? `, ${organization.role}` : "";
  return `${organization.name} (${organization.slug})${role}`;
}
