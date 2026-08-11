type CoreProfileLifecycleWorker = Service<
  typeof import("../../../core/src/index").ProfileLifecycleEntrypoint
>;

export type AuthBindings = {
  AUTH_EMAIL: SendEmail;
  OPENMELD_DB: D1Database;
  OPENMELD_AUTH_KV: KVNamespace;
  OPENMELD_ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITER: RateLimit;
  OPENMELD_CORE_WORKER?: CoreProfileLifecycleWorker;
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
  OPENMELD_WORKER_ENVIRONMENT?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_OPENMELD_SECRET?: string;
  AUTH_WORKER_NODE_ENV?: string;
  AUTH_DEVICE_ALLOWED_CLIENT_IDS?: string;
  AUTH_FROM_EMAIL?: string;
  AUTH_BRAND_NAME?: string;
  WEB_APP_URL?: string;
  AUTH_COOKIE_DOMAIN?: string;
  PASSKEY_RP_ID?: string;
  GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID?: string;
  GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID?: string;
  GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET?: string;
  AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS?: string;
  OPENMELD_ADDITIONAL_HUMAN_PROFILE_CREATION_ENABLED?: string;
};
