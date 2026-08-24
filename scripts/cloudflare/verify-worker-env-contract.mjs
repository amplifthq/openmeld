import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AUTH_DB_MIGRATIONS_PATH } from "../../packages/db/src/auth/fact-metadata.ts";
import {
  SHARED_DB_BINDING_NAME,
  SHARED_DB_DATABASE_ID,
  SHARED_DB_DATABASE_NAME,
} from "../../packages/db/src/shared/fact-metadata.ts";
import { parseJsoncObject as parseJsoncSource } from "../../packages/db/src/tooling/parse-jsonc.ts";
import { ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMIT } from "../../services/auth/src/lib/organization-join-link-accept-rate-limit.ts";
import { FEEDBACK_SUBMIT_RATE_LIMITS } from "../../services/gateway/src/feedback/feedback-submit-rate-limiter.ts";
import { SPACE_PASSWORD_RATE_LIMIT } from "../../services/gateway/src/lib/space-password-rate-limiter.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const DEV_VAR_KEY_PATTERN = /^([A-Z0-9_]+)=/u;
const CONFIG_ENV_LABEL_PREFIX_PATTERN = /^env\./u;
const OPENCONNECTOR_GOOGLE_ACTION_PATTERN =
  /^(?:gmail|googlecalendar|googledrive)\./u;
const OBSERVABILITY_ANALYTICS_BINDING = "OPENMELD_OBSERVABILITY";
const OBSERVABILITY_ANALYTICS_DATASET = "openmeld_runtime_evidence";
const OBSERVABILITY_ANALYTICS_PROD_DATASET = "openmeld_runtime_evidence_prod";
const DESKTOP_DOWNLOADS_R2_BINDING = "OPENMELD_DESKTOP_DOWNLOADS";
const DESKTOP_DOWNLOADS_R2_BUCKET = "openmeld-desktop-downloads-prod";
const SPACE_ATTACHMENTS_R2_BINDING = "OPENMELD_SPACE_ATTACHMENTS";
const SPACE_ATTACHMENTS_R2_BUCKET = "openmeld-space-attachments-prod";
const SPACE_ATTACHMENTS_R2_PREVIEW_BUCKET =
  "openmeld-space-attachments-preview";
const ORGANIZATION_SKILLS_R2_BINDING = "OPENMELD_ORGANIZATION_SKILLS";
const ORGANIZATION_SKILLS_R2_BUCKET = "openmeld-organization-skills-prod";
const ORGANIZATION_SKILLS_R2_PREVIEW_BUCKET =
  "openmeld-organization-skills-preview";
const ORGANIZATION_LOGOS_R2_BINDING = "OPENMELD_ORGANIZATION_LOGOS";
const ORGANIZATION_LOGOS_R2_BUCKET = "openmeld-organization-logos-prod";
const ORGANIZATION_LOGOS_R2_PREVIEW_BUCKET =
  "openmeld-organization-logos-preview";
const ACCOUNT_AVATARS_R2_BINDING = "OPENMELD_ACCOUNT_AVATARS";
const ORGANIZATION_LOGOS_IMAGES_BINDING = "OPENMELD_IMAGES";
const WORKER_ENVIRONMENT_VAR = "OPENMELD_WORKER_ENVIRONMENT";
const DAEMON_DISPATCH_QUEUE_NAME = "openmeld-daemon-dispatch";
const DAEMON_DISPATCH_PROD_QUEUE_NAME = "openmeld-daemon-dispatch-prod";
const MESSAGE_CHANNEL_EVENTS_QUEUE_NAME = "openmeld-message-channel-events";
const MESSAGE_CHANNEL_EVENTS_PROD_QUEUE_NAME =
  "openmeld-message-channel-events-prod";
const FEEDBACK_RATE_LIMIT_BINDINGS = [
  {
    name: "OPENMELD_FEEDBACK_IP_RATE_LIMITER",
    limit: FEEDBACK_SUBMIT_RATE_LIMITS.ip.limit,
    period: FEEDBACK_SUBMIT_RATE_LIMITS.ip.periodSeconds,
  },
  {
    name: "OPENMELD_FEEDBACK_INBOX_RATE_LIMITER",
    limit: FEEDBACK_SUBMIT_RATE_LIMITS.inbox.limit,
    period: FEEDBACK_SUBMIT_RATE_LIMITS.inbox.periodSeconds,
  },
];
const AUTH_RATE_LIMIT_BINDINGS = [
  {
    name: "OPENMELD_ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITER",
    limit: ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMIT.limit,
    period: ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMIT.periodSeconds,
  },
];
const GATEWAY_RATE_LIMIT_BINDINGS = [
  ...FEEDBACK_RATE_LIMIT_BINDINGS,
  {
    name: "OPENMELD_SPACE_PASSWORD_RATE_LIMITER",
    limit: SPACE_PASSWORD_RATE_LIMIT.limit,
    period: SPACE_PASSWORD_RATE_LIMIT.periodSeconds,
  },
];

