import { maskEmailForDisplay } from "./mask-email";

const TRAILING_SLASH_PATTERN = /\/$/;

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

/**
 * Builds the web URL for an organization invitation acceptance link.
 *
 * Besides the invitation id, the link carries display context the accept page
 * uses to branch precisely:
 * - `hint`: the recipient email in masked form only (never the full address,
 *   because the URL reaches browser history, logs, and referrers).
 * - `org`: the organization name, for human-readable copy.
 * - `orgSlug`: the organization slug, used to route into the organization when
 *   the invitation is already accepted or no longer valid. The slug already
 *   appears in `/o/{slug}/` URLs and is not sensitive.
 *
 * Optional fields are omitted from the query string when absent, so a missing
 * organization slug or recipient simply produces a shorter link.
 */
export function buildOrganizationInvitationWebUrl(input: {
  webAppUrl: string;
  invitationId: string;
  recipientEmail?: string | null;
  organizationName?: string | null;
  organizationSlug?: string | null;
}): string {
  const maskedRecipient = input.recipientEmail
    ? maskEmailForDisplay(input.recipientEmail)
    : null;
  const organizationName = readOptionalString(input.organizationName);
  const organizationSlug = readOptionalString(input.organizationSlug);
  const params: [key: string, value: string][] = [
    ["invitationId", input.invitationId],
  ];
  if (maskedRecipient) {
    params.push(["hint", maskedRecipient]);
  }
  if (organizationName) {
    params.push(["org", organizationName]);
  }
  if (organizationSlug) {
    params.push(["orgSlug", organizationSlug]);
  }

  try {
    const invitationUrl = new URL("/accept-invitation", input.webAppUrl);
    for (const [key, value] of params) {
      invitationUrl.searchParams.set(key, value);
    }
    return invitationUrl.toString();
  } catch {
    const sanitizedBaseUrl = input.webAppUrl.replace(
      TRAILING_SLASH_PATTERN,
      ""
    );
    const query = params
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    return `${sanitizedBaseUrl}/accept-invitation?${query}`;
  }
}
