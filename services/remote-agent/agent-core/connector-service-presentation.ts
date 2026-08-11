import type { CENTER_AGENT_APP_CONNECTOR_SERVICES } from "@openmeld/schemas";

export type CenterAgentAppConnectorService =
  (typeof CENTER_AGENT_APP_CONNECTOR_SERVICES)[number];

const CONNECTED_APP_DISPLAY_NAME: Record<
  CenterAgentAppConnectorService,
  string
> = {
  cloudflare_browser_rendering: "Cloudflare Browser Rendering",
  cloudflare_dns: "Cloudflare DNS",
  cloudflare_r2: "Cloudflare R2",
  cloudflare_worker: "Cloudflare Workers",
  figma: "Figma",
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  linear: "Linear",
  notion: "Notion",
  posthog: "PostHog",
};

export function resolveConnectedAppDisplayName(
  service: unknown
): string | null {
  if (
    typeof service !== "string" ||
    !Object.hasOwn(CONNECTED_APP_DISPLAY_NAME, service)
  ) {
    return null;
  }
  return getConnectedAppDisplayName(service as CenterAgentAppConnectorService);
}

export function getConnectedAppDisplayName(
  service: CenterAgentAppConnectorService
): string {
  return CONNECTED_APP_DISPLAY_NAME[service];
}
