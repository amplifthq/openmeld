import type {
	ConnectorCredentialAuthType,
	ConnectorService,
} from "@openmeld/schemas/types";

export const PLUGIN_CATEGORIES = [
	"All",
	"Productivity",
	"Developer tools",
	"Communication",
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];
export type PluginAvailability = "available" | "planned";

type PluginDefinitionBase = {
	category: Exclude<PluginCategory, "All">;
	description: string;
	homepage: string;
	logoPath: string;
	name: string;
	service: string;
};

export type PluginCredentialField = {
	description: string;
	key: string;
	label: string;
	placeholder?: string;
	secret: boolean;
};

export type PluginCredentialAuth = {
	authType: ConnectorCredentialAuthType;
	fields: readonly PluginCredentialField[];
	kind: "credential";
};

export type PluginConnectionAuth =
	| PluginCredentialAuth
	| {
			credentialFallback?: PluginCredentialAuth & { switchLabel: string };
			kind: "oauth";
	  };

export type PluginConnection = {
	auth: PluginConnectionAuth;
};

export type PluginDefinition = PluginDefinitionBase &
	(
		| {
				availability: "available";
				connection: PluginConnection;
				service: ConnectorService;
		  }
		| { availability: "planned"; connection: PluginConnection | null }
	);

export const SLACK_CHANNEL_IDENTITY = {
	logoPath: "/app-logos/slack.svg",
	service: "slack",
} as const;

const FEISHU_CHANNEL_LOGO_PATH = "/app-logos/feishu.svg";

export const LARK_CHANNEL_IDENTITY = {
	logoPath: FEISHU_CHANNEL_LOGO_PATH,
	service: "lark",
} as const;

export const FEISHU_CHANNEL_IDENTITY = {
	logoPath: FEISHU_CHANNEL_LOGO_PATH,
	service: "feishu",
} as const;

