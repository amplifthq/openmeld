import {
  hasRequestState,
  runWithRequestState,
} from "@better-auth/core/context";
import { createAuthConfig } from "@openmeld/auth/server";
import type { createAuthDatabase } from "@openmeld/db/auth";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { betterAuth } from "better-auth";
import type { AuthBindings } from "../bindings";
import { createKvSecondaryStorage } from "../utils/kv";
import "./initialize-async-context";
import { createOrganizationDeletionGuard } from "./organization-deletion-guard";

type AuthInstance = ReturnType<typeof betterAuth>;
export function createAuth(
  env: AuthBindings,
  database: ReturnType<typeof createAuthDatabase>
): AuthInstance {
  const authConfig = createAuthConfig(
    {
      AUTH_EMAIL: env.AUTH_EMAIL,
      OPENMELD_CORE_WORKER: env.OPENMELD_CORE_WORKER,
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      BETTER_AUTH_OPENMELD_SECRET: env.BETTER_AUTH_OPENMELD_SECRET,
      AUTH_WORKER_NODE_ENV: env.AUTH_WORKER_NODE_ENV,
      AUTH_DESKTOP_DEVELOPMENT_TARGET: env.AUTH_DESKTOP_DEVELOPMENT_TARGET,
      AUTH_DEVICE_ALLOWED_CLIENT_IDS: env.AUTH_DEVICE_ALLOWED_CLIENT_IDS,
      AUTH_FROM_EMAIL: env.AUTH_FROM_EMAIL,
      AUTH_BRAND_NAME: env.AUTH_BRAND_NAME,
      WEB_APP_URL: env.WEB_APP_URL,
      AUTH_COOKIE_DOMAIN: env.AUTH_COOKIE_DOMAIN,
      AUTH_COOKIE_PREFIX: env.AUTH_COOKIE_PREFIX,
      PASSKEY_RP_ID: env.PASSKEY_RP_ID,
      GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID:
        env.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID,
      GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET:
        env.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET,
      GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID:
        env.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID,
      GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET:
        env.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET,
      AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS:
        env.AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS,
    },
    database
  );
  const isProduction = env.AUTH_WORKER_NODE_ENV === "production";
  const authOptions: typeof authConfig = {
    ...authConfig,
    hooks: {
      ...authConfig.hooks,
      before: createOrganizationDeletionGuard(getPostgresDatabase(env)),
    },
    ...(isProduction
      ? {
          secondaryStorage: createKvSecondaryStorage(env.OPENMELD_AUTH_KV),
          rateLimit: {
            ...authConfig.rateLimit,
            storage: "secondary-storage",
          },
        }
      : {}),
  };
  return betterAuth(authOptions);
}
export async function runWithAuthRequestState<T>(
  callback: () => T | Promise<T>
): Promise<T> {
  if (await hasRequestState()) {
    return callback();
  }
  return runWithRequestState(new WeakMap(), callback);
}