// Per-domain bindings remain split-ready aliases to the one greenfield
// production database. A future observability-only split would change only
// OPENMELD_WAKE_EVIDENCE_DB after a separate capacity decision.
const AUTH_IDENTITY_DB_BINDING = {
  binding: "OPENMELD_IDENTITY_DB",
  database_name: SHARED_DB_DATABASE_NAME,
  database_id: SHARED_DB_DATABASE_ID,
};
const CORE_LOCAL_STATE_DB_BINDING = {
  binding: "OPENMELD_LOCAL_STATE_DB",
  database_name: SHARED_DB_DATABASE_NAME,
  database_id: SHARED_DB_DATABASE_ID,
};
const CORE_WAKE_EVIDENCE_DB_BINDING = {
  binding: "OPENMELD_WAKE_EVIDENCE_DB",
  database_name: SHARED_DB_DATABASE_NAME,
  database_id: SHARED_DB_DATABASE_ID,
};
const CORE_PROJECTIONS_DB_BINDING = {
  binding: "OPENMELD_PROJECTIONS_DB",
  database_name: SHARED_DB_DATABASE_NAME,
  database_id: SHARED_DB_DATABASE_ID,
};
const D1_BINDING_NAMES = [
  SHARED_DB_BINDING_NAME,
  AUTH_IDENTITY_DB_BINDING.binding,
  CORE_LOCAL_STATE_DB_BINDING.binding,
  CORE_WAKE_EVIDENCE_DB_BINDING.binding,
  CORE_PROJECTIONS_DB_BINDING.binding,
];

