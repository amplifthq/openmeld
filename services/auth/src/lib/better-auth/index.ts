import {
  hasRequestState,
  runWithRequestState,
} from "@better-auth/core/context";
import { createAuthConfig } from "@openmeld/auth/server";
import { betterAuth } from "better-auth";
import type { AuthBindings } from "../bindings";
import { createKvSecondaryStorage } from "../utils/kv";
import "./initialize-async-context";
import { createOrganizationLifecycleGuard } from "./organization-lifecycle-guard";

type AuthInstance = ReturnType<typeof betterAuth>;

let cachedAuth: AuthInstance | null = null;
let cachedAuthKey = "";
let nextBindingToken = 1;
const bindingTokens = new WeakMap<object, number>();

export function createAuth(env: AuthBindings): AuthInstance {
  const nextKey = buildAuthCacheKey(env);
  if (cachedAuth && cachedAuthKey === nextKey) {
    return cachedAuth;
  }

  const authConfig = createAuthConfig({
    AUTH_EMAIL: env.AUTH_EMAIL,
    OPENMELD_CORE_WORKER: env.OPENMELD_CORE_WORKER,
    OPENMELD_DB: env.OPENMELD_DB,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    BETTER_AUTH_OPENMELD_SECRET: env.BETTER_AUTH_OPENMELD_SECRET,
    AUTH_WORKER_NODE_ENV: env.AUTH_WORKER_NODE_ENV,
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
    AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS: env.AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS,
  });

  const isProduction = env.AUTH_WORKER_NODE_ENV === "production";
  const authOptions: typeof authConfig = {
    ...authConfig,
    hooks: {
      ...authConfig.hooks,
      before: createOrganizationLifecycleGuard(
        env.OPENMELD_DB,
        env.OPENMELD_CORE_WORKER
      ),
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

  const auth = betterAuth(authOptions);
  cachedAuth = auth;
  cachedAuthKey = nextKey;
  return auth;
}

export async function runWithAuthRequestState<T>(
  callback: () => T | Promise<T>
): Promise<T> {
  if (await hasRequestState()) {
    return callback();
  }
  return runWithRequestState(new WeakMap(), callback);
}

function buildAuthCacheKey(env: AuthBindings): string {
  return [
    readBindingCacheToken(env.AUTH_EMAIL),
    readBindingCacheToken(env.OPENMELD_CORE_WORKER),
    readBindingCacheToken(env.OPENMELD_DB),
    readBindingCacheToken(env.OPENMELD_AUTH_KV),
    env.BETTER_AUTH_URL ?? "",
    env.AUTH_COOKIE_PREFIX ?? "",
    env.BETTER_AUTH_OPENMELD_SECRET ?? "",
    env.AUTH_WORKER_NODE_ENV ?? "",
    env.AUTH_DEVICE_ALLOWED_CLIENT_IDS ?? "",
    env.AUTH_FROM_EMAIL ?? "",
    env.AUTH_BRAND_NAME ?? "",
    env.WEB_APP_URL ?? "",
    env.AUTH_COOKIE_DOMAIN ?? "",
    env.PASSKEY_RP_ID ?? "",
    env.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID ?? "",
    env.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET ?? "",
    env.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID ?? "",
    env.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET ?? "",
    env.AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS ?? "",
  ].join("|");
}

function readBindingCacheToken(binding: unknown): string {
  if (!binding || typeof binding !== "object") {
    return "";
  }

  const cachedToken = bindingTokens.get(binding);
  if (cachedToken !== undefined) {
    return String(cachedToken);
  }

  const token = nextBindingToken;
  nextBindingToken += 1;
  bindingTokens.set(binding, token);
  return String(token);
}
