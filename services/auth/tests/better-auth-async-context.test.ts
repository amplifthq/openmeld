import { AsyncLocalStorage } from "node:async_hooks";
import {
  getBetterAuthVersion,
  getCurrentAuthContextAsyncLocalStorage,
  getCurrentDBAdapterAsyncLocalStorage,
  getCurrentRequestState,
  getRequestStateAsyncLocalStorage,
  runWithRequestState,
} from "@better-auth/core/context";
import { describe, expect, it } from "vitest";

const BETTER_AUTH_GLOBAL = Symbol.for("better-auth:global");
const ASYNC_CONTEXT_KEYS = [
  "requestStateAsyncStorage",
  "endpointContextAsyncStorage",
  "adapterAsyncStorage",
] as const;

type BetterAuthAsyncContextKey = (typeof ASYNC_CONTEXT_KEYS)[number];

type BetterAuthGlobalContext = {
  context: Partial<
    Record<BetterAuthAsyncContextKey, AsyncLocalStorage<unknown>>
  >;
};

const readBetterAuthGlobalContext = (): BetterAuthGlobalContext => {
  getBetterAuthVersion();

  const globalContext = Reflect.get(globalThis, BETTER_AUTH_GLOBAL);
  if (
    !globalContext ||
    typeof globalContext !== "object" ||
    !("context" in globalContext) ||
    !globalContext.context ||
    typeof globalContext.context !== "object"
  ) {
    throw new Error("Better Auth did not initialize its global context.");
  }

  return globalContext as BetterAuthGlobalContext;
};

describe("Better Auth async context initialization", () => {
  it("primes every request-owned store before the first concurrent request", async () => {
    const betterAuthGlobal = readBetterAuthGlobalContext();
    const previousStores = new Map(
      ASYNC_CONTEXT_KEYS.map((key) => [key, betterAuthGlobal.context[key]])
    );

    try {
      for (const key of ASYNC_CONTEXT_KEYS) {
        Reflect.deleteProperty(betterAuthGlobal.context, key);
      }

      const { initializeBetterAuthAsyncContext } = await import(
        "../src/lib/better-auth/initialize-async-context"
      );
      initializeBetterAuthAsyncContext();

      for (const key of ASYNC_CONTEXT_KEYS) {
        expect(betterAuthGlobal.context[key]).toBeInstanceOf(AsyncLocalStorage);
      }
      await expect(getRequestStateAsyncLocalStorage()).resolves.toBe(
        betterAuthGlobal.context.requestStateAsyncStorage
      );
      await expect(getCurrentAuthContextAsyncLocalStorage()).resolves.toBe(
        betterAuthGlobal.context.endpointContextAsyncStorage
      );
      await expect(getCurrentDBAdapterAsyncLocalStorage()).resolves.toBe(
        betterAuthGlobal.context.adapterAsyncStorage
      );

      const requestStores = Array.from(
        { length: 32 },
        (_, index) => new Map<object, unknown>([[{}, index]])
      );
      const observedStores = await Promise.all(
        requestStores.map((store) =>
          runWithRequestState(store, async () => {
            await Promise.resolve();
            return getCurrentRequestState();
          })
        )
      );

      expect(observedStores).toEqual(requestStores);
    } finally {
      for (const key of ASYNC_CONTEXT_KEYS) {
        const previousStore = previousStores.get(key);
        if (previousStore) {
          betterAuthGlobal.context[key] = previousStore;
        } else {
          Reflect.deleteProperty(betterAuthGlobal.context, key);
        }
      }
    }
  });
});
