import { AsyncLocalStorage } from "node:async_hooks";
import { getBetterAuthVersion } from "@better-auth/core/context";

const BETTER_AUTH_GLOBAL = Symbol.for("better-auth:global");
const ASYNC_CONTEXT_KEYS = [
  "requestStateAsyncStorage",
  "endpointContextAsyncStorage",
  "adapterAsyncStorage",
] as const;

type UnknownRecord = Record<PropertyKey, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const readBetterAuthGlobalContext = (): UnknownRecord => {
  getBetterAuthVersion();

  const betterAuthGlobal = Reflect.get(globalThis, BETTER_AUTH_GLOBAL);
  if (!isRecord(betterAuthGlobal)) {
    throw new Error("Better Auth did not initialize its global context.");
  }

  const context = Reflect.get(betterAuthGlobal, "context");
  if (!isRecord(context)) {
    throw new Error("Better Auth initialized an invalid global context.");
  }

  return context;
};

/**
 * Prime Better Auth's request-owned stores before Cloudflare can dispatch the
 * first concurrent request. This avoids making AsyncLocalStorage availability
 * depend on a request-scoped dynamic import during a cold start.
 *
 * Better Auth issue: https://github.com/better-auth/better-auth/issues/10315
 */
export function initializeBetterAuthAsyncContext(): void {
  const context = readBetterAuthGlobalContext();

  for (const key of ASYNC_CONTEXT_KEYS) {
    if (
      Reflect.get(context, key) == null &&
      !Reflect.set(context, key, new AsyncLocalStorage())
    ) {
      throw new Error(`Better Auth could not initialize ${key}.`);
    }
  }
}

initializeBetterAuthAsyncContext();
