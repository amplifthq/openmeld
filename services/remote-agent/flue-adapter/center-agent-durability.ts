import type { DurabilityConfig } from "@flue/runtime";

// timeoutMs: 0 disables the wall-clock limit by product decision, so it does
// not affect a normal running task. maxAttempts: 5 only caps recovery reruns
// after a Durable Object reset or redeploy, bounding repeated cost and
// preventing the Flue SDK default of 10 from silently applying.
export const CENTER_AGENT_DURABILITY = {
  maxAttempts: 5,
  timeoutMs: 0,
} satisfies DurabilityConfig;
