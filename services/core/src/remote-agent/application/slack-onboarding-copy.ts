import { buildLocalizedSlackResearchUnavailableWelcomeMessage } from "./slack-onboarding-localization";

export function buildSlackResearchUnavailableWelcomeMessage(input: {
  displayName: string;
  languageTag?: string | null;
  organizationName: string;
  workspaceMoved?: boolean;
}): string {
  return buildLocalizedSlackResearchUnavailableWelcomeMessage(input);
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
