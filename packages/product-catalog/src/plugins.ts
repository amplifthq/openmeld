import type {
  ConnectorAppCatalogProvider,
  ConnectorCredentialAuthType,
  ConnectorService,
} from "@openmeld/schemas/types";

export const PLUGIN_CATEGORIES = [
  "All",
  "Productivity",
  "Developer tools",
  "Communication",
  "Marketing",
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
  inputType?: "text" | "password" | "textarea" | "json";
  required?: boolean;
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
      configured?: boolean;
    };

export type PluginConnection = {
  auth: PluginConnectionAuth;
  credentials?: readonly PluginCredentialAuth[];
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

export const GITHUB_PLUGIN = {
  availability: "available",
  category: "Developer tools",
  connection: { auth: { kind: "oauth" } },
  description: "Read repositories and pull requests, and create issues.",
  homepage: "https://github.com",
  logoPath: "/app-logos/github.svg",
  name: "GitHub",
  service: "github",
} as const satisfies PluginDefinition;

export const PLUGINS = [
  {
    availability: "available",
    category: "Communication",
    connection: { auth: { kind: "oauth" } },
    description:
      "Search and work with Slack messages and files using your authorized account.",
    homepage: "https://slack.com",
    logoPath: SLACK_CHANNEL_IDENTITY.logoPath,
    name: "Slack",
    service: "slack",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description:
      "Work with documents, wikis, tables, and calendars using your authorized Lark account.",
    homepage: "https://www.larksuite.com",
    logoPath: FEISHU_CHANNEL_LOGO_PATH,
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
  GITHUB_PLUGIN,
  {
    availability: "available",
    category: "Productivity",
    connection: {
      auth: { kind: "oauth" },
    },
    description: "Work with Drive files using the access you grant.",
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
    description: "Work with calendars and events using the access you grant.",
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
    description: "Work with email using the access you grant.",
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
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Read and update spreadsheet rows, tables, and charts.",
    homepage: "https://workspace.google.com/products/sheets/",
    logoPath: "/app-logos/google-sheets.svg",
    name: "Google Sheets",
    service: "googlesheets",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Read, create, edit, and export documents.",
    homepage: "https://workspace.google.com/products/docs/",
    logoPath: "/app-logos/google-docs.svg",
    name: "Google Docs",
    service: "googledocs",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Create presentations and update slides from your templates.",
    homepage: "https://workspace.google.com/products/slides/",
    logoPath: "/app-logos/google-slides.svg",
    name: "Google Slides",
    service: "googleslides",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Create forms, update questions, and read responses.",
    homepage: "https://workspace.google.com/products/forms/",
    logoPath: "/app-logos/google-forms.svg",
    name: "Google Forms",
    service: "googleforms",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: { auth: { kind: "oauth" } },
    description:
      "Read traffic, acquisition, engagement, and conversion reports.",
    homepage: "https://analytics.google.com",
    logoPath: "/app-logos/google-analytics.svg",
    name: "Google Analytics",
    service: "google_analytics",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: { auth: { kind: "oauth" } },
    description: "Check search performance, inspect URLs, and manage sitemaps.",
    homepage: "https://search.google.com/search-console",
    logoPath: "/app-logos/google-search-console.svg",
    name: "Google Search Console",
    service: "google_search_console",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "api_key",
        fields: [
          {
            key: "apiKey",
            label: "Access token",
            description:
              "A Vercel access token for the projects you want to use.",
            inputType: "password",
            required: true,
            secret: true,
          },
          {
            key: "teamId",
            label: "Team ID",
            description:
              "For a team-owned project, provide its Team ID or Team slug.",
            placeholder: "team_...",
            required: false,
            secret: false,
          },
          {
            key: "slug",
            label: "Team slug",
            description:
              "Use this instead of Team ID if you prefer the team's slug.",
            placeholder: "my-team",
            required: false,
            secret: false,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Inspect projects, deployments, and logs, and manage releases.",
    homepage: "https://vercel.com",
    logoPath: "/app-logos/vercel.svg",
    name: "Vercel",
    service: "vercel",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: { auth: { kind: "oauth" } },
    description:
      "Find and update contacts, companies, and deals, and read campaign analytics.",
    homepage: "https://www.hubspot.com",
    logoPath: "/app-logos/hubspot.svg",
    name: "HubSpot",
    service: "hubspot",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Read and update records, tables, and fields in your bases.",
    homepage: "https://airtable.com",
    logoPath: "/app-logos/airtable.svg",
    name: "Airtable",
    service: "airtable",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: { auth: { kind: "oauth" } },
    description:
      "Run read-only database queries and manage projects, storage, and Edge Functions.",
    homepage: "https://supabase.com",
    logoPath: "/app-logos/supabase.svg",
    name: "Supabase",
    service: "supabase",
  },
  {
    availability: "available",
    category: "Communication",
    connection: { auth: { kind: "oauth" } },
    description: "Read and manage your email, and send or reply to messages.",
    homepage: "https://outlook.com",
    logoPath: "/app-logos/outlook.svg",
    name: "Outlook",
    service: "outlook",
  },
  {
    availability: "available",
    category: "Communication",
    connection: {
      auth: {
        authType: "api_key",
        fields: [
          {
            key: "apiKey",
            label: "API key",
            description:
              "A Resend API key with access to the email actions you need.",
            inputType: "password",
            required: true,
            secret: true,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Send and schedule email, and inspect messages and attachments.",
    homepage: "https://resend.com",
    logoPath: "/app-logos/resend.svg",
    name: "Resend",
    service: "resend",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description:
      "Manage meeting spaces and read available recordings, transcripts, and notes.",
    homepage: "https://workspace.google.com/products/meet/",
    logoPath: "/app-logos/google-meet.svg",
    name: "Google Meet",
    service: "googlemeet",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: { auth: { kind: "oauth" } },
    description: "Read advertising reports and manage campaigns and ad groups.",
    homepage: "https://ads.google.com",
    logoPath: "/app-logos/google-ads.svg",
    name: "Google Ads",
    service: "googleads",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: {
      auth: {
        authType: "api_key",
        fields: [
          {
            key: "apiKey",
            label: "Access token",
            description:
              "A Meta access token with access to the ad accounts and reports you need.",
            placeholder: "EAAG...",
            inputType: "password",
            required: true,
            secret: true,
          },
        ],
        kind: "credential",
      },
    },
    description: "Read ad accounts, campaigns, and advertising insights.",
    homepage: "https://developers.facebook.com",
    logoPath: "/app-logos/meta.svg",
    name: "Meta",
    service: "meta",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: { auth: { kind: "oauth" } },
    description: "Manage audiences, subscribers, and tags.",
    homepage: "https://mailchimp.com",
    logoPath: "/app-logos/mailchimp.svg",
    name: "Mailchimp",
    service: "mailchimp",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description:
      "Create and export designs, upload assets, and manage folders.",
    homepage: "https://www.canva.com",
    logoPath: "/app-logos/canva.svg",
    name: "Canva",
    service: "canva",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "api_key",
        fields: [
          {
            key: "apiKey",
            label: "API key",
            description: "A Neon API key for the projects you want to manage.",
            placeholder: "napi_...",
            inputType: "password",
            required: true,
            secret: true,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Manage database projects, branches, databases, and operations.",
    homepage: "https://neon.com",
    logoPath: "/app-logos/neon.svg",
    name: "Neon",
    service: "neon",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: { auth: { kind: "oauth" } },
    description: "Manage projects, issues, and merge requests.",
    homepage: "https://gitlab.com",
    logoPath: "/app-logos/gitlab.svg",
    name: "GitLab",
    service: "gitlab",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "api_key",
        fields: [
          {
            key: "apiKey",
            label: "Credential",
            description:
              "Enter your Docker username and personal access token, separated by a colon. Organization names and organization access tokens are also supported.",
            placeholder: "username:dckr_pat_...",
            inputType: "password",
            required: true,
            secret: true,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Inspect image repositories and tags, and manage repositories and organization members.",
    homepage: "https://hub.docker.com",
    logoPath: "/app-logos/docker-hub.svg",
    name: "Docker Hub",
    service: "docker_hub",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: { auth: { kind: "oauth" } },
    description:
      "Investigate issues, events, releases, and replays, and update issues.",
    homepage: "https://sentry.io",
    logoPath: "/app-logos/sentry.svg",
    name: "Sentry",
    service: "sentry",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description:
      "Search and manage files, folders, revisions, and shared links.",
    homepage: "https://www.dropbox.com",
    logoPath: "/app-logos/dropbox.svg",
    name: "Dropbox",
    service: "dropbox",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Manage tasks, lists, spaces, comments, and custom fields.",
    homepage: "https://clickup.com",
    logoPath: "/app-logos/clickup.svg",
    name: "ClickUp",
    service: "clickup",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Manage boards, items, updates, documents, and dashboards.",
    homepage: "https://monday.com",
    logoPath: "/app-logos/monday.svg",
    name: "monday.com",
    service: "monday",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description:
      "Manage projects, tasks, dependencies, comments, and attachments.",
    homepage: "https://asana.com",
    logoPath: "/app-logos/asana.svg",
    name: "Asana",
    service: "asana",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description:
      "Create boards and work with notes, text, shapes, and connectors.",
    homepage: "https://miro.com",
    logoPath: "/app-logos/miro.svg",
    name: "Miro",
    service: "miro",
  },
  {
    availability: "available",
    category: "Communication",
    connection: { auth: { kind: "oauth" } },
    description: "Manage contacts and reply to customer conversations.",
    homepage: "https://www.intercom.com",
    logoPath: "/app-logos/intercom.svg",
    name: "Intercom",
    service: "intercom",
  },
  {
    availability: "available",
    category: "Communication",
    connection: { auth: { kind: "oauth" } },
    description:
      "Read and update support tickets, reply to customers, and find users.",
    homepage: "https://www.zendesk.com",
    logoPath: "/app-logos/zendesk.svg",
    name: "Zendesk",
    service: "zendesk",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: {
      auth: {
        authType: "api_key",
        fields: [
          {
            key: "apiKey",
            label: "Admin API access token",
            description:
              "A Shopify Admin API access token with the scopes you need.",
            placeholder: "shpat_...",
            inputType: "password",
            required: true,
            secret: true,
          },
          {
            key: "shopDomain",
            label: "Shop domain",
            description: "Your store's myshopify.com domain.",
            placeholder: "acme.myshopify.com",
            inputType: "text",
            required: true,
            secret: false,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Manage products, inventory, and fulfillment, and read orders and customers through the Admin GraphQL API.",
    homepage: "https://www.shopify.com",
    logoPath: "/app-logos/shopify.svg",
    name: "Shopify Admin",
    service: "shopify_admin",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description:
      "Search content, read spaces and pages, and create or update pages.",
    homepage: "https://www.atlassian.com/software/confluence",
    logoPath: "/app-logos/confluence.svg",
    name: "Confluence",
    service: "confluence",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: {
      auth: {
        authType: "custom_credential",
        fields: [
          {
            key: "apiKey",
            label: "API key",
            description: "The Trello API key from your app's API Key tab.",
            placeholder: "Trello API key",
            inputType: "password",
            required: true,
            secret: true,
          },
          {
            key: "apiToken",
            label: "API token",
            description:
              "The Trello token generated beside your API key. This is different from the API secret or an Atlassian API token.",
            placeholder: "Trello API token",
            inputType: "password",
            required: true,
            secret: true,
          },
        ],
        kind: "credential",
      },
    },
    description: "Manage boards, lists, cards, checklists, and comments.",
    homepage: "https://trello.com",
    logoPath: "/app-logos/trello.svg",
    name: "Trello",
    service: "trello",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Find projects and issues, create issues, and add comments.",
    homepage: "https://www.atlassian.com/software/jira",
    logoPath: "/app-logos/jira.svg",
    name: "Jira",
    service: "jira",
  },
  {
    availability: "available",
    category: "Marketing",
    connection: {
      auth: {
        authType: "api_key",
        fields: [
          {
            key: "apiKey",
            label: "Secret or restricted API key",
            description:
              "A Stripe secret or restricted API key with access to the customers, products, and prices you need.",
            placeholder: "sk_test_...",
            inputType: "password",
            required: true,
            secret: true,
          },
        ],
        kind: "credential",
      },
    },
    description: "Manage customers, products, and prices.",
    homepage: "https://stripe.com",
    logoPath: "/app-logos/stripe.svg",
    name: "Stripe",
    service: "stripe",
  },
] as const satisfies readonly PluginDefinition[];

export function findPluginDefinition(service: string): PluginDefinition | null {
  return PLUGINS.find((plugin) => plugin.service === service) ?? null;
}

/** Static entries supply editorial presentation, never provider admission. */
export function pluginFromProvider(
  provider: ConnectorAppCatalogProvider
): PluginDefinition {
  const featured = findPluginDefinition(provider.service);
  // Older producers have not opted into the connection metadata contract.
  if (!provider.connectionAuth && featured) {
    return featured;
  }
  const credential = provider.connectionAuth?.credentials[0];
  let auth: PluginConnectionAuth | null = credential
    ? { kind: "credential", ...credential }
    : null;
  if (provider.authTypes.includes("oauth2")) {
    auth = {
      kind: "oauth",
      configured: provider.connectionAuth?.oauth,
      ...(credential
        ? {
            credentialFallback: {
              kind: "credential" as const,
              ...credential,
              switchLabel: "Use credentials",
            },
          }
        : {}),
    };
  }
  // GitHub organization installation setup uses its existing dedicated path.
  let connection: PluginConnection | null = auth
    ? {
        auth,
        credentials: provider.connectionAuth?.credentials.map((option) => ({
          kind: "credential",
          ...option,
        })),
      }
    : null;
  if (provider.service === "github") {
    connection = GITHUB_PLUGIN.connection;
  }
  const presentation = {
    category: featured?.category ?? ("Productivity" as const),
    description:
      featured?.description ??
      `Connect ${provider.displayName} to use its available actions.`,
    homepage: provider.homepageUrl ?? "",
    logoPath: provider.iconUrl ?? featured?.logoPath ?? "",
    name: provider.displayName,
    service: provider.service,
  };
  return connection
    ? { ...presentation, availability: "available", connection }
    : { ...presentation, availability: "planned", connection: null };
}
