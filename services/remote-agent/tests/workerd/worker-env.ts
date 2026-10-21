import { env as runtimeEnv } from "cloudflare:test";
import type { AgentComputer } from "../../flue-adapter/computer-workspace";
import type { AccountErasureProbe } from "./worker";

/**
 * Durable Object bindings that `vitest.workerd.config.ts` configures for the
 * workerd test entrypoint. They intentionally differ from the generated
 * production `Cloudflare.Env`.
 */
export type WorkerTestEnv = {
  ACCOUNT_ERASURE_PROBE: DurableObjectNamespace<AccountErasureProbe>;
  AGENT_COMPUTER: DurableObjectNamespace<AgentComputer>;
  COMPUTER_PROBE: DurableObjectNamespace;
};

export const env = runtimeEnv as unknown as WorkerTestEnv;
