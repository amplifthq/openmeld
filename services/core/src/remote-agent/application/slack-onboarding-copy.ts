const WHITESPACE_PATTERN = /\s+/u;

export function buildSlackResearchUnavailableWelcomeMessage(input: {
  displayName: string;
  organizationName: string;
  workspaceMoved?: boolean;
}): string {
  const firstName =
    input.displayName.trim().split(WHITESPACE_PATTERN)[0] || "there";
  const opening = input.workspaceMoved
    ? `Hi ${firstName} — this Slack workspace is now connected to *${input.organizationName}*.`
    : `Hi ${firstName} — welcome to *${input.organizationName}* in OpenMeld.`;
  return `${opening}

Center Agent couldn’t finish your first Profile Report, so it won’t guess about your work. You can still talk to Center Agent here now.

Reply “try again” to start a fresh Profile Report.`;
}

export function isMemberResearchBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "center_agent_member_research.already_running"
  );
}

export function requireWebAppUrl(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(
      "Core WEB_APP_URL is required to build Slack onboarding actions."
    );
  }
  try {
    return new URL(normalized).toString();
  } catch (error) {
    throw new Error(
      "Core WEB_APP_URL must be a valid URL to build Slack onboarding actions.",
      { cause: error }
    );
  }
}