const workerPackages = [
  {
    name: "openmeld-web",
    packageJsonPath: "clients/web/package.json",
    wranglerConfigPath: "clients/web/wrangler.jsonc",
    generatedTypesPath: "clients/web/worker-configuration.d.ts",
    requiredScripts: ["cf-typegen", "sync:config:prod", "sync:prod"],
    secretOwned: true,
    requiredSecretNames: ["WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"],
    requiredSecretScriptSnippet: "sync-worker-secrets.mjs",
    expectedGeneratedBindings: [
      "OPENMELD_DESKTOP_DOWNLOADS",
      "OPENMELD_OBSERVABILITY",
    ],
    forbiddenGeneratedBindings: D1_BINDING_NAMES,
    expectedD1Bindings: () => [],
    expectedR2Bindings: () => [
      {
        binding: DESKTOP_DOWNLOADS_R2_BINDING,
        bucket_name: DESKTOP_DOWNLOADS_R2_BUCKET,
      },
    ],
  },
  {
    name: "@openmeld/auth-worker",
    packageJsonPath: "services/auth/package.json",
    wranglerConfigPath: "services/auth/wrangler.jsonc",
    generatedTypesPath: "services/auth/worker-configuration.d.ts",
    requiredScripts: ["cf-typegen", "sync:config:prod", "sync:prod"],
    secretOwned: true,
    requiredSecretNames: [
      "BETTER_AUTH_OPENMELD_SECRET",
      "GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET",
      "GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET",
    ],
    requiredSecretScriptSnippet: "sync-worker-secrets.mjs",
    requiredVarNames: ["OPENMELD_ADDITIONAL_HUMAN_PROFILE_CREATION_ENABLED"],
    expectedGeneratedBindings: [
      "AUTH_EMAIL",
      "OPENMELD_AUTH_KV",
      "OPENMELD_DB",
      "OPENMELD_IDENTITY_DB",
      "OPENMELD_OBSERVABILITY",
      "OPENMELD_ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITER",
    ],
    forbiddenGeneratedBindings: [],
    expectedD1Bindings: ({ wranglerConfigPath }) => [
      buildSharedD1BindingForWorkerConfig(wranglerConfigPath),
      AUTH_IDENTITY_DB_BINDING,
    ],
    expectedR2Bindings: () => [],
    expectedRateLimitBindings: AUTH_RATE_LIMIT_BINDINGS,
  },
  {
    name: "@openmeld/core",
    packageJsonPath: "services/core/package.json",
    wranglerConfigPath: "services/core/wrangler.jsonc",
    generatedTypesPath: "services/core/worker-configuration.d.ts",
    requiredScripts: ["cf-typegen", "sync:config:prod", "sync:prod"],
    secretOwned: true,
    requiredSecretNames: [
      "GITHUB_OPENMELD_API_TOKEN",
      "SLACK_OPENMELD_BOT_TOKEN",
      "SLACK_OPENMELD_TOKEN_CRYPTO_KEY",
      "LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY",
      "ZEP_OPENMELD_API_KEY",
    ],
    requiredSecretScriptSnippet: "sync-worker-secrets.mjs",
    requiredVarNames: [
      "OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED",
      "OPENMELD_REMOTE_AGENT_DESIGNATION_ENABLED",
      "OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS",
      "OPENMELD_LARK_CHANNEL_ENABLED",
      "OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS",
      "OPENMELD_FEISHU_CHANNEL_ENABLED",
      "OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS",
    ],
    expectedGeneratedBindings: [
      "OPENMELD_AUTH_WORKER",
      "OPENMELD_REMOTE_AGENT_WORKER",
      "OPENMELD_RUNTIME_TRANSPORT",
      "OPENMELD_DB",
      "OPENMELD_LOCAL_STATE_DB",
      "OPENMELD_WAKE_EVIDENCE_DB",
      "OPENMELD_PROJECTIONS_DB",
      "OPENMELD_OBSERVABILITY",
      "OPENMELD_ORGANIZATION_SKILLS",
      "OPENMELD_SPACE_ATTACHMENTS",
      "OPENMELD_SPACES",
      "OPENMELD_DAEMON_DISPATCH_QUEUE",
      "OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE",
      "OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED",
      "OPENMELD_REMOTE_AGENT_DESIGNATION_ENABLED",
      "OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS",
      "OPENMELD_LARK_CHANNEL_ENABLED",
      "OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS",
      "OPENMELD_FEISHU_CHANNEL_ENABLED",
      "OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS",
      "GITHUB_OPENMELD_API_TOKEN",
      "SLACK_OPENMELD_BOT_TOKEN",
      "SLACK_OPENMELD_TOKEN_CRYPTO_KEY",
      "LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY",
      "ZEP_OPENMELD_API_KEY",
    ],
    forbiddenGeneratedBindings: [],
    expectedD1Bindings: ({ wranglerConfigPath }) => [
      buildSharedD1BindingForWorkerConfig(wranglerConfigPath),
      CORE_LOCAL_STATE_DB_BINDING,
      CORE_WAKE_EVIDENCE_DB_BINDING,
      CORE_PROJECTIONS_DB_BINDING,
    ],
    expectedR2Bindings: ({ environment }) => [
      {
        binding: SPACE_ATTACHMENTS_R2_BINDING,
        bucket_name:
          environment === "prod"
            ? SPACE_ATTACHMENTS_R2_BUCKET
            : SPACE_ATTACHMENTS_R2_PREVIEW_BUCKET,
        preview_bucket_name: SPACE_ATTACHMENTS_R2_PREVIEW_BUCKET,
      },
      {
        binding: ORGANIZATION_SKILLS_R2_BINDING,
        bucket_name:
          environment === "prod"
            ? ORGANIZATION_SKILLS_R2_BUCKET
            : ORGANIZATION_SKILLS_R2_PREVIEW_BUCKET,
        preview_bucket_name: ORGANIZATION_SKILLS_R2_PREVIEW_BUCKET,
      },
    ],
    expectedQueueConsumers: ({ environment }) =>
      expectedCoreQueueConsumers(environment),
    expectedQueueProducers: ({ environment }) =>
      expectedCoreQueueProducers(environment),
  },
  {
    name: "@openmeld/remote-agent",
    packageJsonPath: "services/remote-agent/package.json",
    wranglerConfigPath: "services/remote-agent/wrangler.jsonc",
    generatedTypesPath: "services/remote-agent/worker-configuration.d.ts",
    requiredScripts: ["cf-typegen", "sync:config:prod", "sync:prod"],
    secretOwned: true,
    requiredSecretNames: [
      "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
      "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN",
    ],
    requiredSecretScriptSnippet: "sync-worker-secrets.mjs",
    requiredConfigEnvironments: ["dev", "prod"],
    expectedContainerNames: {
      "top-level": "openmeld-agent-computer",
      "env.dev": "openmeld-agent-computer-dev",
      "env.prod": "openmeld-agent-computer-prod",
    },
    requiredVarNames: [
      "OPENMELD_FEEDBACK_SUBMIT_BASE_URL",
      "OPENMELD_CONNECTORS_BASE_URL",
      "OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY",
      "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID",
      "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID",
      "OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS",
      "OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID",
    ],
    expectedGeneratedBindings: [
      "FLUE_CENTER_AGENT_AGENT",
      "FLUE_REGISTRY",
      "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
      "OPENMELD_CORE_WORKER",
      "OPENMELD_FEEDBACK_SUBMIT_BASE_URL",
      "OPENMELD_OBSERVABILITY",
      "OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY",
      "OPENMELD_SPACE_ATTACHMENTS",
      "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID",
      "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID",
      "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN",
      "OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS",
      "OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID",
    ],
    forbiddenGeneratedBindings: D1_BINDING_NAMES,
    expectedD1Bindings: () => [],
    expectedR2Bindings: ({ environment }) => [
      {
        binding: SPACE_ATTACHMENTS_R2_BINDING,
        bucket_name:
          environment === "prod"
            ? SPACE_ATTACHMENTS_R2_BUCKET
            : SPACE_ATTACHMENTS_R2_PREVIEW_BUCKET,
        preview_bucket_name: SPACE_ATTACHMENTS_R2_PREVIEW_BUCKET,
      },
    ],
  },
  {
    name: "@openmeld/gateway",
    packageJsonPath: "services/gateway/package.json",
    wranglerConfigPath: "services/gateway/wrangler.jsonc",
    generatedTypesPath: "services/gateway/worker-configuration.d.ts",
    requiredScripts: ["cf-typegen", "sync:config:prod", "sync:prod"],
    secretOwned: true,
    requiredSecretNames: [
      "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
      "SLACK_OPENMELD_OAUTH_CLIENT_ID",
      "SLACK_OPENMELD_OAUTH_CLIENT_SECRET",
      "SLACK_OPENMELD_SIGNING_SECRET",
    ],
    requiredVarNames: [
      "OPENMELD_CONNECTORS_BASE_URL",
      "OPENMELD_GATEWAY_URL",
      "OPENMELD_SLACK_OAUTH_REDIRECT_URL",
      "WEB_APP_URL",
    ],
    requiredSecretScriptSnippet: "sync-worker-secrets.mjs",
    expectedGeneratedBindings: [
      "OPENMELD_AUTH_WORKER",
      "OPENMELD_ACCOUNT_AVATARS",
      "OPENMELD_CORE_WORKER",
      "OPENMELD_FEEDBACK_INBOX_RATE_LIMITER",
      "OPENMELD_FEEDBACK_IP_RATE_LIMITER",
      "OPENMELD_OBSERVABILITY",
      "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
      "OPENMELD_IMAGES",
      "OPENMELD_GATEWAY_URL",
      "OPENMELD_ORGANIZATION_LOGOS",
      "OPENMELD_SPACE_PASSWORD_RATE_LIMITER",
      "OPENMELD_SPACE_ATTACHMENTS",
      "OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE",
      "OPENMELD_REMOTE_AGENT_SLACK_EVENTS_QUEUE",
      "SLACK_OPENMELD_OAUTH_CLIENT_ID",
      "SLACK_OPENMELD_OAUTH_CLIENT_SECRET",
      "OPENMELD_SLACK_OAUTH_REDIRECT_URL",
      "SLACK_OPENMELD_SIGNING_SECRET",
      "WEB_APP_URL",
    ],
    forbiddenGeneratedBindings: D1_BINDING_NAMES,
    expectedD1Bindings: () => [],
    expectedR2Bindings: ({ environment }) => [
      {
        binding: SPACE_ATTACHMENTS_R2_BINDING,
        bucket_name:
          environment === "prod"
            ? SPACE_ATTACHMENTS_R2_BUCKET
            : SPACE_ATTACHMENTS_R2_PREVIEW_BUCKET,
        preview_bucket_name: SPACE_ATTACHMENTS_R2_PREVIEW_BUCKET,
      },
      {
        binding: ACCOUNT_AVATARS_R2_BINDING,
        bucket_name:
          environment === "prod"
            ? ORGANIZATION_LOGOS_R2_BUCKET
            : ORGANIZATION_LOGOS_R2_PREVIEW_BUCKET,
        preview_bucket_name: ORGANIZATION_LOGOS_R2_PREVIEW_BUCKET,
      },
      {
        binding: ORGANIZATION_LOGOS_R2_BINDING,
        bucket_name:
          environment === "prod"
            ? ORGANIZATION_LOGOS_R2_BUCKET
            : ORGANIZATION_LOGOS_R2_PREVIEW_BUCKET,
        preview_bucket_name: ORGANIZATION_LOGOS_R2_PREVIEW_BUCKET,
      },
    ],
    expectedImagesBinding: ({ environment }) => ({
      binding: ORGANIZATION_LOGOS_IMAGES_BINDING,
      remote: environment === "prod" ? undefined : true,
    }),
    expectedRateLimitBindings: GATEWAY_RATE_LIMIT_BINDINGS,
    expectedQueueConsumers: () => [],
    expectedQueueProducers: ({ environment }) =>
      expectedGatewayQueueProducers(environment),
  },
];

