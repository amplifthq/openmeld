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
      "Find messages and files, catch up on threads, and reply to your team.",
    homepage: "https://slack.com",
    logoPath: SLACK_CHANNEL_IDENTITY.logoPath,
    name: "Slack",
    service: "slack",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Read documents and find records in your team's tables.",
    homepage: "https://www.larksuite.com",
    logoPath: FEISHU_CHANNEL_LOGO_PATH,
    name: "Lark",
    service: "lark",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: { auth: { kind: "oauth" } },
    description: "Read documents and find records in your team's tables.",
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
    description:
      "Find, read, and organize files, and share them with your team.",
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
    description: "Check your schedule and create or update calendar events.",
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
    description: "Find emails, read conversations, and send replies.",
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
    description: "Find workspace information and update pages and databases.",
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
    description: "Find issues and track project progress.",
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
      "Update products and inventory, manage fulfillment, and look up orders and customers.",
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
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "custom_credential",
        fields: [
          {
            key: "accessKeyId",
            label: "Access Key ID",
            description:
              "AWS access key ID. Create or manage IAM user access keys here: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
            placeholder: "AKIA...",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "secretAccessKey",
            label: "Secret Access Key",
            description:
              "AWS secret access key from the same access key pair. AWS shows it only when you create the access key: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
            placeholder: "Your AWS secret access key",
            secret: true,
            inputType: "password",
            required: true,
          },
          {
            key: "region",
            label: "Region",
            description:
              "The default AWS region used for validation and S3 action execution. See the official S3 endpoints and region list: https://docs.aws.amazon.com/general/latest/gr/s3.html",
            placeholder: "us-east-1",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "bucket",
            label: "Default Bucket",
            description:
              "Optional default bucket reused by object-level actions. Use a bucket from your own S3 resources as documented here: https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html",
            placeholder: "my-bucket",
            secret: false,
            inputType: "text",
            required: false,
          },
          {
            key: "sessionToken",
            label: "Session Token",
            description:
              "Optional STS session token from the same temporary AWS credential set when you use STS or AssumeRole credentials.",
            placeholder: "Optional STS session token",
            secret: true,
            inputType: "password",
            required: false,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "List buckets, read and upload objects, and generate signed URLs.",
    homepage: "https://aws.amazon.com/s3/",
    logoPath: "/app-logos/aws-s3.svg",
    name: "AWS S3",
    service: "aws_s3",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "custom_credential",
        fields: [
          {
            key: "accessKeyId",
            label: "Access Key ID",
            description:
              "Alibaba Cloud RAM AccessKey ID used to call ACK. Create or manage AccessKey pairs here: https://www.alibabacloud.com/help/en/ram/user-guide/create-an-accesskey-pair",
            placeholder: "LTAI...",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "accessKeySecret",
            label: "Access Key Secret",
            description:
              "Alibaba Cloud RAM AccessKey secret from the same pair. Alibaba Cloud shows it only when the key pair is created: https://www.alibabacloud.com/help/en/ram/user-guide/create-an-accesskey-pair",
            placeholder: "Your AccessKey secret",
            secret: true,
            inputType: "password",
            required: true,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Get temporary credentials to connect to an ACK Kubernetes cluster.",
    homepage: "https://www.alibabacloud.com/product/kubernetes",
    logoPath: "/app-logos/alibaba-cloud.svg",
    name: "Alibaba Cloud ACK",
    service: "aliyun_ack",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "custom_credential",
        fields: [
          {
            key: "accessKeyId",
            label: "Access Key ID",
            description:
              "Alibaba Cloud AccessKey ID. Create or manage an AccessKey pair in RAM: https://www.alibabacloud.com/help/en/ram/user-guide/create-an-accesskey-pair",
            placeholder: "LTAI...",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "accessKeySecret",
            label: "Access Key Secret",
            description:
              "Alibaba Cloud AccessKey secret from the same RAM AccessKey pair. Alibaba Cloud shows it only when you create the key pair: https://www.alibabacloud.com/help/en/ram/user-guide/create-an-accesskey-pair",
            placeholder: "Your AccessKey secret",
            secret: true,
            inputType: "password",
            required: true,
          },
          {
            key: "endpoint",
            label: "OSS Endpoint",
            description:
              "The default OSS endpoint used for validation and action execution. Find the endpoint for your region here: https://www.alibabacloud.com/help/en/oss/user-guide/regions-and-endpoints",
            placeholder: "oss-cn-hangzhou.aliyuncs.com",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "bucket",
            label: "Default Bucket",
            description:
              "Optional default bucket reused by object-level actions. Use a bucket from your own OSS resources in the OSS console: https://oss.console.aliyun.com/overview",
            placeholder: "my-bucket",
            secret: false,
            inputType: "text",
            required: false,
          },
          {
            key: "securityToken",
            label: "Security Token",
            description:
              "Optional STS security token when using temporary AK/SK credentials from your own Alibaba Cloud STS flow.",
            placeholder: "Optional STS token",
            secret: true,
            inputType: "password",
            required: false,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "List buckets, read and upload objects, and generate signed URLs.",
    homepage: "https://www.alibabacloud.com",
    logoPath: "/app-logos/alibaba-cloud.svg",
    name: "Alibaba Cloud OSS",
    service: "aliyun_oss",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "custom_credential",
        fields: [
          {
            key: "accessKeyId",
            label: "Access Key ID",
            description:
              "The Alibaba Cloud RAM AccessKey ID used to call Simple Log Service. Use a RAM identity with only the required SLS permissions.",
            placeholder: "LTAI...",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "accessKeySecret",
            label: "Access Key Secret",
            description:
              "The AccessKey secret from the same Alibaba Cloud RAM AccessKey pair.",
            placeholder: "Your AccessKey secret",
            secret: true,
            inputType: "password",
            required: true,
          },
          {
            key: "endpoint",
            label: "Default Regional Endpoint",
            description:
              "The default regional Simple Log Service endpoint used by actions that omit endpoint, for example cn-hangzhou.log.aliyuncs.com.",
            placeholder: "cn-hangzhou.log.aliyuncs.com",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "securityToken",
            label: "Security Token",
            description:
              "An optional Alibaba Cloud STS security token used with temporary AccessKey credentials.",
            placeholder: "Optional STS token",
            secret: true,
            inputType: "password",
            required: false,
          },
          {
            key: "resourceScope",
            label: "Resource Scope",
            description:
              "Optional connector-local resource allowlist as a JSON array. Leave it blank to set no local resource restriction and use list_projects and list_logstores to discover resources allowed by RAM. Each item requires project; endpoint is optional and defaults to the connection endpoint. Omitting logstores allows every Logstore in that Project. When logstores is provided, it must contain only non-empty, unique Logstore names and only those Logstores are accessible. This local allowlist does not replace Alibaba Cloud RAM permissions.",
            secret: false,
            inputType: "json",
            required: false,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Find projects and Logstores, query logs, and read log histograms.",
    homepage: "https://www.alibabacloud.com/product/log-service",
    logoPath: "/app-logos/alibaba-cloud.svg",
    name: "Alibaba Cloud SLS",
    service: "aliyun_sls",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "custom_credential",
        fields: [],
        kind: "credential",
      },
    },
    description:
      "Search Cloudflare documentation and read the Pages migration guide.",
    homepage: "https://developers.cloudflare.com",
    logoPath: "/app-logos/cloudflare.svg",
    name: "Cloudflare Docs",
    service: "cloudflare_docs",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        authType: "custom_credential",
        fields: [
          {
            key: "email",
            label: "Cloudflare Account Email",
            description:
              "Email address for legacy Global API Key authentication. Leave blank when using a cfut_ User API Token with Email Routing permissions.",
            placeholder: "you@example.com",
            secret: false,
            inputType: "text",
            required: false,
          },
          {
            key: "apiKey",
            label: "Cloudflare API Credential",
            description:
              "Use a cfut_ User API Token with Email Routing Rules/Addresses permissions, or a Global API Key (cfk_ or legacy format) with the account email. Cloudflare cfat_ Account API Tokens are not accepted by the Email Routing API: https://developers.cloudflare.com/fundamentals/api/reference/permissions/.",
            placeholder: "cloudflare_global_api_key",
            secret: true,
            inputType: "password",
            required: true,
          },
          {
            key: "accountId",
            label: "Cloudflare Account ID",
            description:
              "Default account ID for destination addresses and account rule listings. Action inputs may override it.",
            placeholder: "32-character Cloudflare account ID",
            secret: false,
            inputType: "text",
            required: true,
          },
          {
            key: "zoneId",
            label: "Cloudflare Zone ID",
            description:
              "Default zone ID for routing rule actions. Action inputs may override it.",
            placeholder: "32-character Cloudflare zone ID",
            secret: false,
            inputType: "text",
            required: true,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Manage email routing rules and list verified destination addresses.",
    homepage: "https://www.cloudflare.com",
    logoPath: "/app-logos/cloudflare.svg",
    name: "Cloudflare Email Routing",
    service: "cloudflare_email_routing",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description:
      "Search Cloudflare documentation, discover API endpoints, and run API calls.",
    homepage: "https://github.com/cloudflare/mcp",
    logoPath: "/app-logos/cloudflare.svg",
    name: "Cloudflare MCP",
    service: "cloudflare_mcp",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description:
      "Create workbooks and edit worksheets, tables, and cell ranges.",
    homepage: "https://www.microsoft.com/microsoft-365/excel",
    logoPath: "/app-logos/microsoft-excel.svg",
    name: "Excel",
    service: "excel",
  },
  {
    availability: "available",
    category: "Communication",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description:
      "Read teams, channels, and chats, and send or reply to messages.",
    homepage: "https://www.microsoft.com/microsoft-teams/",
    logoPath: "/app-logos/microsoft-teams.svg",
    name: "Microsoft Teams",
    service: "microsoft_teams",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description:
      "Search files and folders, upload and download files, and update items.",
    homepage:
      "https://www.microsoft.com/microsoft-365/onedrive/online-cloud-storage",
    logoPath: "/app-logos/one-drive.svg",
    name: "OneDrive",
    service: "one_drive",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description:
      "Read and update calendars and events, and respond to invitations.",
    homepage:
      "https://www.microsoft.com/microsoft-365/outlook/outlook-calendar",
    logoPath: "/app-logos/outlook.svg",
    name: "Outlook Calendar",
    service: "outlook_calendar",
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
            label: "API Access Token",
            description:
              "Microsoft Clarity API access token sent with the Authorization Bearer header. Project admins can generate it in Settings > Data Export in the Clarity dashboard, as documented at https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api.",
            placeholder: "clarity_api_token",
            secret: true,
            inputType: "password",
            required: true,
          },
        ],
        kind: "credential",
      },
    },
    description: "Export recent live insights from your Clarity project.",
    homepage: "https://clarity.microsoft.com",
    logoPath: "/app-logos/microsoft-clarity.png",
    name: "Microsoft Clarity",
    service: "microsoft_clarity",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description:
      "Find upcoming meetings, schedule new ones, and update meeting details.",
    homepage: "https://www.zoom.com",
    logoPath: "/app-logos/zoom.svg",
    name: "Zoom",
    service: "zoom",
  },
  {
    availability: "available",
    category: "Productivity",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description:
      "Search files and folders, upload and download files, and update items.",
    homepage: "https://www.box.com",
    logoPath: "/app-logos/box.svg",
    name: "Box",
    service: "box",
  },
  {
    availability: "available",
    category: "Developer tools",
    connection: {
      auth: {
        kind: "oauth",
      },
    },
    description: "Read metrics and monitors, and query metric time series.",
    homepage: "https://www.datadoghq.com/",
    logoPath: "/app-logos/datadog.svg",
    name: "Datadog",
    service: "datadog",
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
            label: "Bot Token",
            description:
              "Create a bot in the Discord Developer Portal and invite it to the servers you want to use. Enter its Bot Token here.",
            placeholder: "Discord bot token",
            inputType: "password",
            required: true,
            secret: true,
          },
        ],
        kind: "credential",
      },
    },
    description:
      "Read channel messages, send messages, and manage servers with your bot.",
    homepage: "https://discord.com/developers/docs",
    logoPath: "/app-logos/discord.svg",
    name: "Discord Bot",
    service: "discordbot",
  },
] as const satisfies readonly PluginDefinition[];

