import type { DurabilityConfig } from "@flue/runtime";

// timeoutMs: 0 disables the wall-clock limit by product decision, so it does
// not affect a normal running task. maxAttempts: 5 includes the initial run
// and caps subsequent recovery attempts after a Durable Object reset or
// redeploy. Failed queued materialization also consumes the same budget;
// successful ongoing work does not. Flue's default of 10 must not leak in.
export const CENTER_AGENT_DURABILITY = {
  maxAttempts: 5,
  timeoutMs: 0,
} satisfies DurabilityConfig;