const failures = [];

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseJsoncObject(relativePath) {
  return parseJsoncSource(readText(relativePath));
}

function ensure(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function readDefinedEnvKeys(relativePath) {
  return readText(relativePath)
    .split("\n")
    .map((line) => line.match(DEV_VAR_KEY_PATTERN)?.[1] ?? null)
    .filter((key) => key !== null);
}

const openConnectorWrangler = parseJsoncObject(
  "config/openconnector/wrangler.production.jsonc"
);
const expectedOpenConnectorGoogleReadActions = [
  "gmail.search_threads",
  "gmail.list_threads",
  "gmail.fetch_emails",
  "gmail.get_message",
  "gmail.fetch_message_by_message_id",
  "gmail.fetch_message_by_thread_id",
  "gmail.get_profile",
  "gmail.list_history",
  "googlecalendar.list_calendars",
  "googlecalendar.get_calendar_list_entry",
  "googlecalendar.get_calendar",
  "googlecalendar.list_events",
  "googlecalendar.list_events_all_calendars",
  "googlecalendar.get_event",
  "googlecalendar.list_event_instances",
  "googlecalendar.sync_events",
  "googlecalendar.free_busy_query",
  "googlecalendar.find_free_slots",
  "googlecalendar.get_colors",
  "googlecalendar.find_event",
  "googledrive.about.get",
  "googledrive.apps.get",
  "googledrive.changes.getStartPageToken",
  "googledrive.changes.list",
  "googledrive.comments.get",
  "googledrive.comments.list",
  "googledrive.drives.get",
  "googledrive.drives.list",
  "googledrive.files.export",
  "googledrive.files.get",
  "googledrive.files.list",
  "googledrive.files.listLabels",
  "googledrive.permissions.get",
  "googledrive.permissions.list",
  "googledrive.replies.get",
  "googledrive.replies.list",
  "googledrive.revisions.get",
  "googledrive.revisions.list",
  "googledrive.accessproposals.list",
  "googledrive.approvals.list",
];
const configuredOpenConnectorGoogleActions = String(
  openConnectorWrangler.vars?.OOMOL_CONNECT_ALLOWED_ACTIONS ?? ""
)
  .split(",")
  .filter((action) => OPENCONNECTOR_GOOGLE_ACTION_PATTERN.test(action));
ensure(
  JSON.stringify(configuredOpenConnectorGoogleActions) ===
    JSON.stringify(expectedOpenConnectorGoogleReadActions),
  "OpenConnector production must expose only the reviewed read-only Google action baseline."
);
ensure(
  openConnectorWrangler.workers_dev === false &&
    openConnectorWrangler.preview_urls === false,
  "OpenConnector production must disable workers.dev and preview URLs."
);
ensure(
  Array.isArray(openConnectorWrangler.routes) &&
    openConnectorWrangler.routes.length === 1 &&
    openConnectorWrangler.routes[0]?.pattern === "connectors.openmeld.ai" &&
    openConnectorWrangler.routes[0]?.custom_domain === true,
  "OpenConnector production must own the connectors.openmeld.ai custom domain."
);
ensure(
  JSON.stringify(openConnectorWrangler.secrets?.required) ===
    JSON.stringify([
      "OOMOL_CONNECT_ADMIN_TOKEN",
      "OOMOL_CONNECT_ENCRYPTION_KEY",
      "OOMOL_CONNECT_GITHUB_APP_ID",
      "OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY",
      "OOMOL_CONNECT_RUNTIME_TOKEN",
    ]),
  "OpenConnector production must declare the exact upstream runtime secret contract."
);
ensure(
  readText("scripts/cloudflare/deploy-openconnector-production.mjs").includes(
    '"--secrets-file", "/dev/stdin"'
  ),
  "OpenConnector production deploy must deliver new-Worker secrets through stdin without writing them to disk."
);
ensure(
  readText("scripts/cloudflare/deploy-openconnector-production.mjs").includes(
    '"secret", "list", "--config", temporaryConfigName'
  ),
  "OpenConnector production deploy must verify the deployed secret contract before preserving existing Cloudflare secrets."
);

for (const workerPackage of workerPackages) {
  const packageJson = JSON.parse(readText(workerPackage.packageJsonPath));
  const scripts = packageJson.scripts ?? {};

  for (const scriptName of workerPackage.requiredScripts) {
    ensure(
      typeof scripts[scriptName] === "string" &&
        scripts[scriptName].trim().length > 0,
      `${workerPackage.name} is missing required script "${scriptName}".`
    );
  }

  if (workerPackage.secretOwned) {
    ensure(
      typeof scripts["sync:secrets:prod"] === "string" &&
        scripts["sync:secrets:prod"].trim().length > 0,
      `${workerPackage.name} is missing required script "sync:secrets:prod".`
    );
    ensure(
      scripts["sync:secrets:prod"]?.includes(
        workerPackage.requiredSecretScriptSnippet ?? ""
      ) ?? false,
      `${workerPackage.name} must route sync:secrets:prod through the shared sync-worker-secrets.mjs helper.`
    );

    const packageDirectory = path.dirname(workerPackage.packageJsonPath);
    for (const fileName of [".dev.vars.example", ".dev.vars.prod.example"]) {
      const relativePath = path.join(packageDirectory, fileName);
      ensure(
        existsSync(path.join(repoRoot, relativePath)),
        `${workerPackage.name} is missing ${relativePath}.`
      );

      if (!existsSync(path.join(repoRoot, relativePath))) {
        continue;
      }

      const definedKeys = readDefinedEnvKeys(relativePath);
      const expectedKeys = workerPackage.requiredSecretNames ?? [];

      for (const secretName of expectedKeys) {
        ensure(
          definedKeys.includes(secretName),
          `${relativePath} must define ${secretName}.`
        );
      }

      for (const definedKey of definedKeys) {
        ensure(
          expectedKeys.includes(definedKey),
          `${relativePath} must not define unexpected key ${definedKey}.`
        );
      }
    }
  }

  const workerConfig = parseJsoncObject(workerPackage.wranglerConfigPath);
  for (const environment of workerPackage.requiredConfigEnvironments ?? []) {
    ensure(
      Object.hasOwn(workerConfig.env ?? {}, environment),
      `${workerPackage.name} must declare env.${environment}.`
    );
  }
  verifyD1Policy(workerPackage, workerConfig);
  verifyR2Policy(workerPackage, workerConfig);
  verifyImagesPolicy(workerPackage, workerConfig);
  verifyQueuePolicy(workerPackage, workerConfig);
  verifyRateLimitPolicy(workerPackage, workerConfig);
  verifyObservabilityPolicy(workerPackage, workerConfig);
  verifyRequiredVars(workerPackage, workerConfig);
  verifyRequiredSecrets(workerPackage, workerConfig);
  verifyContainerNames(workerPackage, workerConfig);
  verifyGeneratedTypeBindings(workerPackage);
}

function listD1BindingsByName(configSection) {
  const bindings = Array.isArray(configSection?.d1_databases)
    ? configSection.d1_databases
    : [];
  return new Map(
    bindings
      .filter((binding) => binding && typeof binding === "object")
      .map((binding) => [binding.binding, binding])
  );
}

function getConfigSections(config) {
  return [
    { label: "top-level", value: config },
    ...Object.entries(config.env ?? {}).map(([envName, value]) => ({
      label: `env.${envName}`,
      value,
    })),
  ];
}

function listAnalyticsEngineBindingsByName(configSection) {
  const bindings = Array.isArray(configSection?.analytics_engine_datasets)
    ? configSection.analytics_engine_datasets
    : [];
  return new Map(
    bindings
      .filter((binding) => binding && typeof binding === "object")
      .map((binding) => [binding.binding, binding])
  );
}

function listR2BindingsByName(configSection) {
  const bindings = Array.isArray(configSection?.r2_buckets)
    ? configSection.r2_buckets
    : [];
  return new Map(
    bindings
      .filter((binding) => binding && typeof binding === "object")
      .map((binding) => [binding.binding, binding])
  );
}

function listQueueProducersByBinding(configSection) {
  const producers = Array.isArray(configSection?.queues?.producers)
    ? configSection.queues.producers
    : [];
  return new Map(
    producers
      .filter((producer) => producer && typeof producer === "object")
      .map((producer) => [producer.binding, producer])
  );
}

function listQueueConsumersByName(configSection) {
  const consumers = Array.isArray(configSection?.queues?.consumers)
    ? configSection.queues.consumers
    : [];
  return new Map(
    consumers
      .filter((consumer) => consumer && typeof consumer === "object")
      .map((consumer) => [consumer.queue, consumer])
  );
}

function verifyImagesPolicy(workerPackage, workerConfig) {
  if (!workerPackage.expectedImagesBinding) {
    return;
  }
  for (const { label, value } of getConfigSections(workerConfig)) {
    const expected = workerPackage.expectedImagesBinding({
      ...workerPackage,
      environment: expectedWorkerEnvironmentForSection(label),
    });
    const configured = value?.images;
    ensure(
      configured && typeof configured === "object",
      `${workerPackage.name} ${label} must declare the Cloudflare Images binding.`
    );
    if (!(configured && typeof configured === "object")) {
      continue;
    }
    ensure(
      configured.binding === expected.binding,
      `${workerPackage.name} ${label} images.binding must be ${expected.binding}.`
    );
    ensure(
      configured.remote === expected.remote,
      `${workerPackage.name} ${label} images.remote must be ${String(expected.remote)}.`
    );
  }
}

function listRateLimitBindingsByName(configSection) {
  const bindings = Array.isArray(configSection?.ratelimits)
    ? configSection.ratelimits
    : [];
  return new Map(
    bindings
      .filter((binding) => binding && typeof binding === "object")
      .map((binding) => [binding.name, binding])
  );
}

function verifyRateLimitPolicy(workerPackage, workerConfig) {
  const expectedBindings = workerPackage.expectedRateLimitBindings;
  if (!expectedBindings) {
    return;
  }
  const expectedByName = new Map(
    expectedBindings.map((binding) => [binding.name, binding])
  );

  for (const { label, value } of getConfigSections(workerConfig)) {
    const configuredByName = listRateLimitBindingsByName(value);
    for (const [bindingName, configured] of configuredByName) {
      const expected = expectedByName.get(bindingName);
      ensure(
        Boolean(expected),
        `${workerPackage.name} ${label} must not declare unexpected Rate Limiting binding ${bindingName}.`
      );
      if (!expected) {
        continue;
      }
      ensure(
        configured.simple?.limit === expected.limit,
        `${workerPackage.name} ${label} ${bindingName}.simple.limit must be ${expected.limit}.`
      );
      ensure(
        configured.simple?.period === expected.period,
        `${workerPackage.name} ${label} ${bindingName}.simple.period must be ${expected.period}.`
      );
    }

    for (const bindingName of expectedByName.keys()) {
      ensure(
        configuredByName.has(bindingName),
        `${workerPackage.name} ${label} must declare ${bindingName}.`
      );
    }
  }
}

function expectedWorkerEnvironmentForSection(label) {
  return label === "top-level"
    ? "local"
    : label.replace(CONFIG_ENV_LABEL_PREFIX_PATTERN, "");
}

function verifyObservabilityPolicy(workerPackage, workerConfig) {
  for (const { label, value } of getConfigSections(workerConfig)) {
    const observability = value?.observability;
    ensure(
      observability?.enabled === true,
      `${workerPackage.name} ${label} must enable Cloudflare observability.`
    );
    ensure(
      observability?.logs?.enabled === true,
      `${workerPackage.name} ${label} must enable Cloudflare observability logs.`
    );
    ensure(
      observability?.traces?.enabled === true,
      `${workerPackage.name} ${label} must enable Cloudflare observability traces.`
    );

    const analyticsBindings = listAnalyticsEngineBindingsByName(value);
    const runtimeEvidenceBinding = analyticsBindings.get(
      OBSERVABILITY_ANALYTICS_BINDING
    );
    const expectedWorkerEnvironment =
      expectedWorkerEnvironmentForSection(label);
    const expectedDataset =
      expectedWorkerEnvironment === "prod"
        ? OBSERVABILITY_ANALYTICS_PROD_DATASET
        : OBSERVABILITY_ANALYTICS_DATASET;
    ensure(
      Boolean(runtimeEvidenceBinding),
      `${workerPackage.name} ${label} must declare ${OBSERVABILITY_ANALYTICS_BINDING}.`
    );
    ensure(
      runtimeEvidenceBinding?.dataset === expectedDataset,
      `${workerPackage.name} ${label} ${OBSERVABILITY_ANALYTICS_BINDING}.dataset must be ${expectedDataset}.`
    );

    ensure(
      value?.vars?.[WORKER_ENVIRONMENT_VAR] === expectedWorkerEnvironment,
      `${workerPackage.name} ${label} vars.${WORKER_ENVIRONMENT_VAR} must be ${expectedWorkerEnvironment}.`
    );
  }
}

function verifyRequiredVars(workerPackage, workerConfig) {
  for (const varName of workerPackage.requiredVarNames ?? []) {
    for (const { label, value } of getConfigSections(workerConfig)) {
      ensure(
        Object.hasOwn(value?.vars ?? {}, varName),
        `${workerPackage.name} ${label} vars must declare ${varName}.`
      );
    }
  }
}

function verifyRequiredSecrets(workerPackage, workerConfig) {
  for (const secretName of workerPackage.requiredSecretNames ?? []) {
    for (const { label, value } of getConfigSections(workerConfig)) {
      const requiredSecrets = Array.isArray(value?.secrets?.required)
        ? value.secrets.required
        : [];
      ensure(
        requiredSecrets.includes(secretName),
        `${workerPackage.name} ${label} secrets.required must declare ${secretName}.`
      );
    }
  }
}

function verifyContainerNames(workerPackage, workerConfig) {
  const expectedNames = workerPackage.expectedContainerNames;
  if (!expectedNames) {
    return;
  }

  for (const { label, value } of getConfigSections(workerConfig)) {
    const containers = Array.isArray(value?.containers) ? value.containers : [];
    const expectedName = expectedNames[label];
    ensure(
      containers.length === 1 && containers[0]?.name === expectedName,
      `${workerPackage.name} ${label} must declare one explicit container name: ${expectedName}.`
    );
  }
}

function verifyD1Policy(workerPackage, workerConfig) {
  const expectedD1Bindings = workerPackage.expectedD1Bindings(workerPackage);
  const expectedD1BindingsByName = new Map(
    expectedD1Bindings.map((binding) => [binding.binding, binding])
  );

  for (const { label, value } of getConfigSections(workerConfig)) {
    const d1BindingsByName = listD1BindingsByName(value);

    for (const [bindingName, d1Binding] of d1BindingsByName) {
      ensure(
        expectedD1BindingsByName.has(bindingName),
        `${workerPackage.name} ${label} must not declare unexpected D1 binding ${bindingName} without updating the Cloudflare resource ownership contract.`
      );

      const expectedD1Binding = expectedD1BindingsByName.get(bindingName);
      if (!expectedD1Binding) {
        continue;
      }

      for (const [fieldName, expectedValue] of Object.entries(
        expectedD1Binding
      )) {
        ensure(
          d1Binding[fieldName] === expectedValue,
          `${workerPackage.name} ${label} ${bindingName}.${fieldName} must be ${expectedValue}.`
        );
      }
    }

    for (const bindingName of expectedD1BindingsByName.keys()) {
      ensure(
        d1BindingsByName.has(bindingName),
        `${workerPackage.name} ${label} must declare ${bindingName}.`
      );
    }
  }
}

function verifyR2Policy(workerPackage, workerConfig) {
  for (const { label, value } of getConfigSections(workerConfig)) {
    const expectedR2Bindings = workerPackage.expectedR2Bindings({
      ...workerPackage,
      environment: expectedWorkerEnvironmentForSection(label),
    });
    const expectedR2BindingsByName = new Map(
      expectedR2Bindings.map((binding) => [binding.binding, binding])
    );
    const r2BindingsByName = listR2BindingsByName(value);

    for (const [bindingName, r2Binding] of r2BindingsByName) {
      ensure(
        expectedR2BindingsByName.has(bindingName),
        `${workerPackage.name} ${label} must not declare unexpected R2 binding ${bindingName} without updating the Cloudflare resource ownership contract.`
      );

      const expectedR2Binding = expectedR2BindingsByName.get(bindingName);
      if (!expectedR2Binding) {
        continue;
      }

      for (const [fieldName, expectedValue] of Object.entries(
        expectedR2Binding
      )) {
        ensure(
          r2Binding[fieldName] === expectedValue,
          `${workerPackage.name} ${label} ${bindingName}.${fieldName} must be ${expectedValue}.`
        );
      }
    }

    for (const bindingName of expectedR2BindingsByName.keys()) {
      ensure(
        r2BindingsByName.has(bindingName),
        `${workerPackage.name} ${label} must declare ${bindingName}.`
      );
    }
  }
}

function verifyQueuePolicy(workerPackage, workerConfig) {
  for (const { label, value } of getConfigSections(workerConfig)) {
    const environment = expectedWorkerEnvironmentForSection(label);
    const expectedProducersByBinding = new Map(
      (workerPackage.expectedQueueProducers?.({ environment }) ?? []).map(
        (producer) => [producer.binding, producer]
      )
    );
    const expectedConsumerNames = new Set(
      workerPackage.expectedQueueConsumers?.({ environment }) ?? []
    );
    const producersByBinding = listQueueProducersByBinding(value);
    const consumersByName = listQueueConsumersByName(value);

    for (const [bindingName, producer] of producersByBinding) {
      const expectedProducer = expectedProducersByBinding.get(bindingName);
      ensure(
        expectedProducer !== undefined,
        `${workerPackage.name} ${label} must not declare unexpected Queue producer ${bindingName} without updating the Cloudflare resource ownership contract.`
      );
      if (expectedProducer) {
        ensure(
          producer.queue === expectedProducer.queue,
          `${workerPackage.name} ${label} ${bindingName}.queue must be ${expectedProducer.queue}.`
        );
      }
    }

    for (const [bindingName] of expectedProducersByBinding) {
      ensure(
        producersByBinding.has(bindingName),
        `${workerPackage.name} ${label} must declare Queue producer ${bindingName}.`
      );
    }

    for (const queueName of consumersByName.keys()) {
      ensure(
        expectedConsumerNames.has(queueName),
        `${workerPackage.name} ${label} must not declare unexpected Queue consumer ${queueName} without updating the Cloudflare resource ownership contract.`
      );
    }

    for (const queueName of expectedConsumerNames) {
      ensure(
        consumersByName.has(queueName),
        `${workerPackage.name} ${label} must declare Queue consumer ${queueName}.`
      );
    }
  }
}

function expectedQueueNames(environment) {
  return environment === "prod"
    ? {
        daemonDispatch: DAEMON_DISPATCH_PROD_QUEUE_NAME,
        messageChannelEvents: MESSAGE_CHANNEL_EVENTS_PROD_QUEUE_NAME,
      }
    : {
        daemonDispatch: DAEMON_DISPATCH_QUEUE_NAME,
        messageChannelEvents: MESSAGE_CHANNEL_EVENTS_QUEUE_NAME,
      };
}

function expectedCoreQueueProducers(environment) {
  const names = expectedQueueNames(environment);
  return [
    {
      binding: "OPENMELD_DAEMON_DISPATCH_QUEUE",
      queue: names.daemonDispatch,
    },
    {
      binding: "OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE",
      queue: names.messageChannelEvents,
    },
  ];
}

function expectedCoreQueueConsumers(environment) {
  const names = expectedQueueNames(environment);
  return [names.daemonDispatch, names.messageChannelEvents];
}

function expectedGatewayQueueProducers(environment) {
  const names = expectedQueueNames(environment);
  return [
    {
      binding: "OPENMELD_REMOTE_AGENT_SLACK_EVENTS_QUEUE",
      queue: names.daemonDispatch,
    },
    {
      binding: "OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE",
      queue: names.messageChannelEvents,
    },
  ];
}

function buildSharedD1BindingForWorkerConfig(wranglerConfigPath) {
  return {
    binding: SHARED_DB_BINDING_NAME,
    database_id: SHARED_DB_DATABASE_ID,
    database_name: SHARED_DB_DATABASE_NAME,
    migrations_dir: path.posix.relative(
      path.posix.dirname(wranglerConfigPath),
      AUTH_DB_MIGRATIONS_PATH
    ),
  };
}

function verifyGeneratedTypeBindings(workerPackage) {
  const generatedTypes = readText(workerPackage.generatedTypesPath);

  for (const bindingName of workerPackage.expectedGeneratedBindings ?? []) {
    ensure(
      new RegExp(`\\b${bindingName}:`, "u").test(generatedTypes),
      `${workerPackage.generatedTypesPath} must include generated binding ${bindingName}. Run pnpm cf-typegen after wrangler.jsonc changes.`
    );
  }

  for (const bindingName of workerPackage.forbiddenGeneratedBindings ?? []) {
    ensure(
      !new RegExp(`\\b${bindingName}:`, "u").test(generatedTypes),
      `${workerPackage.generatedTypesPath} must not include generated binding ${bindingName}. Check wrangler.jsonc and rerun pnpm cf-typegen.`
    );
  }
}

const webWrangler = readText("clients/web/wrangler.jsonc");
ensure(
  webWrangler.includes('"OPENMELD_GATEWAY_URL"') &&
    webWrangler.includes('"WEB_APP_URL"') &&
    webWrangler.includes('"BETTER_AUTH_URL"'),
  "clients/web/wrangler.jsonc must keep OPENMELD_GATEWAY_URL, WEB_APP_URL, and BETTER_AUTH_URL in vars/env.prod.vars."
);
ensure(
  webWrangler.includes(
    '"required": ["WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"]'
  ),
  "clients/web/wrangler.jsonc must declare WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET in secrets.required."
);

const webDevVarsExample = readText("clients/web/.dev.vars.example");
const webDevVarsProdExample = readText("clients/web/.dev.vars.prod.example");
for (const forbiddenKey of [
  "OPENMELD_GATEWAY_URL",
  "WEB_APP_URL",
  "BETTER_AUTH_URL",
]) {
  ensure(
    !webDevVarsExample.includes(`${forbiddenKey}=`),
    `clients/web/.dev.vars.example must not define ${forbiddenKey}.`
  );
  ensure(
    !webDevVarsProdExample.includes(`${forbiddenKey}=`),
    `clients/web/.dev.vars.prod.example must not define ${forbiddenKey}.`
  );
}

const authWrangler = readText("services/auth/wrangler.jsonc");
for (const secretName of [
  "BETTER_AUTH_OPENMELD_SECRET",
  "GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET",
  "GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET",
]) {
  ensure(
    authWrangler.includes(`"${secretName}"`),
    `services/auth/wrangler.jsonc must declare ${secretName} in secrets.required.`
  );
}

const remoteAgentWrangler = parseJsoncObject(
  "services/remote-agent/wrangler.jsonc"
);
ensure(
  remoteAgentWrangler?.vars?.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID ===
    "openmeld-remote-agent-prod",
  "services/remote-agent/wrangler.jsonc local defaults must use the configured openmeld-remote-agent-prod gateway."
);
ensure(
  remoteAgentWrangler?.env?.dev?.vars?.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID ===
    "openmeld-remote-agent-prod",
  "services/remote-agent/wrangler.jsonc env.dev must use the configured openmeld-remote-agent-prod gateway."
);
const remoteAgentProductionConfig = remoteAgentWrangler?.env?.prod;
ensure(
  remoteAgentProductionConfig?.vars?.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID ===
    "openmeld-remote-agent-prod",
  "services/remote-agent/wrangler.jsonc env.prod must route through openmeld-remote-agent-prod."
);
ensure(
  remoteAgentProductionConfig?.vars
    ?.OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS === "openrouter",
  "services/remote-agent/wrangler.jsonc env.prod must select the configured OpenRouter BYOK alias."
);
ensure(
  !remoteAgentProductionConfig?.secrets?.required?.includes(
    "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID_OVERRIDE"
  ),
  "services/remote-agent/wrangler.jsonc env.prod must not declare a second AI Gateway routing authority."
);

const workflowExpectations = [
  {
    workflowPath: ".github/workflows/sync-auth-worker-secrets.yml",
    expectedSnippet: "pnpm -C services/auth run sync:secrets:prod",
  },
  {
    workflowPath: ".github/workflows/sync-web-worker-secrets.yml",
    expectedSnippet: "pnpm -C clients/web run sync:secrets:prod",
  },
  {
    workflowPath: ".github/workflows/deploy-auth-worker.yml",
    expectedSnippet: "pnpm -C services/auth run sync:config:prod",
  },
  {
    workflowPath: ".github/workflows/deploy-core-worker.yml",
    expectedSnippet: "pnpm -C services/core run sync:config:prod",
  },
  {
    workflowPath: ".github/workflows/deploy-remote-agent-worker.yml",
    expectedSnippet: "pnpm -C services/remote-agent run sync:config:prod",
  },
  {
    workflowPath: ".github/workflows/deploy-gateway-worker.yml",
    expectedSnippet: "pnpm -C services/gateway run sync:config:prod",
  },
  {
    workflowPath: ".github/workflows/deploy-web.yml",
    expectedSnippet: "pnpm -C clients/web run sync:config:prod",
  },
];

for (const { workflowPath, expectedSnippet } of workflowExpectations) {
  const workflowText = readText(workflowPath);
  ensure(
    workflowText.includes(expectedSnippet),
    `${workflowPath} must call package script "${expectedSnippet}".`
  );
}

ensure(
  !existsSync(
    path.join(repoRoot, ".github/workflows/sync-web-runtime-env.yml")
  ),
  ".github/workflows/sync-web-runtime-env.yml must be removed in favor of sync-web-worker-secrets.yml."
);

if (failures.length > 0) {
  console.error("[verify-worker-env-contract] contract violations detected:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[verify-worker-env-contract] OK");
