import * as z from "zod/v4";

const nonEmptyStringSchema = z.string().trim().min(1);
const LOCAL_WEB_URL = "http://localhost";
const TRAILING_SLASH_PATTERN = /\/+$/u;

export const computerSetupModeSchema = z.enum([
  "setup",
  "reconnect",
  "update_service",
]);

export const openMeldWebUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "OpenMeld Web URL must use HTTP or HTTPS.");

export const computerSetupNavigationTargetSchema = z.discriminatedUnion(
  "mode",
  [
    z.strictObject({
      kind: z.literal("computer_setup"),
      mode: z.literal("setup"),
    }),
    z.strictObject({
      connectedComputerId: nonEmptyStringSchema,
      kind: z.literal("computer_setup"),
      mode: z.literal("reconnect"),
    }),
    z.strictObject({
      connectedComputerId: nonEmptyStringSchema,
      kind: z.literal("computer_setup"),
      mode: z.literal("update_service"),
    }),
  ]
);

export const openMeldNavigationTargetSchema = z.union([
  z.strictObject({
    kind: z.literal("organization_app"),
    service: z.literal("github"),
  }),
  z.strictObject({
    kind: z.literal("space"),
    spaceId: nonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal("projects"),
  }),
  z.strictObject({
    kind: z.literal("project"),
    projectId: nonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal("slack_identity_link"),
  }),
  z.strictObject({
    connectToUserId: nonEmptyStringSchema.optional(),
    kind: z.literal("message_channel_identity_link"),
    purpose: z.enum(["continue_request", "optional_setup"]),
    requestedAction: nonEmptyStringSchema.max(160).optional(),
  }),
  computerSetupNavigationTargetSchema,
]);

export const navigationActionSchema = z.strictObject({
  label: nonEmptyStringSchema,
  target: openMeldNavigationTargetSchema,
  url: openMeldWebUrlSchema,
});

export type OpenMeldNavigationTarget = z.infer<
  typeof openMeldNavigationTargetSchema
>;
export type NavigationAction = z.infer<typeof navigationActionSchema>;

export function buildOrganizationRootPath(orgSlug: string): string {
  return `/o/${encodePathSegment(nonEmptyStringSchema.parse(orgSlug))}`;
}

export function buildOrganizationPluginsPath(orgSlug: string): string {
  return `${buildOrganizationRootPath(orgSlug)}/plugins`;
}

export function buildOrganizationPluginPath(input: {
  orgSlug: string;
  service: string;
}): string {
  return `${buildOrganizationPluginsPath(input.orgSlug)}/${encodePathSegment(nonEmptyStringSchema.parse(input.service))}`;
}

export function buildOrganizationSpacePath(input: {
  orgSlug: string;
  search?: Record<string, string | null | undefined>;
  spaceId: string;
}): string {
  const url = new URL(
    `${buildOrganizationRootPath(input.orgSlug)}/spaces/${encodePathSegment(nonEmptyStringSchema.parse(input.spaceId))}`,
    LOCAL_WEB_URL
  );
  for (const [key, value] of Object.entries(input.search ?? {})) {
    if (typeof value === "string" && value.trim().length > 0) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

export function buildOpenMeldOrganizationWebUrl(input: {
  organizationSlug: string;
  webAppUrl: string;
}): string {
  const organizationSlug = nonEmptyStringSchema.parse(input.organizationSlug);
  const url = parseHttpUrl(input.webAppUrl, "Web app URL");
  url.hash = "";
  url.pathname = buildOrganizationRootPath(organizationSlug);
  url.search = "";
  return url.toString();
}

export function buildOpenMeldNavigationAction(input: {
  organizationWebUrl: string;
  target: OpenMeldNavigationTarget;
}): NavigationAction {
  const target = openMeldNavigationTargetSchema.parse(input.target);
  const url = parseHttpUrl(input.organizationWebUrl, "Organization Web URL");
  url.hash = "";
  url.search = "";
  const organizationPath = url.pathname.replace(TRAILING_SLASH_PATTERN, "");
  let label: string;
  switch (target.kind) {
    case "organization_app":
      label = "Open GitHub access";
      url.pathname = `${organizationPath}/center-agent/plugins/${encodePathSegment(target.service)}`;
      break;
    case "space":
      label = "Open this Space";
      url.pathname = `${organizationPath}/spaces/${encodePathSegment(target.spaceId)}`;
      break;
    case "projects":
      label = "Open Projects";
      url.pathname = `${organizationPath}/projects`;
      break;
    case "project":
      label = "Open this Project";
      url.pathname = `${organizationPath}/projects/${encodePathSegment(target.projectId)}`;
      break;
    case "slack_identity_link":
      throw new TypeError(
        "Slack identity-link actions must be issued by OpenMeld Core."
      );
    case "message_channel_identity_link":
      throw new TypeError(
        "Message Channel identity-link actions must be issued by OpenMeld Core."
      );
    case "computer_setup":
      url.pathname = `${organizationPath}/connect`;
      if (target.mode === "setup") {
        label = "Connect this computer";
        break;
      }
      url.searchParams.set("connectedComputerId", target.connectedComputerId);
      url.searchParams.set("session", "fresh");
      if (target.mode === "reconnect") {
        label = "Reconnect this computer";
        break;
      }
      label = "Update OpenMeld on Computer";
      url.searchParams.set("serviceAction", "update_service");
      url.searchParams.sort();
      break;
    default:
      return unreachableNavigationTarget(target);
  }

  return navigationActionSchema.parse({
    label,
    target,
    url: url.toString(),
  });
}

export function buildSlackIdentityLinkNavigationAction(input: {
  organizationName: string;
  purpose?: "continue_request" | "optional_setup";
  token: string;
  webAppUrl: string;
}): NavigationAction {
  nonEmptyStringSchema.parse(input.organizationName);
  const token = nonEmptyStringSchema.parse(input.token);
  const url = parseHttpUrl(input.webAppUrl, "Web app URL");
  url.hash = "";
  url.pathname = "/link-slack";
  url.search = "";
  url.searchParams.set("token", token);
  return navigationActionSchema.parse({
    label:
      input.purpose === "optional_setup"
        ? "Connect my account"
        : "Connect my account and continue",
    target: {
      kind: "message_channel_identity_link",
      purpose: input.purpose ?? "continue_request",
    },
    url: url.toString(),
  });
}

function unreachableNavigationTarget(target: never): never {
  throw new TypeError(`Unsupported OpenMeld navigation target: ${target}`);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function parseHttpUrl(value: string, label: string): URL {
  const result = openMeldWebUrlSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(`${label} must use HTTP or HTTPS.`);
  }
  return new URL(result.data);
}
