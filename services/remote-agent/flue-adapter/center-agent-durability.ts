import type { DurabilityConfig } from "@flue/runtime";

// Five retries after the initial model request. Flue counts consecutive
// failures from canonical history, including after a platform restart.
export const CENTER_AGENT_MODEL_RETRY = {
  maxRetries: 5,
  baseDelayMs: 3000,
  maxDelayMs: 30_000,
} as const;

// timeoutMs: 0 disables the wall-clock limit by product decision, so it does
// not affect a normal running task. maxAttempts: 5 includes the initial run
// and caps subsequent recovery attempts after a Durable Object reset or
// redeploy. Failed queued materialization also consumes the same budget;
// successful ongoing work does not. Flue's default of 10 must not leak in.
export const CENTER_AGENT_DURABILITY = {
  maxAttempts: 5,
  timeoutMs: 0,
} satisfies DurabilityConfig;
