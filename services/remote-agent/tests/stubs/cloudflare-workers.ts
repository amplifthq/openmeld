/**
 * Minimal Node-side stand-ins for the `cloudflare:workers` runtime
 * module, so units that import `@cloudflare/computer` (whose entrypoint
 * subclasses WorkerEntrypoint / RpcTarget at module load) can be tested
 * under vitest without workerd.
 */

export class DurableObject<Env = unknown> {
  ctx: unknown;
  env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  ctx: unknown;
  env: Env;
  props?: Props;

  constructor(ctx?: unknown, env?: Env) {
    this.ctx = ctx;
    this.env = env as Env;
  }
}

export class RpcTarget {}

export const env: Record<string, unknown> = {};