export function findPluginDefinition(service: string): PluginDefinition | null {
  return PLUGINS.find((plugin) => plugin.service === service) ?? null;
}

/** Browse only selected Plugins with a runtime connection path; retain accounts
 * already connected so their owners can still manage or disconnect them. */
export function pluginsForCatalog(
  providers: readonly ConnectorAppCatalogProvider[],
  connectedServices: ReadonlySet<string> = new Set()
): PluginDefinition[] {
  const byService = new Map(
    providers.map((provider) => [provider.service, provider])
  );
  const services = new Set<string>([
    ...PLUGINS.map((plugin) => plugin.service),
    ...connectedServices,
  ]);
  return [...services].flatMap((service) => {
    const provider = byService.get(service);
    if (!provider) {
      const existing = findPluginDefinition(service);
      return connectedServices.has(service) && existing ? [existing] : [];
    }
    const plugin = pluginFromProvider(provider);
    const canConnect =
      provider.connectionAuth?.oauth === true ||
      (provider.connectionAuth?.credentials.length ?? 0) > 0;
    return canConnect || connectedServices.has(service) ? [plugin] : [];
  });
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
    logoPath: featured?.logoPath ?? provider.iconUrl ?? "",
    name: provider.displayName,
    service: provider.service,
  };
  return connection
    ? { ...presentation, availability: "available", connection }
    : { ...presentation, availability: "planned", connection: null };
}
