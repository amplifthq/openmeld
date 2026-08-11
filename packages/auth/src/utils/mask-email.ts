/**
 * Produces a masked, display-safe rendering of an email address.
 *
 * The masked form is intended to be embedded in URLs (invitation links) and
 * shown in the UI as a hint about which address an action belongs to. It must
 * never reveal the full local part, because invitation URLs land in browser
 * history, server logs, and HTTP referrers.
 *
 * Rules:
 * - `beatrice@gmail.com` -> `b***@gmail.com` (first local char + `***` + domain)
 * - `a@example.com`      -> `***@example.com` (single-char local is never shown)
 * - anything without a usable `local@domain` shape -> `***` (fail closed)
 *
 * The domain is preserved as-is: it is not sensitive and is useful for the
 * recipient to recognize the account.
 */

const MASK = "***";

export function maskEmailForDisplay(email: string): string {
  if (typeof email !== "string") {
    return MASK;
  }

  const trimmed = email.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    // No `@`, empty local part, or empty domain: never echo the raw input.
    return MASK;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (domain.length === 0) {
    return MASK;
  }

  const visiblePrefix = localPart.length >= 2 ? localPart.slice(0, 1) : "";
  return `${visiblePrefix}${MASK}@${domain}`;
}
