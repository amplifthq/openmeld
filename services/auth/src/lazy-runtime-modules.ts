type BetterAuthRuntime = typeof import("./lib/better-auth");

/** Loads Better Auth only after an HTTP or RPC request needs it. */
export function loadBetterAuthRuntime(): Promise<BetterAuthRuntime> {
  return import("./generated-runtime/better-auth.mjs");
}