export const PLUGINS = [
	{
		availability: "available",
		category: "Productivity",
		connection: { auth: { kind: "oauth" } },
		description:
			"Work with documents, wikis, tables, and calendars using your authorized Lark account.",
		homepage: "https://www.larksuite.com",
		logoPath: "/app-logos/lark.svg",
		name: "Lark",
		service: "lark",
	},
	{
		availability: "available",
		category: "Productivity",
		connection: { auth: { kind: "oauth" } },
		description:
			"Work with documents, wikis, tables, and calendars using your authorized Feishu account.",
		homepage: "https://www.feishu.cn",
		logoPath: FEISHU_CHANNEL_LOGO_PATH,
		name: "Feishu",
		service: "feishu",
	},
	{
		availability: "available",
		category: "Developer tools",
		connection: {
			auth: { kind: "oauth" },
		},
		description: "Read repositories and pull requests, and create issues.",
		homepage: "https://github.com",
		logoPath: "/app-logos/github.svg",
		name: "GitHub",
		service: "github",
	},
	{
		availability: "available",
		category: "Productivity",
		connection: {
			auth: { kind: "oauth" },
		},
		description:
			"Find and read Drive files and metadata without changing them.",
		homepage: "https://workspace.google.com/products/drive/",
		logoPath: "/app-logos/google-drive.svg",
		name: "Google Drive",
		service: "googledrive",
	},
	{
		availability: "available",
		category: "Productivity",
		connection: {
			auth: { kind: "oauth" },
		},
		description: "Find and read calendars and events without changing them.",
		homepage: "https://workspace.google.com/products/calendar/",
		logoPath: "/app-logos/google-calendar.svg",
		name: "Google Calendar",
		service: "googlecalendar",
	},
	{
		availability: "available",
		category: "Communication",
		connection: {
			auth: { kind: "oauth" },
		},
		description: "Find and read email without sending or changing messages.",
		homepage: "https://workspace.google.com/products/gmail/",
		logoPath: "/app-logos/gmail.svg",
		name: "Gmail",
		service: "gmail",
	},
	{
		availability: "available",
		category: "Productivity",
		connection: {
			auth: {
				credentialFallback: {
					authType: "api_key",
					fields: [
						{
							description:
								"The installation access token from a Notion internal connection created by a Workspace Owner. Enable the capabilities OpenMeld should use, then grant Content access to the pages and databases you choose.",
							key: "apiKey",
							label: "Installation access token",
							placeholder: "Paste the token from Notion",
							secret: true,
						},
					],
					kind: "credential",
					switchLabel: "Use an internal connection token instead",
				},
				kind: "oauth",
			},
		},
		description:
			"Search workspace content and update pages and databases within the capabilities and Content access you grant.",
		homepage: "https://www.notion.com",
		logoPath: "/app-logos/notion.svg",
		name: "Notion",
		service: "notion",
	},
	{
		availability: "available",
		category: "Developer tools",
		connection: {
			auth: { kind: "oauth" },
		},
		description: "Read issues and help maintain project workflows.",
		homepage: "https://linear.plugin",
		logoPath: "/app-logos/linear.svg",
		name: "Linear",
		service: "linear",
	},
	{
		availability: "available",
		category: "Developer tools",
		connection: {
			auth: {
				credentialFallback: {
					authType: "api_key",
					fields: [
						{
							description:
								"A PostHog personal API key with the scopes you need.",
							key: "apiKey",
							label: "Personal API key",
							placeholder: "phx_...",
							secret: true,
						},
						{
							description:
								"Your PostHog instance URL, such as https://us.posthog.com.",
							key: "baseUrl",
							label: "PostHog URL",
							placeholder: "https://us.posthog.com",
							secret: false,
						},
					],
					kind: "credential",
					switchLabel: "Use a personal API key instead",
				},
				kind: "oauth",
			},
		},
		description:
			"Read product analytics, investigate behavior, and manage insights.",
		homepage: "https://posthog.com",
		logoPath: "/app-logos/posthog.svg",
		name: "PostHog",
		service: "posthog",
	},
	{
		availability: "available",
		category: "Productivity",
		connection: {
			auth: { kind: "oauth" },
		},
		description:
			"Read design files, inspect components, and collaborate through comments.",
		homepage: "https://www.figma.com",
		logoPath: "/app-logos/figma.svg",
		name: "Figma",
		service: "figma",
	},
	{
		availability: "available",
		category: "Developer tools",
		connection: {
			auth: { kind: "oauth" },
		},
		description:
			"Inspect and manage Workers, deployments, routes, and bindings.",
		homepage: "https://workers.cloudflare.com",
		logoPath: "/app-logos/cloudflare.svg",
		name: "Cloudflare Workers",
		service: "cloudflare_worker",
	},
	{
		availability: "available",
		category: "Developer tools",
		connection: {
			auth: {
				credentialFallback: {
					authType: "custom_credential",
					fields: [
						{
							description: "A Cloudflare API token with R2 permissions.",
							key: "apiKey",
							label: "API token",
							placeholder: "Cloudflare API token",
							secret: true,
						},
						{
							description: "The Cloudflare account that owns your R2 buckets.",
							key: "accountId",
							label: "Account ID",
							placeholder: "Cloudflare account ID",
							secret: false,
						},
					],
					kind: "credential",
					switchLabel: "Use an API token instead",
				},
				kind: "oauth",
			},
		},
		description: "Inspect and manage R2 buckets and stored objects.",
		homepage: "https://www.cloudflare.com/developer-platform/products/r2/",
		logoPath: "/app-logos/cloudflare.svg",
		name: "Cloudflare R2",
		service: "cloudflare_r2",
	},
	{
		availability: "available",
		category: "Developer tools",
		connection: {
			auth: { kind: "oauth" },
		},
		description: "Inspect zones and manage DNS records.",
		homepage: "https://www.cloudflare.com/application-services/products/dns/",
		logoPath: "/app-logos/cloudflare.svg",
		name: "Cloudflare DNS",
		service: "cloudflare_dns",
	},
	{
		availability: "available",
		category: "Developer tools",
		connection: {
			auth: {
				credentialFallback: {
					authType: "api_key",
					fields: [
						{
							description:
								"A Cloudflare API token with Browser Rendering permissions.",
							key: "apiKey",
							label: "API token",
							placeholder: "Cloudflare API token",
							secret: true,
						},
						{
							description:
								"The Cloudflare account that owns Browser Rendering.",
							key: "accountId",
							label: "Account ID",
							placeholder: "Cloudflare account ID",
							secret: false,
						},
					],
					kind: "credential",
					switchLabel: "Use an API token instead",
				},
				kind: "oauth",
			},
		},
		description:
			"Render pages and extract screenshots, links, and structured content.",
		homepage: "https://developers.cloudflare.com/browser-rendering/",
		logoPath: "/app-logos/cloudflare.svg",
		name: "Cloudflare Browser Rendering",
		service: "cloudflare_browser_rendering",
	},
] as const satisfies readonly PluginDefinition[];

export function findPluginDefinition(service: string): PluginDefinition | null {
	return PLUGINS.find((plugin) => plugin.service === service) ?? null;
}

export const GITHUB_PLUGIN = PLUGINS[0];
